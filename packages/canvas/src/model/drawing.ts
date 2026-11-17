import { apply, baseTheme, diff, editDocument, num as penNum, parse, type MeasureText, type PenDocument, type PenEdit, type PenNode } from "@decks/pen";
import type { Page } from "@decks/protocol";
import { createSignal, untrack, type Accessor } from "solid-js";
import { createDrawingEdits } from "./drawing-edits.ts";
import { createDrawingSync } from "./drawing-sync.ts";
import { createPending } from "./drawing-pending.ts";

/**
 * The edits that made a drawing from the one before it (`from`): the stage's engines apply them in
 * place of working out what changed, when `from` is the drawing they hold. A host that hears a
 * drawing's changes as edits (the Decks app's `canvas.changed`, a mounted canvas's own `onEdits`)
 * hands them along with the drawing they make.
 */
export interface DocEdits {
	from: import("@decks/pen").PenDocument;
	edits: readonly import("@decks/pen").PenEdit[];
}


/**
 * The drawing a canvas edits (`editor.tsx`): the document, the person's edits applied to it
 * with `@decks/pen` as the Decks server applies them (arrows routed again after each), their undo
 * and redo, and every change reported as the edits that make it (`diff`).
 *
 * No page in it, so it is tested on its own (`drawing.test.ts`).
 */
export interface Drawing {
	/** The drawing shown: the host's, with the person's edits still on their way to it on top (`DrawingOptions.host`). */
	doc: Accessor<PenDocument>;
	/** The drawing as the host last gave it, under any of the person's edits on their way: `doc` when there are none. */
	given: Accessor<PenDocument>;
	/** How many of the person's edits are shown ahead of the host's answer. */
	waiting: Accessor<number>;
	/** Pen operations, as the person's edit: applied, kept for undo, reported. False when refused or a no-op. */
	edit(ops: unknown[]): boolean;
	step(direction: "undo" | "redo"): void;
	/**
	 * A newer drawing from elsewhere: shown, not reported, and the person's undo starts again from it.
	 * `edits`, when the host has them, are what made it from the drawing held (`DocEdits`). With a host,
	 * `made` names the person's edits it is the first to have (`canvas.changed`'s `made`), which stop
	 * being shown on top of it; the others are shown on top still. `scope` names the drawing (the canvas):
	 * a drawing of another scope drops every edit on its way.
	 */
	set(next: string | PenDocument, edits?: DocEdits, made?: readonly string[], scope?: string): void;
	/**
	 * Edits from elsewhere (another device, an agent: what a host hears as a delta), applied to the
	 * drawing held as `set` would show the drawing they make, without the whole text parsed again.
	 * False when they do not apply to it: the host sends the whole drawing then (`set`).
	 */
	follow(edits: readonly PenEdit[], made?: readonly string[]): boolean;
	/** The host did not make the person's edit (or step) of this name: it is no longer shown. */
	refused(edit: string): void;
	/** The edits that made `doc` from the drawing before it, when it is the drawing now and they are known: the stage applies them. */
	editsTo(doc: PenDocument): DocEdits | undefined;
	/** Whether `doc` is the person's own edit or step, shown at once by their hand: nothing for the stage to glide. */
	ownTo(doc: PenDocument): boolean;
	/** A board on the drawing (by its deck path) moved or resized: its item moved or resized. */
	movePage(path: string, x: number, y: number): void;
	resizePage(path: string, size: { w: number; h: number }): void;
	/** A board taken off the drawing (its file is the host's business): its item deleted. */
	removePage(path: string): void;
}

export interface DrawingOptions {
	onEdits?: (edits: PenEdit[], doc: PenDocument) => void;
	/** The scheme the drawing's theme variables are read in. */
	look?: () => "light" | "dark";
	readOnly?: boolean;
	/** How many edits undo reaches back. */
	depth?: number;
	/**
	 * How words are measured to lay an edit out, as the host's server measures them: the stage
	 * engine's (`stage/measure.ts`), so a card sized by its words and the arrows joined to it come
	 * out where the server's drawing will have them. Default: pen's estimate.
	 */
	measure?: MeasureText;
	/**
	 * A drawing the host owns, as the Decks app's server owns its canvases: each edit is handed to
	 * `send` as pen operations with a name of its own (`edit`), and undo and redo are the host's too
	 * (`step`). The edit is shown at once, on top of the drawing the host last gave, until the host
	 * gives a drawing that says it has it (`set`'s `made`); so the person never sees the drawing as it
	 * was before their edit for the round trip. `send` may answer whether the edit was made: refused,
	 * it stops being shown at once; otherwise the host's drawing wins after `PENDING_MS`.
	 * Without a host the drawing is this page's: edits apply here at once, are reported to `onEdits`,
	 * and undo is kept here (Studio, a sharing site).
	 */
	host?: { send(ops: unknown[], edit?: string): void | Promise<boolean>; step(direction: "undo" | "redo", edit?: string): void };
}

