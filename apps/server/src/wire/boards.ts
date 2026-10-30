import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import type { WireContext, WirePart } from "./context.ts";
import { isAbsolute, relative } from "node:path";
import { asPerson, personAgent } from "../verbs/person.ts";
import { putOn } from "../stage/canvas-ops.ts";
import { joinSpot } from "../deck/place.ts";

/** A document item's size when it is made: a page and its bar (`verbs/canvas.ts`). */
const DOCUMENT_SIZE = { w: 1000, h: 1100 };

/**
 * The board frames: the user's half of the canvas, and the two ways the past comes back.
 *
 * This is where the *user* touches a board — move, play, hide, delete — and puts a document on
 * the canvas. A board's own page is never edited from the canvas. The agent's writes do not come through
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
		 * Kept for the agent who asks (`decks.canvas.fit`, and what it reports) and nothing else. A browser's
		 * reading never sizes a board: the size is the stage file's, set by `decks.canvas.fit`, `decks.canvas.update` or a drag.
		 * Two browsers with different fonts read the same board a pixel or two apart, and when both
		 * readings sized it, each answered the other's for ever.
		 */
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
	 * A document put on the canvas from the file picker: an item that opens the file as a page you type
	 * into (`decks.document`), with no file of its own, at the point asked for or beside the newest thing
	 * on the canvas. Inserted as the person's own `canvas.insert` on the stage on screen. The file is named
	 * as the deck names it: from the deck when it is inside, else absolute; a Google Doc by its mirror.
	 */
	"document.create": (message, reply, wire) => {
		const place = (file: string, title?: string) => {
			// Real paths both, since a deck under a link (macOS's /var is /private/var) names its files either way.
			const real = (one: string) => {
				try {
					return realpathSync(one);
				} catch {
					return one;
				}
			};
			const inside = relative(real(wire.deck.path), real(file));
			const path = !inside.startsWith("..") && !isAbsolute(inside) ? inside.split("\\").join("/") : file;
			const { name } = stageFor(message, wire);
			if (!name) return reply({ type: "notice", level: "warn", text: "There is no canvas on screen to put the document on." });
			const asked = message.at && Number.isFinite(message.at.x) && Number.isFinite(message.at.y) ? { x1: Math.round(message.at.x), y1: Math.round(message.at.y) } : undefined;
			// No point named (the toolbar's button): the open slot beside the canvas's newest card, as a card joins it (`deck/place.ts`).
			const at = asked ?? joined(name);
			void personAgent({ agents: wire.agents, pens: wire.stage.pens }, { stage: name })
				.personTool()
				.call("canvas.insert", [{ type: "document", path, ...(title ? { title } : {}) }, { canvas: name, ...(at ? { at } : {}) }])
				.then((answer) => {
					if (!answer.ok) return reply({ type: "notice", level: "warn", text: answer.error ?? "The document could not be put on the canvas." });
					const id = (answer.value as { id?: unknown } | undefined)?.id;
					if (typeof message.request === "string" && typeof id === "string") reply({ type: "document.created", request: message.request, path: `item:${id}` });
				});
		};
		const joined = (name: string) => {
			const pens = wire.stage.pens;
			if (!pens) return undefined;
			try {
				const boards = pens.boards(name);
				const spot = joinSpot(DOCUMENT_SIZE, boards.at(-1), [...boards, ...pens.drawn(name)]);
				return { x1: spot.x, y1: spot.y };
			} catch {
				return undefined;
			}
		};
		// A Google Doc: linked first, which asks Google, so the item is made when the answer is in.
		if (typeof message.google === "string" && message.google.trim()) {
			// Named as the Doc is in Google, as its board was; the item opens its mirror.
			void wire.google.link(message.google.trim()).then(
				(mirror) => place(mirror, wire.google.remote(mirror)?.title),
				(error: Error) => reply({ type: "notice", level: "warn", text: error.message }),
			);
			return;
		}
		if (typeof message.document !== "string" || !message.document.trim()) return;
		// Refused here, in a sentence, for a file a document item could not open.
		let file: string;
		try {
			file = wire.docs.openable(message.document.trim());
		} catch (error) {
			reply({ type: "notice", level: "warn", text: (error as Error).message });
			return;
		}
		place(file);
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
