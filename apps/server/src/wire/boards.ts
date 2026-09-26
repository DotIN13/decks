import { readFileSync, writeFileSync } from "node:fs";
import type { ServerMessage } from "@decks/protocol";
import { asBoardFormat } from "../boards/templates.ts";
import { codeFor } from "../boards/eval-code.ts";
import { boardActor } from "../stage/board-actor.ts";
import { runEval, safeJson } from "../stage/eval.ts";
import { createStageTool } from "../stage/tool.ts";
import type { Registry } from "../agents/registry.ts";
import type { WireContext, WirePart } from "./context.ts";

/**
 * The board frames: the user's half of the canvas, and the two ways the past comes back.
 *
 * This is where the *user* touches a board — move, play, hide, create, delete, and the
 * drag-and-retype gestures that arrive as patches. The agent's writes do not come through
 * here at all: it edits the file with its own tools, and the watcher tells everyone.
 */
export const boards = {
	"board.move": (message, reply, wire) => {
		if (!wire.deck.board(message.path)) {
			reply({ type: "error", text: `No such board: ${message.path}` });
			return;
		}
		/*
		 * The move belongs to the stage that made it — the focused agent — and not to the deck, so what
		 * is written down is this conversation's arrangement. The board sent back is the one *this stage*
		 * sees, which is the same object when the caller is the stage that moved it.
		 */
		const agent = wire.target();
		agent.setPosition(message.path, message.x, message.y);
		const board = wire.stageState().boards.find((one) => one.path === message.path);
		if (!board) return;
		// Broadcast rather than reply: a second tab is looking at the same
		// stage and the board has moved there too.
		wire.send({ type: "board.changed", path: board.path, rev: board.rev, board });
	},

	/*
	 * A board dragged to a new size, by the person holding the mouse.
	 *
	 * **The number goes into the board's own file**, through `boards.resize`, which records a
	 * revision like every other write. Both dimensions: a width, and a height that is a *floor* —
	 * the browser keeps measuring the content and raises the board above it whenever it needs more
	 * room, so a drag adds space under the last box and can never take away a paragraph.
	 *
	 * A **slide** deck is the exception: its height follows from its aspect, so only the width is
	 * taken. It goes to the file like every other size — the `<meta>` tag of an HTML deck,
	 * front-matter of a markdown one. `deck.json` used to keep it, which made a deck's width the one
	 * number you could not read off the deck.
	 *
	 * Clamped, like everything else a browser sends: 320 wide is about the narrowest board this
	 * app's own templates use, and the ceiling is well past the tallest board in the deck — a
	 * resize is not the place to discover that a number was a typo.
	 */
	"board.resize": (message, reply, wire) => {
		const board = wire.deck.board(message.path);
		if (!board) {
			reply({ type: "error", text: `No such board: ${message.path}` });
			return;
		}
		const bounded = (value: unknown, low: number, high: number) =>
			typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : undefined;
		const w = bounded(message.w, 320, 4000);
		const h = bounded(message.h, 200, 8000);
		if (w === undefined && h === undefined) return;

		try {
			if (board.format === "slides") {
				// `writeBoard` inside broadcasts the new board, so this one needs no second message.
				if (w !== undefined) wire.boards.resize(message.path, { w });
				return;
			}
			const wanted = { ...(w !== undefined ? { w } : {}), ...(h !== undefined ? { h } : {}) };
			if (wanted.w === undefined && wanted.h === undefined) return;
			// `writeBoard` inside broadcasts the new board, so this one needs no second message.
			wire.boards.resize(message.path, wanted);
		} catch (error) {
			reply({ type: "notice", level: "warn", text: (error as Error).message });
		}
	},

	"board.extent": (message, _reply, wire) => {
		wire.boards.noteExtent(message.path, {
			rev: message.rev,
			w: message.w,
			h: message.h,
			...(typeof message.page === "number" ? { page: message.page } : {}),
			...(typeof message.words === "number" ? { words: message.words } : {}),
			...(typeof message.minFont === "number" ? { minFont: message.minFont } : {}),
			...(typeof message.overflowX === "number" ? { overflowX: message.overflowX } : {}),
			...(typeof message.cut === "number" ? { cut: message.cut } : {}),
			...(typeof message.overlaps === "number" ? { overlaps: message.overlaps } : {}),
		});
		/*
		 * A board is as tall as its content, whatever its file says.
		 *
		 * The browser has just measured the only true answer, so the board takes it —
		 * unless the file states a taller one, which `setHeight` treats as a floor. This
		 * is what makes "the board clips and nobody notices" impossible: the measurement
		 * can always raise the board, and the only thing it cannot do is take away room
		 * somebody asked for.
		 *
		 * Three guards, and each one is a loop that was easy to write by accident:
		 *
		 * - `setHeight` returns nothing when the number already matches, so a measurement
		 *   that agrees with the board neither broadcasts nor bumps `rev`, and the frame
		 *   that produced it is not reloaded to be asked again;
		 * - only the height is taken. The width is the user's, from a drag, and a
		 *   measurement that also set it would fight the drag that caused it;
		 * - the reading must be for the revision the board is actually at, or a
		 *   measurement of a document that has since been rewritten sets the height
		 *   of one that no longer exists.
		 */
		const measured = wire.deck.board(message.path);
		if (measured && measured.rev === message.rev) {
			const resized = wire.deck.setHeight(message.path, message.h);
			if (resized) wire.send({ type: "deck.state", deck: wire.stageState() });
		}
	},

	"board.patch": (message, reply, wire) => {
		wire.boards.patch(message.path, message.rev, message.patches, reply);
	},

	"board.undo": (message, reply, wire) => {
		wire.boards.undo(message.path, reply);
	},

	/*
	 * The user's half of the canvas. Playing a board is how the rail works as a control;
	 * hiding takes it off the canvas and deliberately does *not* detach — the context is
	 * the agent's, and nobody should be able to strip what it is working from by tidying
	 * the view.
	 */
	"board.play": (message, _reply, wire) => {
		const agent = wire.target();
		// A board picked out of the rail is a board joining the canvas, so it is placed beside what
		// is on it unless the place it already has is already beside it (`deck/place.ts`).
		agent.setInPlay([...agent.inPlay, message.path], { place: true });
	},

	/** The person read it, so it is no longer news on the canvas until it is written again. */
	"board.seen": (message, _reply, wire) => {
		wire.boards.seen(message.path);
	},

	"board.hide": (message, _reply, wire) => {
		const agent = wire.target();
		agent.setInPlay(agent.inPlay.filter((path) => path !== message.path));
	},

	/*
	 * A new board, and it goes straight onto the canvas.
	 *
	 * Created *and* played, because the two are one act: nobody asks for a board in
	 * order to leave it in the deck. Attached too — `setInPlay` puts it in the focused
	 * agent's context — so the agent you are talking to can see the thing you just
	 * made without being told about it.
	 *
	 * An unknown `kind` and an unknown `format` are the same bargain: the worst outcome of a
	 * bad name should be an empty board rather than a refusal, and every board is blank
	 * anyway — the `kind` left over from when there were templates is ignored, whatever it
	 * says, and a format that is not one of the two becomes a board. `component` and `flow`
	 * are still understood and both mean `board`: they named the two formats that are one.
	 */
	"board.create": (message, reply, wire) => {
		const format = asBoardFormat(message.format) ?? "board";
		/*
		 * A title, a size and a place when the browser has something to put on the board: a
		 * file dropped on empty canvas, which gets a board of its own where it was dropped.
		 * Clamped rather than trusted, like everything a browser sends about a file.
		 */
		const bounded = (value: unknown, low: number, high: number) =>
			typeof value === "number" && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : undefined;
		const title = typeof message.title === "string" && message.title.trim() !== "" ? message.title.trim().slice(0, 120) : "Untitled";
		const w = bounded(message.size?.w, 320, 2400);
		const h = bounded(message.size?.h, 240, 4000);
		const size = w !== undefined || h !== undefined ? { ...(w !== undefined ? { w } : {}), ...(h !== undefined ? { h } : {}) } : undefined;
		const path = wire.boards.newBoard({ title, format, ...(size ? { size } : {}) });
		const agent = wire.target();
		/*
		 * The place first, then the canvas. A drop and a double-click name the point themselves, and
		 * a place that is already there is a place `setInPlay` keeps — so this order is what stops
		 * the board being put beside the newest board for one frame and then moved to the cursor.
		 * With no point named — the ＋ in the corner — there is nothing to keep and the board takes
		 * the nearest open slot beside the stage's newest board (`deck/place.ts`).
		 */
		if (message.at && Number.isFinite(message.at.x) && Number.isFinite(message.at.y)) {
			agent.setPosition(path, Math.round(message.at.x), Math.round(message.at.y));
		}
		agent.setInPlay([...agent.inPlay, path], { place: true });
		const placed = wire.stageState().boards.find((one) => one.path === path);
		if (placed) wire.send({ type: "board.changed", path: placed.path, rev: placed.rev, board: placed });
		// After the board is announced, so the asker already holds it when it hears the path.
		if (typeof message.request === "string") reply({ type: "board.created", request: message.request, path });
	},

	"board.delete": (message, reply, wire) => {
		wire.boards.deleteBoard(message.path, reply);
	},

	/*
	 * A mirror, from the Agents tab.
	 *
	 * Created *and* played, the way `board.create` is, because nobody asks for a
	 * window onto a conversation in order to leave it closed. The name comes from
	 * the agent rather than from the person pressing the button, so two people
	 * mirroring the same agent land on the same board.
	 */
	"agent.mirror": (message, reply, wire) => {
		const of = wire.agents.summaries().find((candidate) => candidate.id === message.agentId);
		if (!of) {
			reply({ type: "notice", level: "warn", text: "That agent is not here any more." });
			return;
		}
		const path = wire.boards.newMirror({ agentId: of.id, name: of.name });
		const agent = wire.target();
		agent.setInPlay([...agent.inPlay, path], { place: true });
		// After the board is placed, so the browser that asked can fly to where it actually landed.
		if (typeof message.request === "string") reply({ type: "board.created", request: message.request, path });
	},

	"boards.restore": (message, reply, wire) => {
		/*
		 * The one place a preview turns into a write, and it takes a click of its
		 * own to get here. Restoring is a new revision rather than a rewind of the
		 * store: going back is a thing that happened, and undoing the restore has
		 * to be possible too.
		 */
		const agent = wire.agents.get(message.id);
		if (!agent) return;
		const wanted = wire.boards.boardsAt(agent, message.entryId);
		let restored = 0;
		for (const [path, sha] of Object.entries(wanted)) {
			try {
				const content = wire.boards.revisions.read(sha);
				if (content === readFileSync(wire.deck.fileOf(path), "utf8")) continue;
				writeFileSync(wire.deck.fileOf(path), content);
				wire.boards.revisions.record(path, content);
				restored++;
			} catch (error) {
				reply({ type: "notice", level: "warn", text: `Could not restore ${path}: ${(error as Error).message}` });
			}
		}
		reply({
			type: "notice",
			level: "info",
			text: restored === 0 ? "Those boards are already as they were." : `Restored ${restored} board${restored === 1 ? "" : "s"}.`,
		});
	},

	/**
	 * A component on a board was pressed, and the board carries code for it.
	 *
	 * Everything that makes this safe is a decision made here rather than in the board:
	 *
	 * - **The path is the app's**, stamped from the frame the message came from
	 *   (`board/board-eval.ts`), so a board cannot ask for another board's trust.
	 * - **The code is the file's**, read here (`boards/eval-code.ts`) rather than sent by the
	 *   board, so what ran is always recoverable from the board on disk.
	 * - **The trust list is the person's** (`boards/eval-trust.ts`), and the first ask is a
	 *   question with the board's name in it rather than a click.
	 */
	"board.eval": (message, reply, wire) => {
		void runBoardEval(message.path, message.id, message.value, reply, wire);
	},
} satisfies WirePart;