/**
 * How long the person's edit is shown ahead of the host's drawing that has it, at most: a host that
 * never says it has it (an older server) or loses it shows its own drawing after this. Counted again
 * from the host's answer to the call that sent it, since the drawing comes by another way (the socket)
 * and may be behind other messages.
 */
export const PENDING_MS = 6000;

/**
 * A card's tag (drawn in a shadow root of the canvas's page, `card.ts`), or a document's or an app's,
 * items with no file of their own that the canvas places as it places a card.
 */
export const PAGE_TAGS = new Set(["decks.card", "decks.document", "decks.app"]);
/** A document or an app item: what it is, or nothing for a card. */
export const itemKind = (node: PenNode): "document" | "app" | undefined => {
	const type = (node.metadata as { type?: string } | undefined)?.type;
	return type === "decks.document" ? "document" : type === "decks.app" ? "app" : undefined;
};
export const isPage = (node: PenNode) => node.type === "browser" && PAGE_TAGS.has(String((node.metadata as { type?: string } | undefined)?.type));
const isCardItem = (node: PenNode) => node.type === "browser" && (node.metadata as { type?: string } | undefined)?.type === "decks.card";
const pagePath = (node: PenNode) => {
	const kind = itemKind(node);
	// An item is its own: its path is its id, so two of one file or app are two places.
	if (kind) return `item:${String(node.id)}`;
	return String((node.metadata as { path?: unknown }).path ?? node.id);
};
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/**
 * How a card's item frames it, from its own pen fields: its corners (`cornerRadius`, one number or
 * four, a variable resolved in the light theme) and whether it draws its own outline. The shadow and
 * the outline are painted with the drawing (`paint`'s `browser_frame`); the page only needs to round
 * its corners to the same shape and leave its own outline off.
 */
export function cardFrame(doc: PenDocument, node: PenNode): Pick<Page, "corners" | "outlined"> {
	const out: Pick<Page, "corners" | "outlined"> = {};
	const radius = (node as { cornerRadius?: unknown }).cornerRadius;
	if (radius !== undefined && radius !== null) {
		const theme = baseTheme(doc, "light");
		const list = Array.isArray(radius) ? radius : [radius, radius, radius, radius];
		const at = (i: number) => Math.max(0, penNum(doc, list[i] ?? list[0], theme, 0));
		out.corners = [at(0), at(1), at(2), at(3)];
	}
	const own = node as { stroke?: unknown; strokeWidth?: unknown };
	if ((own.stroke !== undefined && own.stroke !== null) || own.strokeWidth !== undefined) out.outlined = true;
	return out;
}

/** The drawing's boards, as the stage takes them. Top-level only: a board's x and y are the canvas's. */
export function pagesOf(doc: PenDocument): Page[] {
	const boards: Page[] = [];
	for (const node of doc.children ?? []) {
		if (!isPage(node)) continue;
		boards.push({
			path: pagePath(node),
			title: typeof node.name === "string" && node.name ? node.name : itemTitle(node) ?? pagePath(node),
			x: num(node.x, 0),
			y: num(node.y, 0),
			w: num(node.width, 960),
			h: num(node.height, 640),
			rev: 0,
			inContext: [],
			...(isCardItem(node) ? { card: true as const } : {}),
			...itemFields(node),
			...cardFrame(doc, node),
		});
	}
	return boards;
}

/**
 * A host's list of boards (its server's), with what the person's edits on their way do to them: a
 * board moved or sized on the drawing shown is where the drawing has it, and one taken off is gone,
 * until the host's drawing (`given`) and so its list have it too. Boards the edits do not touch, and
 * fields the drawing does not hold (a height the page raised), are the list's.
 */
