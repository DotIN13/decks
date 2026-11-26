/**
 * Where an item goes on a canvas. One rule, the same on a harness, on a service and in the page:
 * **aim, then step clear.**
 *
 * Every way an item arrives picks an aim, a top-left corner: 160 px right of another item, tops
 * level (`beside`); 160 px under it, left edges level (`below`); the middle of the person's view for
 * a drop; the middle of everything for room asked for with nothing named. Then `stepClear` moves it
 * on from that aim until the box, grown by the margin on every side, touches nothing already there:
 * further the same way for `beside` and `below` (so a row stays a row and a column a column), or to
 * the nearest clear corner for an aim that has no direction. A corner a caller names is the one
 * place that is not stepped: it is a decision, and what it covers is said instead (`blockers`).
 *
 * Nothing here knows about pen, cards or cameras: callers pass the boxes in the way.
 */

/** How far clear of another item `beside` and `below` put one, and the room kept round anything placed. */
export const GAP = 160;

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Which way a taken aim moves on: along a row or column, or to the nearest clear corner (`near`). */
export type StepWay = "right" | "left" | "down" | "up" | "near";

/** The corner a caller gave, `{ x1, y1 }` or `{ x, y }`, as two whole numbers; nothing when none was given. */
export function cornerOf(at: unknown): { x1: number; y1: number } | undefined {
	if (at === undefined || at === null) return undefined;
	const raw = at as { x1?: unknown; y1?: unknown; x?: unknown; y?: unknown };
	const x = raw.x1 ?? raw.x;
	const y = raw.y1 ?? raw.y;
	if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error("at is a top-left corner on the canvas, as in at: { x1: 1160, y1: 0 }.");
	return { x1: Math.round(x), y1: Math.round(y) };
}

/** The aim `beside` or `below` an item's box: `GAP` clear of it, tops (beside) or lefts (below) aligned. */
export function placeBy(box: Rect, how: "beside" | "below"): { x1: number; y1: number } {
	return how === "beside" ? { x1: Math.round(box.x + box.w + GAP), y1: Math.round(box.y) } : { x1: Math.round(box.x), y1: Math.round(box.y + box.h + GAP) };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The items a box of `size` at `at` would touch, the box grown by `margin` on every side (0: only what it covers). */
export function blockers<T extends Rect>(items: readonly T[], at: { x1: number; y1: number }, size: { w: number; h: number }, margin = GAP): T[] {
	const grown = { x: at.x1 - margin, y: at.y1 - margin, w: size.w + margin * 2, h: size.h + margin * 2 };
	return items.filter((item) => overlaps(grown, item));
}

/** The middle of everything in `items`, or the origin on an empty canvas. */
export function middleOf(items: readonly Rect[]): { x: number; y: number } {
	if (items.length === 0) return { x: 0, y: 0 };
	const left = Math.min(...items.map((b) => b.x));
	const top = Math.min(...items.map((b) => b.y));
	const right = Math.max(...items.map((b) => b.x + b.w));
	const bottom = Math.max(...items.map((b) => b.y + b.h));
	return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/**
 * From an aim, the first corner where a box of `size` is `margin` clear of every item: the aim
 * itself when it is clear. Along a row or column (`right`, `left`, `down`, `up`) each step jumps
 * past everything in the way, keeping the other edge where the aim had it; `near` takes the clear
 * corner whose middle is nearest the aim's, among the aim and the corners just clear of each
 * item's edges, so it lands snug against what is there rather than on a grid. `past` is how many
 * items it stepped past (0: the aim was clear).
 */
export function stepClear(items: readonly Rect[], size: { w: number; h: number }, aim: { x1: number; y1: number }, way: StepWay, margin = GAP): { x1: number; y1: number; past: number } {
	const { w, h } = size;
	const done = (x: number, y: number, past: number) => ({ x1: Math.round(x), y1: Math.round(y), past });
	const first = blockers(items, aim, size, margin);
	if (first.length === 0) return done(aim.x1, aim.y1, 0);
	if (way !== "near") {
		let x = aim.x1;
		let y = aim.y1;
		const passed = new Set<Rect>();
		// Every step passes at least one more item, so this ends within as many steps as there are items.
		for (let step = 0; step <= items.length; step++) {
			const inWay = blockers(items, { x1: x, y1: y }, size, margin);
			if (inWay.length === 0) break;
			for (const one of inWay) passed.add(one);
			if (way === "right") x = Math.max(...inWay.map((b) => b.x + b.w)) + margin;
			else if (way === "left") x = Math.min(...inWay.map((b) => b.x)) - margin - w;
			else if (way === "down") y = Math.max(...inWay.map((b) => b.y + b.h)) + margin;
			else y = Math.min(...inWay.map((b) => b.y)) - margin - h;
		}
		return done(x, y, passed.size);
	}
	const cx = aim.x1 + w / 2;
	const cy = aim.y1 + h / 2;
	const xs = [...new Set([aim.x1, ...items.flatMap((b) => [b.x + b.w + margin, b.x - margin - w, b.x])])];
	const ys = [...new Set([aim.y1, ...items.flatMap((b) => [b.y + b.h + margin, b.y - margin - h, b.y])])];
	const corners: Array<{ x: number; y: number; d: number }> = [];
	for (const x of xs) for (const y of ys) corners.push({ x, y, d: Math.hypot(x + w / 2 - cx, y + h / 2 - cy) });
	corners.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
	for (const corner of corners) if (blockers(items, { x1: corner.x, y1: corner.y }, size, margin).length === 0) return done(corner.x, corner.y, first.length);
	// Never reached (right of everything is always clear), but an answer all the same.
	return done(Math.max(...items.map((b) => b.x + b.w)) + margin, aim.y1, first.length);
}

/**
 * Room for a box of `size` without placing anything (`decks.canvas.space`): next to `near` on its
 * `side` (right by default), stepping on past what is in the way; with nothing named, the clear spot
 * nearest the middle of everything.
 */
export function freeSpot(items: readonly Rect[], size: { w: number; h: number }, options: { near?: Rect; side?: "right" | "below" | "left" | "above"; margin?: number } = {}): { x1: number; y1: number } {
	const margin = options.margin ?? GAP;
	const near = options.near;
	if (!near) {
		if (items.length === 0) return { x1: 0, y1: 0 };
		const middle = middleOf(items);
		const { x1, y1 } = stepClear(items, size, { x1: middle.x - size.w / 2, y1: middle.y - size.h / 2 }, "near", margin);
		return { x1, y1 };
	}
	const side = options.side ?? "right";
	const aim = {
		x1: side === "right" ? near.x + near.w + margin : side === "left" ? near.x - margin - size.w : near.x,
		y1: side === "below" ? near.y + near.h + margin : side === "above" ? near.y - margin - size.h : near.y,
	};
	const way: StepWay = side === "right" ? "right" : side === "left" ? "left" : side === "below" ? "down" : "up";
	const { x1, y1 } = stepClear(items, size, aim, way, margin);
	return { x1, y1 };
}
