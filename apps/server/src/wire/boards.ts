import { readFileSync, writeFileSync } from "node:fs";
import type { ServerMessage } from "@decks/protocol";
import { isBoardFormat } from "../boards/templates.ts";
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
		const agent = wire.agents.focused();
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
	 * **The format decides where the number goes**, and that decision lives here rather than in
	 * the browser because it is a fact about the file:
	 *
	 * - a **component** board's size is the one number in its own `<meta>` tag, so the drag is a
	 *   write — through `boards.resize`, which records a revision like every other write;
	 * - a **flow** document's width is in that tag and its height *is its content*, measured by
	 *   the browser and reported back (`board.extent`), so only the width is written;
	 * - a **slide** deck's height follows from its aspect, so only the width is taken — and it goes to
	 *   the file like every other size: the `<meta>` tag of an HTML deck, front-matter of a markdown
	 *   one. `deck.json` used to keep it, which made a deck's width the one number you could not read
	 *   off the deck.
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
			/*
			 * A flow document takes the width and keeps its own height. Sending both would fight the
			 * measurement that is about to arrive: the frame reloads at the new width, reports the
			 * height it found, and a stored height would win over it for exactly one revision.
			 */
			const wanted = board.format === "flow" ? { ...(w !== undefined ? { w } : {}) } : { ...(w !== undefined ? { w } : {}), ...(h !== undefined ? { h } : {}) };
			if (wanted.w === undefined && wanted.h === undefined) return;
			// `writeBoard` inside broadcasts the new board, so this one needs no second message.
			wire.boards.resize(message.path, wanted);
		} catch (error) {
			reply({ type: "notice", level: "warn", text: (error as Error).message });
		}
	},

	"board.extent": (message, _reply, wire) => {
		wire.boards.noteExtent(message.path, { rev: message.rev, w: message.w, h: message.h });
		/*
		 * A flow board *is* its content's height.
		 *
		 * Markdown and plain documents have nowhere in the file to keep a height and
		 * no reason to: the browser has just measured the only true answer, so the
		 * board takes it. This is what makes "the board clips and nobody notices"
		 * impossible for these formats — there is no stored height to be wrong.
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
		const flowing = wire.deck.board(message.path);
		if (flowing?.format === "flow" && flowing.rev === message.rev) {
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
		const agent = wire.agents.focused();
		agent.setInPlay([...agent.inPlay, message.path]);
	},

	/** The person read it, so it is no longer news on the dashboard until it is written again. */
	"board.seen": (message, _reply, wire) => {
		wire.boards.seen(message.path);
	},

	"board.hide": (message, _reply, wire) => {
		const agent = wire.agents.focused();
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
	 * says, and a format that is not one of the three becomes a component board.
	 */
	"board.create": (message, reply, wire) => {
		const format = isBoardFormat(message.format) ? message.format : "component";
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
		const agent = wire.agents.focused();
		agent.setInPlay([...agent.inPlay, path]);
		if (message.at && Number.isFinite(message.at.x) && Number.isFinite(message.at.y)) {
			agent.setPosition(path, Math.round(message.at.x), Math.round(message.at.y));
			const placed = wire.stageState().boards.find((one) => one.path === path);
			if (placed) wire.send({ type: "board.changed", path: placed.path, rev: placed.rev, board: placed });
		}
		// After the board is announced, so the asker already holds it when it hears the path.
		if (typeof message.request === "string") reply({ type: "board.created", request: message.request, path });
	},

	"board.delete": (message, reply, wire) => {
		wire.boards.deleteBoard(message.path, reply);
	},

	/*
	 * Declared since the first commit, and never wired up.
	 *
	 * **The typed table is what found it.** This variant has been in `ClientMessage` all
	 * along with no sender anywhere in the app and no case in the old switch, so it fell to
	 * `default:` and answered "Not implemented yet" — which is what it still answers, by name
	 * rather than by accident. The gauntlet this passed through is the one the table was built
	 * for: a frame either has an answer or it does not compile.
	 *
	 * Either somebody builds commenting on boards, or the variant goes. What is no longer true
	 * is that nobody knows.
	 */
	"board.comment": (_message, reply) => {
		reply({ type: "notice", level: "warn", text: "Not implemented yet: board.comment" });
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
		const agent = wire.agents.focused();
		agent.setInPlay([...agent.inPlay, path]);
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
	 *   (`canvas/board-eval.ts`), so a board cannot ask for another board's trust.
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
		setContext: (paths: string[]) => focused.setContext(paths),
		inPlay: () => [...focused.inPlay],
		setInPlay: (paths: string[]) => focused.setInPlay(paths),
		positions: () => focused.positions(),
		setPosition: (board: string, x: number, y: number) => focused.setPosition(board, x, y),
		camera: () => wire.cameras.get(focused.id) ?? wire.lastCamera,
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