export function pagesAhead(list: Page[], given: PenDocument, shown: PenDocument): Page[] {
	if (given === shown) return list;
	const byPath = (doc: PenDocument) => new Map(pagesOf(doc).map((board) => [board.path, board]));
	const was = byPath(given);
	const now = byPath(shown);
	const out: Page[] = [];
	for (const board of list) {
		const a = was.get(board.path);
		const b = now.get(board.path);
		if (a && !b) continue;
		if (!a || !b || (a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h)) {
			out.push(board);
			continue;
		}
		out.push({ ...board, x: b.x, y: b.y, ...(a.w !== b.w ? { w: b.w } : {}), ...(a.h !== b.h ? { h: b.h } : {}) });
	}
	return out;
}

/**
 * Edits made one after another, as one list of ops: run after run of plain updates (what the arrow keys,
 * a colour or a board's move write) folded into one update an item, each field as the last set it, and
 * anything else kept as it was, in order.
 */
export function together(edits: readonly (readonly unknown[])[]): unknown[] {
	const ops = edits.flat();
	const out: unknown[] = [];
	/** The updates since the last op that was not one, by item. */
	let run = new Map<string, { op: "update"; id: string; set: Record<string, unknown> }>();
	for (const op of ops) {
		const update = op as { op?: unknown; id?: unknown; set?: unknown };
		const plain = update.op === "update" && typeof update.id === "string" && update.set && typeof update.set === "object" && Object.keys(update).length === 3;
		if (!plain) {
			run = new Map();
			out.push(op);
			continue;
		}
		const held = run.get(update.id as string);
		if (held) Object.assign(held.set, update.set);
		else {
			const one = { op: "update" as const, id: update.id as string, set: { ...(update.set as Record<string, unknown>) } };
			run.set(one.id, one);
			out.push(one);
		}
	}
	return out;
}

/**
 * The person's edits sent and not yet in a drawing the host gave, oldest first: an edit's ops, or a
 * step's drawing (`to`, what the step makes of `base`, the host's drawing it was taken from).
 */
export type Pending = { id: string; ops?: unknown[]; to?: PenDocument; base?: PenDocument; timer?: ReturnType<typeof setTimeout>; as?: string };

/**
 * The person's steps through their own edits, as the host's drawings before and after each (the
 * host keeps the real history; this is to show a step ahead of its answer). Only what this page
 * saw end to end: any other change to the host's drawing empties it, as it makes the host refuse.
 */
export type Change = { before: PenDocument; after: PenDocument };