/**
 * Read one board's code for one component, confirm the board is trusted, and run it.
 *
 * Async and unawaited by the frame handler for one reason: the trust question is a dialog,
 * and a handler that blocked would hold the socket. The answer arrives on its own frame
 * (`extension.ui.answer`), so all this has to do is wait.
 */
async function runBoardEval(
	path: string,
	id: string,
	value: unknown,
	reply: (message: ServerMessage) => void,
	wire: WireContext,
): Promise<void> {
	if (!wire.deck.board(path)) {
		reply({ type: "notice", level: "warn", text: `There is no board at ${path} to run anything.` });
		return;
	}

	let html: string;
	try {
		html = readFileSync(wire.deck.fileOf(path), "utf8");
	} catch (error) {
		reply({ type: "notice", level: "error", text: `Could not read ${path}: ${(error as Error).message}` });
		return;
	}

	const code = codeFor(html, id);
	if (code === undefined) {
		reply({ type: "notice", level: "warn", text: `Nothing on ${path} answers "${id}".` });
		return;
	}

	/*
	 * The question, once per board.
	 *
	 * A conversation is needed to ask it and to hold the notice afterwards, and `focused()`
	 * is what every other frame that needs a stage uses — it mints one for a deck nobody has
	 * spoken to, which is the right answer here too: a click on a board is a thing a person
	 * did, and it should be legible in a chat.
	 */
	const focused = wire.agents.focused();
	if (!wire.evalTrust.allows(path)) {
		const answer = await focused.bridge.choose({
			title: "Run this board's code?",
			message: `${path} wants to run the code behind "${id}". It runs with the stage API inside the Decks server, so it can do anything the server can: read files, write boards, move the canvas, message agents.`,
			options: [
				{ label: "Allow" },
				{ label: "Always allow this board", description: `Remember ${path}, and stop asking` },
				{ label: "No", description: "Run nothing" },
			],
		});
		if (answer === "Always allow this board") wire.evalTrust.allow(path);
		else if (answer !== "Allow") {
			reply({ type: "notice", level: "info", text: `${path} was not allowed to run "${id}".` });
			return;
		}
	}

	/*
	 * The same stage object an agent gets, with the board as the actor (`stage/board-actor.ts`).
	 *
	 * `event` is the one name added to the snippet's scope: which component was pressed, what
	 * it carried, and the board it sits on.
	 */
	const conversation = {
		id: focused.id,
		context: () => [...focused.context],
		inPlay: () => [...focused.inPlay],
		setInPlay: (paths: string[], at?: Record<string, { x: number; y: number }>) => focused.setInPlay(paths, { place: true, ...(at ? { at } : {}) }),
		positions: () => focused.positions(),
		setPosition: (board: string, x: number, y: number) => focused.setPosition(board, x, y),
		camera: () => wire.cameras.answer(focused.id),
		queue: () => focused.queue(),
		agents: () => wire.agents.summaries(),
		send: (fromId: string, target: string, spec: Parameters<Registry["send"]>[2]) => wire.agents.send(fromId, target, spec),
		recordRevision: (board: string) => wire.boards.recordRevision(board),
		boardPathOf: (file: string) => wire.boards.boardPathOf(file),
	};
	const actor = boardActor({ path, conversation });
	const stage = createStageTool({ stage: wire.stage, agent: actor, port: wire.port }).stage;

	const event = {
		id,
		board: path,
		path,
		...(value !== undefined ? { value } : {}),
	};
	const outcome = await runEval(code, stage, { scope: { event } });

	/*
	 * One notice, always — the run is announced whether it worked or not.
	 *
	 * That is the design's second mitigation and the one worth having: a thing that starts on
	 * its own and says nothing reads as a fault, and an agent reading the conversation later
	 * needs to know a click did something. The first line of the code is in it because that is
	 * what makes the notice checkable against the file.
	 */
	const first = code.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
	const said = first.length > 80 ? `${first.slice(0, 80)}…` : first;
	if (outcome.error) {
		focused.translator.notice("error", `${path} ran "${id}" and failed: ${outcome.error}`);
		reply({ type: "notice", level: "error", text: `${path}: ${outcome.error}` });
		return;
	}
	const returned = outcome.value === undefined ? "" : ` → ${safeJson(outcome.value).replace(/\s+/g, " ").slice(0, 200)}`;
	focused.translator.notice("info", `${path} ran "${id}": ${said}${returned}`);
}
