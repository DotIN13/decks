import { apply, arrowEndItem, withDecksColors, baseTheme, diff, editDocument, isArrow, parse, placements, reroute, walk, type Frame, type MeasureText, type PenDocument, type PenEdit, type PenNode, type Placed } from "@decks/pen";
import type { Board } from "@decks/protocol";
import { createSignal, untrack, type Accessor } from "solid-js";
import type { DocEdits } from "../render/types.ts";

/**
 * The drawing a mounted canvas edits (`mount.tsx`): the document, the person's edits applied to it
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
	 * `made` names the person's edits it is the first to have (`stage.pen.delta`'s `made`), which stop
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
	/** A board on the drawing (by its deck path) moved or resized: its item moved or resized. */
	moveBoard(path: string, x: number, y: number): void;
	/**
	 * `fixed`, for a card: whether the height it is given is the person's own, kept even when it cuts
	 * its content (`Board.fixedHeight`); undefined leaves it as it was.
	 */
	resizeBoard(path: string, size: { w: number; h: number }, fixed?: boolean): void;
	/**
	 * Pen operations that are nobody's edit (a card grown to its content): applied and reported as an
	 * edit is, but kept out of the undo, so the person's last step is still theirs. A drawing the host
	 * owns is left alone: its host makes such changes itself.
	 */
	settle(ops: unknown[]): boolean;
	/** A board taken off the drawing (its file is the host's business): its item deleted. */
	removeBoard(path: string): void;
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
 * A board's tag, or a card's: a card is a board drawn in a shadow root of the stage's page (`card.ts`);
 * or a document's or an app's, items with no file of their own that the stage places as it places a board.
 */
export const PAGE_TAGS = new Set(["decks.board", "decks.card", "decks.document", "decks.app"]);
/** A document or an app item: what it is, or nothing for a board or a card. */
export const itemKind = (node: PenNode): "document" | "app" | undefined => {
	const type = (node.metadata as { type?: string } | undefined)?.type;
	return type === "decks.document" ? "document" : type === "decks.app" ? "app" : undefined;
};
export const isBoard = (node: PenNode) => node.type === "browser" && PAGE_TAGS.has(String((node.metadata as { type?: string } | undefined)?.type));
export const isCardItem = (node: PenNode) => node.type === "browser" && (node.metadata as { type?: string } | undefined)?.type === "decks.card";
export const boardPath = (node: PenNode) => {
	const kind = itemKind(node);
	// An item is its own: its path is its id, so two of one file or app are two places.
	if (kind) return `item:${String(node.id)}`;
	return String((node.metadata as { path?: unknown }).path ?? node.id);
};
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** The drawing's boards, as the stage takes them. Top-level only: a board's x and y are the canvas's. */
export function boardsOf(doc: PenDocument): Board[] {
	const boards: Board[] = [];
	for (const node of doc.children ?? []) {
		if (!isBoard(node)) continue;
		boards.push({
			path: boardPath(node),
			title: typeof node.name === "string" && node.name ? node.name : itemTitle(node) ?? boardPath(node),
			x: num(node.x, 0),
			y: num(node.y, 0),
			w: num(node.width, 960),
			h: num(node.height, 640),
			rev: 0,
			inContext: [],
			...(isCardItem(node) ? { card: true as const } : {}),
			...(isCardItem(node) && fixedHeightOf(node) ? { fixedHeight: true as const } : {}),
			...itemFields(node),
		});
	}
	return boards;
}

/** Whether a card's item keeps the height the person gave it (`Board.fixedHeight`). */
const fixedHeightOf = (node: PenNode) => (node.metadata as { fixedHeight?: unknown } | undefined)?.fixedHeight === true;

/** A card's content as a frame last measured it: its height, laid out at width `w`. */
export interface CardHeight {
	w: number;
	h: number;
}

/** How far below its height a card's content has to be before it is taken back down: browsers read a pixel or two apart. */
const SHRINK_SLACK = 4;