export function createDrawing(text: string | PenDocument, options: DrawingOptions = {}): Drawing {
	const look = options.look ?? (() => "light" as const);
	const depth = options.depth ?? 200;
	const first = typeof text === "string" ? parse(text) : text;
	const [doc, setDoc] = createSignal<PenDocument>(first);
	/** The person's own edits, to step back and forward through: each entry is the document before (undo) or after (redo). */
	const undoStack: PenDocument[] = [];
	const redoStack: PenDocument[] = [];

	const measure = options.measure;
	/**
	 * `ops` applied to `prev` as the server applies them; throws when refused. The arrows an edit
	 * touches are routed by the stage engine as it lays the edit out (`reroute_after`), as the server
	 * routes them, so the page lays nothing out for them here.
	 */
	const applied = (prev: PenDocument, ops: unknown[]) => apply(prev, ops as Parameters<typeof apply>[1], { theme: baseTheme(prev, look()), ...(measure ? { measure } : {}) }).doc;

	/** What made the drawing now from the one before, when known: `to` is the drawing they made. */
	let made: (DocEdits & { to: PenDocument }) | undefined;
	/** The drawing the person's own edit or step last made: shown at once, by their hand, so it is nothing to glide. */
	let ownDoc: PenDocument | undefined;
	const show = (next: PenDocument, edits?: DocEdits, own = true) => {
		made = edits ? { ...edits, to: next } : undefined;
		ownDoc = own ? next : undefined;
		setDoc(next);
	};
	/** Show `next` in place of what is shown, with what changed between them for the stage. */
	const showOver = (next: PenDocument) => {
		const now = untrack(doc);
		show(next, { from: now, edits: next === now ? [] : diff(now, next) });
	};

	/** Show `next` and tell the host what changed. */
	const commit = (prev: PenDocument, next: PenDocument) => {
		const edits = diff(prev, next);
		if (edits.length === 0) return false;
		show(next, { from: prev, edits });
		options.onEdits?.(edits, next);
		return true;
	};

	// ---- a drawing the host owns: the person's edits shown ahead of its answer ----
	const host = options.host;
	const pending = createPending({ first, look, measure, showOver });
	const { sent, wait, drop, given, setWaiting, forgetHistory, setGiven, history, onTop, nameOne, waiting } = pending;
	const { flush, receive } = createDrawingSync({
		host, sent, wait, drop, given, setWaiting, forgetHistory, setGiven, doc, history, depth, show, showOver, onTop,
		get inFlight() { return pending.inFlight; },
		set inFlight(next) { pending.inFlight = next; },
		get pending() { return pending.pending; },
		set pending(next) { pending.pending = next; },
		get stepsAfter() { return pending.stepsAfter; },
		set stepsAfter(next) { pending.stepsAfter = next; },
		get inFlightTimer() { return pending.inFlightTimer; },
		set inFlightTimer(next) { pending.inFlightTimer = next; },
		get scope() { return pending.scope; },
		set scope(next) { pending.scope = next; },
	});

	const { edit, step } = createDrawingEdits({
		options, doc, host, applied, nameOne, setWaiting, show, flush, commit, undoStack, depth, redoStack, given, history, wait, showOver,
		get pending() { return pending.pending; },
		get inFlight() { return pending.inFlight; },
		get stepsAfter() { return pending.stepsAfter; },
	});

	const pageId = (path: string) => untrack(doc).children?.find((node) => isPage(node) && pagePath(node) === path)?.id;

	return {
		doc,
		given: () => (host ? given() : doc()),
		waiting,
		edit,
		step,
		set(next, edits, madeHere, at) {
			const parsed = typeof next === "string" ? parse(next) : next;
			if (host) return receive(parsed, edits, madeHere, at);
			show(parsed, edits);
			undoStack.length = 0;
			redoStack.length = 0;
		},
		follow(edits, madeHere) {
			const now = untrack(host ? given : doc);
			let next: PenDocument;
			try {
				next = editDocument(now, edits);
			} catch {
				return false;
			}
			if (host) {
				receive(next, { from: now, edits }, madeHere, pending.scope);
				return true;
			}
			show(next, { from: now, edits });
			undoStack.length = 0;
			redoStack.length = 0;
			return true;
		},
		refused(id) {
			const what = sent.get(id);
			if (what?.step) forgetHistory();
			drop(id);
		},
		editsTo(at) {
			return made && made.to === at ? { from: made.from, edits: made.edits } : undefined;
		},
		ownTo(at) {
			return ownDoc === at;
		},
		movePage(path, x, y) {
			const id = pageId(path);
			if (id) edit([{ op: "update", id, set: { x: Math.round(x), y: Math.round(y) } }]);
		},
		removePage(path) {
			const id = pageId(path);
			if (id) edit([{ op: "delete", id }]);
		},
		resizePage(path, size) {
			const id = pageId(path);
			if (id) edit([{ op: "update", id, set: { width: Math.round(size.w), height: Math.round(size.h) } }]);
		},
	};
}

/** What a document or an app item adds to its board record: its kind, and its file or its app. */
function itemFields(node: PenNode): { item?: "document" | "app"; file?: string; app?: string } {
	const kind = itemKind(node);
	const meta = (node.metadata ?? {}) as { path?: unknown; name?: unknown };
	if (kind === "document") return { item: "document", file: String(meta.path ?? "") };
	if (kind === "app") return { item: "app", app: String(meta.name ?? "") };
	return {};
}

/** What a document or an app item is called when it has no name of its own: its file's name, or its app's. */
function itemTitle(node: PenNode): string | undefined {
	const meta = (node.metadata ?? {}) as { path?: unknown; name?: unknown };
	const kind = itemKind(node);
	if (kind === "document") return String(meta.path ?? "").split("/").pop() || undefined;
	if (kind === "app") return String(meta.name ?? "") || undefined;
	return undefined;
}
