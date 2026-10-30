import { readFileSync, writeFileSync } from "node:fs";
import type { WireContext, WirePart } from "./context.ts";
import { asPerson } from "../verbs/person.ts";
import { putOn } from "../stage/canvas-ops.ts";

/**
 * The board frames: the user's half of the canvas, and the two ways the past comes back.
 *
 * This is where the *user* touches a board — move, play, hide, create, delete, undo. A board's
 * own page is never edited from the canvas. The agent's writes do not come through
 * here at all: it edits the file with its own tools, and the watcher tells everyone.
 */
/**
 * The stage a person's change goes to: the one on screen, which the browser names, or, from a browser
 * that names none, the focused agent's. An agent on that stage carries the change when there is one,
 * so a board it takes off is remembered where it was; with none, the change is written to the file.
 */
function stageFor(message: { stage?: string }, wire: WireContext): { name?: string; agent?: ReturnType<WireContext["target"]> } {
	const pens = wire.stage.pens;
	const target = wire.target();
	const name = message.stage && pens?.has(message.stage) ? message.stage : target.stageName(true);
	if (!name) return {};
	const agent = target.stageName() === name ? target : (wire.agents.looking()?.stageName() === name ? wire.agents.looking() : wire.agents.all().find((one) => one.stageName() === name));
	return { name, ...(agent ? { agent } : {}) };
}

export const boards = {
	/** A board dragged on the canvas: the person's `move`, on the stage on screen (`verbs/person.ts`). */
	"board.move": (message, reply, wire) => {
		void asPerson({ agents: wire.agents, pens: wire.stage.pens }, { ...(message.stage ? { stage: message.stage } : {}) }, "move", [message.path, { x: message.x, y: message.y }], reply);
	},

	/*
	 * A board dragged to a new size, by the person holding the mouse.
	 *
	 * **The number goes into two files**: the board's own, the size it comes at when a canvas places
	 * it next, as `decks.canvas.fit` and `decks.canvas.update` write it; and the canvas file, as the size of the
	 * board's item there (`setSize`), which is how big it is drawn on that canvas. Every other canvas
	 * holding the board keeps its own size for it. The canvas sends this once, on letting go.
	 *
	 * Clamped, like everything else a browser sends: 320 wide is about the narrowest board this
	 * app's own templates use, and the ceiling is well past the tallest board in the deck — a
	 * resize is not the place to discover that a number was a typo.
	 */
	"board.resize": (message, reply, wire) => {
		const size = { ...(typeof message.w === "number" ? { w: message.w } : {}), ...(typeof message.h === "number" ? { h: message.h } : {}) };
		void asPerson({ agents: wire.agents, pens: wire.stage.pens }, { ...(message.stage ? { stage: message.stage } : {}) }, "resize", [message.path, size], reply);
	},

	"board.extent": (message, _reply, wire) => {
		wire.boards.noteExtent(message.path, {
			rev: message.rev,
			w: message.w,
			h: message.h,
			...(typeof message.at === "number" ? { at: message.at } : {}),
			...(typeof message.page === "number" ? { page: message.page } : {}),
			...(typeof message.words === "number" ? { words: message.words } : {}),
			...(typeof message.minFont === "number" ? { minFont: message.minFont } : {}),
			...(typeof message.overflowX === "number" ? { overflowX: message.overflowX } : {}),
			...(typeof message.cut === "number" ? { cut: message.cut } : {}),
			...(typeof message.overlaps === "number" ? { overlaps: message.overlaps } : {}),
		});
		/*
		 * Kept for the agent who asks (`decks.canvas.fit`, and what it reports), and a card shorter than
		 * its content grows to it (`StagePens.raiseCard`). Otherwise a browser's reading never sizes a
		 * board: the size is the stage file's, set by `decks.canvas.fit`, `decks.canvas.update` or a drag.
		 * Two browsers with different fonts read the same board a pixel or two apart, and when both
		 * readings sized it, each answered the other's for ever; a card only ever grows, so they settle
		 * on the taller.
		 */
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
		const { name, agent } = stageFor(message, wire);
		// A board picked out of the rail is a board joining the canvas, so it is placed beside what
		// is on it unless the place it already has is already beside it (`deck/place.ts`).
		if (agent) agent.setInPlay([...agent.inPlay, message.path], { place: true });
		else if (name && wire.stage.pens) putOn(wire.stage.pens, wire.deck, name, [message.path]);
	},

	/** The person read it, so it is no longer news on the canvas until it is written again. */
	"board.seen": (message, _reply, wire) => {
		wire.boards.seen(message.path);
	},

	"board.hide": (message, reply, wire) => {
		void asPerson({ agents: wire.agents, pens: wire.stage.pens }, { ...(message.stage ? { stage: message.stage } : {}) }, "hide", [message.path], reply);
	},

	/*
	 * A new board, and it goes straight onto the canvas.
	 *
	 * Created *and* played, because the two are one act: nobody asks for a board in
	 * order to leave it in the deck. Attached too — `setInPlay` puts it in the focused
	 * agent's context — so the agent you are talking to can see the thing you just
	 * made without being told about it.
	 *
	 * An unknown `kind` is no refusal: the worst outcome of a bad name should be an empty board,
	 * and every board is blank anyway — the `kind` left over from when there were templates is
	 * ignored, whatever it says.
	 */
	"board.create": (message, reply, wire) => {
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
		let path: string;
		// A Google Doc: linked first, which asks Google, so the board is made when the answer is in.
		if (typeof message.google === "string" && message.google.trim()) {
			void wire.google.link(message.google.trim()).then(
				(mirror) => place(wire.boards.newDocBoard(mirror, wire.google.remote(mirror)?.title)),
				(error: Error) => reply({ type: "notice", level: "warn", text: error.message }),
			);
			return;
		}
		if (typeof message.file === "string" && message.file.trim()) {
			// One file, the whole board: a PDF or a web page put on the canvas from the file picker or a drop.
			path = wire.boards.newFileBoard(message.file.trim(), { w: w ?? 1000, h: h ?? 750 }, typeof message.title === "string" && message.title.trim() ? title : undefined);
		} else if (typeof message.document === "string" && message.document.trim()) {
			// A document: refused here, in a sentence, for a file a document page could not open.
			try {
				path = wire.boards.newDocBoard(wire.docs.openable(message.document.trim()));
			} catch (error) {
				reply({ type: "notice", level: "warn", text: (error as Error).message });
				return;
			}
		} else path = wire.boards.newBoard({ title, ...(size ? { size } : {}) });
		place(path);
		function place(path: string) {
			const { name, agent: onStage } = stageFor(message, wire);
			if (!onStage) {
				const at = message.at && Number.isFinite(message.at.x) && Number.isFinite(message.at.y) ? { [path]: { x: Math.round(message.at.x), y: Math.round(message.at.y) } } : undefined;
				if (name && wire.stage.pens) putOn(wire.stage.pens, wire.deck, name, [path], at ? { at } : {});
				if (typeof message.request === "string") reply({ type: "board.created", request: message.request, path });
				return;
			}
			const agent = onStage;
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
			const placed = wire.stageState(agent).boards.find((one) => one.path === path);
			if (placed) wire.send({ type: "board.changed", path: placed.path, rev: placed.rev, board: placed });
			// After the board is announced, so the asker already holds it when it hears the path.
			if (typeof message.request === "string") reply({ type: "board.created", request: message.request, path });
		}
	},

	"board.delete": (message, reply, wire) => {
		wire.boards.deleteBoard(message.path, reply);
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
} satisfies WirePart;