/**
 * The height a card's item should have for content `h` tall, as the Decks server works it out
 * (`StagePens.raiseCard`): its content, rounded up, never under the height it had before it grew
 * (`grownFrom`, or its height when it has not grown), and left as it is for a few pixels less.
 */
export function cardHeight(height: number, grownFrom: unknown, h: number): number {
	const floor = typeof grownFrom === "number" ? grownFrom : height;
	const want = Math.max(floor, Math.ceil(h));
	return want > height || want < height - SHRINK_SLACK ? want : height;
}

/** A card item's height updated for content `h` tall (`cardHeight`), with its floor kept on it: the op, or nothing when it stays. */
export function cardHeightOp(node: PenNode, w: number, h: number): { op: "update"; id: string; set: Record<string, unknown> } | undefined {
	const meta = (node.metadata ?? {}) as Record<string, unknown>;
	if (!isCardItem(node) || meta.fixedHeight === true || typeof node.width !== "number" || typeof node.height !== "number" || Math.abs(node.width - w) > 1 || !(h > 0)) return undefined;
	const target = cardHeight(node.height, meta.grownFrom, h);
	if (target === node.height) return undefined;
	const floor = typeof meta.grownFrom === "number" ? meta.grownFrom : node.height;
	const { grownFrom: _was, ...rest } = meta;
	return { op: "update", id: node.id, set: { height: target, metadata: target > floor ? { ...rest, grownFrom: floor } : rest } };
}

/**
 * The boards as the stage draws them: each card as tall as its content (`heights`, what its frame
 * measured), never under the height its item had before it grew (`grownFrom`), unless its height is
 * the person's (`fixedHeight`, read off the drawing). A reading taken at another width is not this
 * card's yet (a resize is reflowing it), and a board that is one box filling it (`fills`) is the size
 * it was given.
 */
export function withContentHeights(list: readonly Board[], doc: PenDocument, heights: Readonly<Record<string, CardHeight>>): Board[] {
	const fixed = new Set<string>();
	const floors = new Map<string, number>();
	for (const node of walk(doc.children ?? [])) {
		if (!isCardItem(node)) continue;
		if (fixedHeightOf(node)) fixed.add(boardPath(node));
		const from = (node.metadata as { grownFrom?: unknown } | undefined)?.grownFrom;
		if (typeof from === "number") floors.set(boardPath(node), from);
	}
	return list.map((board) => {
		if (!board.card) return board;
		if (fixed.has(board.path)) return board.fixedHeight ? board : { ...board, fixedHeight: true as const };
		const { fixedHeight: _fixed, ...rest } = board;
		const measured = heights[board.path];
		const h = measured && !board.fills && Math.abs(measured.w - board.w) <= 1 ? cardHeight(board.h, floors.get(board.path), measured.h) : board.h;
		if (h === board.h) return board.fixedHeight ? rest : board;
		return { ...rest, h };
	});
}

/**
 * A host's list of boards (its server's), with what the person's edits on their way do to them: a
 * board moved or sized on the drawing shown is where the drawing has it, and one taken off is gone,
 * until the host's drawing (`given`) and so its list have it too. Boards the edits do not touch, and
 * fields the drawing does not hold (a height the page raised), are the list's.
 */
export function boardsAhead(list: Board[], given: PenDocument, shown: PenDocument): Board[] {
	if (given === shown) return list;
	const byPath = (doc: PenDocument) => new Map(boardsOf(doc).map((board) => [board.path, board]));
	const was = byPath(given);
	const now = byPath(shown);
	const out: Board[] = [];
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

export function createDrawing(text: string | PenDocument, options: DrawingOptions = {}): Drawing {
	const look = options.look ?? (() => "light" as const);
	const depth = options.depth ?? 200;
	const first = typeof text === "string" ? parse(text) : text;
	const [doc, setDoc] = createSignal<PenDocument>(first);
	/** The person's own edits, to step back and forward through: each entry is the document before (undo) or after (redo). */
	const undoStack: PenDocument[] = [];
	const redoStack: PenDocument[] = [];

	const measure = options.measure;
	/** Each drawing's layout, made once: an edit's drawing is the next edit's `prev`. */
	const laid = new WeakMap<PenDocument, ReadonlyMap<string, Placed>>();
	const layoutOf = (doc: PenDocument) => {
		let placed = laid.get(doc);
		if (!placed) laid.set(doc, (placed = placements(doc, { theme: baseTheme(doc, look()), ...(measure ? { measure } : {}) })));
		return placed;
	};
	const boardsBy = (doc: PenDocument, placed: ReadonlyMap<string, Placed>) => {
		const byPath = new Map<string, string>();
		for (const node of walk(doc.children ?? [])) if (isBoard(node)) byPath.set(boardPath(node), node.id);
		return (name: string): Frame | undefined => {
			const id = byPath.get(name);
			return id ? placed.get(id)?.box : undefined;
		};
	};
	/**
	 * Arrows follow what they join: after an edit (`next`, made from `prev`), the arrows it touches
	 * are routed again, as the Decks server routes them: one the edit made or changed, or with an end
	 * (or the frame it is in) that the edit moved or resized. The others are left as `prev` has them,
	 * which is as the server routed them: routed again here, on a layout of the page's own, any that
	 * differs from the server's by a pixel would move for the round trip and back when its drawing
	 * came, every arrow on the canvas at once.
	 */
	const rerouted = (prev: PenDocument, next: PenDocument) => {
		const placed = layoutOf(next);
		const before = layoutOf(prev);
		const prevBoard = boardsBy(prev, before);
		const nextBoard = boardsBy(next, placed);
		const prevNodes = new Map<string, PenNode>();
		for (const node of walk(prev.children ?? [])) prevNodes.set(node.id, node);
		const parents = new Map<string, string>();
		const note = (nodes: readonly PenNode[] | undefined, parent?: string) => {
			for (const node of nodes ?? []) {
				if (parent) parents.set(node.id, parent);
				note(node.children, node.id);
			}
		};
		note(next.children);
		const same = (a: Frame | undefined, b: Frame | undefined) => (!a && !b) || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
		const touched = (arrow: PenNode) => {
			const was = prevNodes.get(arrow.id);
			if (!was || !isArrow(was)) return true;
			for (const field of ["x", "y", "geometry", "strokeWidth"] as const) if (was[field] !== arrow[field]) return true;
			if (JSON.stringify(was.metadata) !== JSON.stringify(arrow.metadata)) return true;
			const meta = arrow.metadata as { from?: unknown; to?: unknown };
			const names = [arrowEndItem(meta.from), arrowEndItem(meta.to), parents.get(arrow.id)];
			return names.some((name) => name !== undefined && !same(before.get(name)?.box ?? prevBoard(name), placed.get(name)?.box ?? nextBoard(name)));
		};
		reroute(next, placed, nextBoard, undefined, touched);
		return next;
	};
	/** `ops` applied to `prev` as the server applies them, arrows routed again; throws when refused. */
	const applied = (prev: PenDocument, ops: unknown[]) => rerouted(prev, apply(prev, ops as Parameters<typeof apply>[1], { theme: baseTheme(prev, look()), ...(measure ? { measure } : {}) }).doc);

	/** What made the drawing now from the one before, when known: `to` is the drawing they made. */
	let made: (DocEdits & { to: PenDocument }) | undefined;
	const show = (next: PenDocument, edits?: DocEdits) => {
		made = edits ? { ...edits, to: next } : undefined;
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
	/** The drawing as the host last gave it. */
	const [given, setGiven] = createSignal<PenDocument>(first);
	const [waiting, setWaiting] = createSignal(0);
	let scope: string | undefined;
	/**
	 * The person's edits sent and not yet in a drawing the host gave, oldest first: an edit's ops, or a
	 * step's drawing (`to`, what the step makes of `base`, the host's drawing it was taken from).
	 */
	type Pending = { id: string; ops?: unknown[]; to?: PenDocument; base?: PenDocument; timer?: ReturnType<typeof setTimeout>; as?: string };
	let pending: Pending[] = [];
	/*
	 * One call to the host at a time, when its `send` answers: edits made while one is on its way wait
	 * here (shown already, `as` unset) and go together as one call once it is answered, so a held arrow
	 * key is a few calls a second rather than thirty, each made after the one before it (an edit names
	 * where things end up, so two overtaking each other on the way would leave the earlier one's).
	 * `as` is the name an edit went under: the first of the edits sent together.
	 */
	let inFlight: string | undefined;
	let inFlightTimer: ReturnType<typeof setTimeout> | undefined;
	/** Steps asked for while edits were still to go: sent after them, in order. */
	let stepsAfter: Array<() => void> = [];
	/**
	 * The person's steps through their own edits, as the host's drawings before and after each (the
	 * host keeps the real history; this is to show a step ahead of its answer). Only what this page
	 * saw end to end: any other change to the host's drawing empties it, as it makes the host refuse.
	 */
	type Change = { before: PenDocument; after: PenDocument };
	const history: { undo: Change[]; redo: Change[] } = { undo: [], redo: [] };
	/** Names this page gave its edits and steps, recent ones, and what each was. */
	const sent = new Map<string, { step?: "undo" | "redo"; change?: Change }>();
	const tab = Math.random().toString(36).slice(2, 8);
	let named = 0;
	const nameOne = (what: { step?: "undo" | "redo"; change?: Change }) => {
		const id = `${tab}.${++named}`;
		sent.set(id, what);
		if (sent.size > 400) sent.delete(sent.keys().next().value!);
		return id;
	};
	const forgetHistory = () => {
		history.undo = [];
		history.redo = [];
	};
	/** The host's drawing with the edits still on their way on top; an edit that no longer applies is the host's to decide, and goes. */
	const onTop = (base: PenDocument): PenDocument => {
		let next = base;
		let edited = false;
		const kept: Pending[] = [];
		for (const one of pending) {
			if (one.to) {
				// A step is shown over the host's drawing it was taken from, and over no other.
				if (one.base === base && kept.length === 0) {
					next = one.to;
					kept.push(one);
				} else clearTimeout(one.timer);
				continue;
			}
			try {
				next = apply(next, one.ops as Parameters<typeof apply>[1], { theme: baseTheme(next, look()), ...(measure ? { measure } : {}) }).doc;
				edited = true;
				kept.push(one);
			} catch {
				clearTimeout(one.timer);
			}
		}
		pending = kept;
		setWaiting(kept.length);
		// Arrows routed once over all of them, as each edit's own routing would leave them.
		return edited ? rerouted(base, next) : next;
	};
	/** An edit on its way is no longer shown: made by now, refused, or given up on. */
	const drop = (id: string) => {
		const gone = pending.filter((one) => one.id === id || one.as === id);
		if (!gone.length) return;
		for (const one of gone) clearTimeout(one.timer);
		pending = pending.filter((one) => !gone.includes(one));
		setWaiting(pending.length);
		showOver(onTop(untrack(given)));
	};
	const wait = (id: string, ms: number) => setTimeout(() => drop(id), ms);
	/** The edits waiting to go, sent as one call, when nothing is on its way; then any steps asked for after them. */
	const flush = () => {
		if (!host || inFlight) return;
		const going = pending.filter((one) => one.ops && !one.as);
		if (!going.length) {
			const steps = stepsAfter;
			stepsAfter = [];
			for (const step of steps) step();
			return;
		}
		const as = going[0]!.id;
		for (const one of going) {
			one.as = as;
			// Its name is the first's now: only that one is listened for.
			if (one.id !== as) sent.delete(one.id);
			clearTimeout(one.timer);
			one.timer = wait(as, PENDING_MS);
		}
		const answer = host.send(together(going.map((one) => one.ops!)), as);
		if (!answer || typeof (answer as Promise<boolean>).then !== "function") return flush();
		inFlight = as;
		const done = () => {
			if (inFlight !== as) return;
			inFlight = undefined;
			clearTimeout(inFlightTimer);
			flush();
		};
		// A call that never answers holds nothing up for longer than an edit is shown ahead.
		inFlightTimer = setTimeout(done, PENDING_MS);
		void (answer as Promise<boolean>).then(
			(ok) => {
				if (!ok) drop(as);
				else
					for (const one of pending)
						if (one.as === as) {
							// Made: the drawing that has it is on its way, however long the socket takes; given up on only after a while more.
							clearTimeout(one.timer);
							one.timer = wait(as, PENDING_MS);
						}
				done();
			},
			() => {
				drop(as);
				done();
			},
		);
	};
	/** The host's drawing came: what it has of the person's edits is no longer shown on top of it. */
	const receive = (next: PenDocument, edits: DocEdits | undefined, madeHere: readonly string[] | undefined, at: string | undefined) => {
		const before = untrack(given);
		if (at !== scope) {
			// Another canvas: nothing on its way belongs to it.
			scope = at;
			for (const one of pending) clearTimeout(one.timer);
			pending = [];
			stepsAfter = [];
			setWaiting(0);
			forgetHistory();
		}
		const ours = (madeHere ?? []).map((id) => [id, sent.get(id)] as const).filter((one) => one[1] !== undefined);
		if (next === before && !ours.length) return;
		setGiven(next);
		const wasShown = untrack(doc);
		const hadPending = pending.length > 0;
		// What the host's history now holds of the person's: their own edit or step, or nothing safe.
		if (!ours.length) {
			if (next !== before) forgetHistory();
		} else
			for (const [, what] of ours) {
				if (what!.step && what!.change) {
					// The step that was shown is made: its entry now ends on the drawing the host gave.
					if (what!.step === "undo") what!.change.before = next;
					else what!.change.after = next;
				} else if (!what!.step) {
					const change = { before, after: next };
					history.undo.push(change);
					if (history.undo.length > depth) history.undo.shift();
					history.redo = [];
				}
			}
		if (ours.length) {
			const done = new Set(ours.map(([id]) => id));
			// Heard once: a host that gives the same drawing again with the same names (`made` kept on it) changes nothing.
			for (const id of done) sent.delete(id);
			/*
			 * What it has, and every edit sent before the last of those: one call goes at a time, each
			 * answered after the host made it, so a drawing with a later one has the earlier ones too,
			 * even where its name was not passed on.
			 */
			const last = pending.findLastIndex((one) => done.has(one.as ?? one.id));
			const had = pending.filter((one, at) => done.has(one.as ?? one.id) || (at < last && one.as !== undefined && one.ops));
			for (const one of had) clearTimeout(one.timer);
			pending = pending.filter((one) => !had.includes(one));
		}
		if (!hadPending && pending.length === 0) {
			setWaiting(0);
			// Nothing was shown ahead: the host's drawing as it gave it, with its own edits when they follow from what is shown.
			show(next, edits && edits.from === wasShown ? edits : undefined);
			return;
		}
		showOver(onTop(next));
	};

	const edit = (given: unknown[]) => {
		if (options.readOnly || given.length === 0) return false;
		// What the tools make is coloured by the drawing's own light/dark variables: defined here when it lacks them.
		const ops = withDecksColors(untrack(doc), given);
		if (host) {
			const prev = untrack(doc);
			let next: PenDocument | undefined;
			try {
				next = applied(prev, ops);
			} catch {
				// Not one this page can make: the host's to answer, as it always was.
				next = undefined;
			}
			if (!next) {
				host.send(ops);
				return true;
			}
			const id = nameOne({});
			pending.push({ id, ops });
			setWaiting(pending.length);
			// Shown at once, even when nothing changed: the stage waits for the drawing that answers its gesture.
			show(next, { from: prev, edits: diff(prev, next) });
			flush();
			return true;
		}
		const prev = untrack(doc);
		let next: PenDocument;
		try {
			next = applied(prev, ops);
		} catch (error) {
			console.warn("[canvas] an edit was refused:", error instanceof Error ? error.message : error);
			return false;
		}
		if (!commit(prev, next)) {
			/*
			 * Nothing changed (an item dropped back where it was), but the stage is waiting for the drawing
			 * that answers its gesture, as a server sends one whatever the edit did: a fresh copy is that
			 * answer, so what was let go glides back into place now rather than when the stage gives up.
			 */
			show({ ...prev }, { from: prev, edits: [] });
			return false;
		}
		undoStack.push(prev);
		if (undoStack.length > depth) undoStack.shift();
		redoStack.length = 0;
		return true;
	};

	const step = (direction: "undo" | "redo") => {
		if (host) {
			const base = untrack(given);
			const stack = direction === "undo" ? history.undo : history.redo;
			const change = stack[stack.length - 1];
			// Shown ahead only when this page saw the edit it steps through and nothing else since.
			if (!pending.length && change && (direction === "undo" ? change.after : change.before) === base) {
				stack.pop();
				(direction === "undo" ? history.redo : history.undo).push(change);
				const to = direction === "undo" ? change.before : change.after;
				const id = nameOne({ step: direction, change });
				pending.push({ id, to, base, timer: wait(id, PENDING_MS) });
				setWaiting(pending.length);
				showOver(to);
				host.step(direction, id);
				return;
			}
			// After the edits still to go, which the host's history has to have first.
			if (inFlight || pending.some((one) => one.ops && !one.as)) stepsAfter.push(() => host.step(direction));
			else host.step(direction);
			return;
		}
		const from = direction === "undo" ? undoStack : redoStack;
		const to = direction === "undo" ? redoStack : undoStack;
		const target = from.pop();
		if (!target) return;
		const now = untrack(doc);
		to.push(now);
		commit(now, target);
	};

	const boardId = (path: string) => untrack(doc).children?.find((node) => isBoard(node) && boardPath(node) === path)?.id;

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
				receive(next, { from: now, edits }, madeHere, scope);
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
		moveBoard(path, x, y) {
			const id = boardId(path);
			if (id) edit([{ op: "update", id, set: { x: Math.round(x), y: Math.round(y) } }]);
		},
		removeBoard(path) {
			const id = boardId(path);
			if (id) edit([{ op: "delete", id }]);
		},
		resizeBoard(path, size, fixed) {
			const node = untrack(doc).children?.find((one) => isBoard(one) && boardPath(one) === path);
			if (!node) return;
			const set: Record<string, unknown> = { width: Math.round(size.w), height: Math.round(size.h) };
			// A card's height given by hand is its floor (or, cutting it, kept): not one it grew to.
			const meta = (node.metadata ?? {}) as Record<string, unknown>;
			if (isCardItem(node) && ((fixed !== undefined && fixedHeightOf(node) !== fixed) || "grownFrom" in meta)) {
				const { fixedHeight: _was, grownFrom: _from, ...metadata } = meta;
				const keep = fixed ?? fixedHeightOf(node);
				set.metadata = keep ? { ...metadata, fixedHeight: true } : metadata;
			}
			edit([{ op: "update", id: node.id, set }]);
		},
		settle(ops) {
			if (host || options.readOnly || ops.length === 0) return false;
			const prev = untrack(doc);
			let next: PenDocument;
			try {
				next = applied(prev, ops);
			} catch {
				return false;
			}
			if (!commit(prev, next)) return false;
			// The person's last step is taken as having made it too: undoing that step keeps it.
			const last = undoStack[undoStack.length - 1];
			try {
				if (last) undoStack[undoStack.length - 1] = applied(last, ops);
			} catch {
				/* not in the drawing that step began from: undoing it puts back what it had */
			}
			return true;
		},
	};
}

/** What a document or an app item adds to its board record: its kind, and its file or its app. */
export function itemFields(node: PenNode): { item?: "document" | "app"; file?: string; app?: string } {
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
