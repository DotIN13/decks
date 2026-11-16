/**
 * Empty room on a canvas: the top-left corner of a box of a given size that, grown by a margin on
 * every side, touches nothing already there (`decks.canvas.space`).
 *
 * Next to an item (`near`), the box starts on the side asked for, tops aligned for left and right
 * and lefts for above and below, as `beside` and `below` place an item, and steps outward past
 * whatever is in the way until it is clear. With nothing named, it is the free spot whose centre is
 * closest to the centre of everything on the canvas, found among the corners that sit just clear
 * of an item's edge, so the answer sits snug against what is there rather than on a grid.
 */

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export type Side = "right" | "below" | "left" | "above";

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The items a box at (x, y), grown by `margin`, would touch. */
const blockers = (items: readonly Rect[], x: number, y: number, w: number, h: number, margin: number) => {
	const grown = { x: x - margin, y: y - margin, w: w + margin * 2, h: h + margin * 2 };
	return items.filter((item) => overlaps(grown, item));
};

export function freeSpot(items: readonly Rect[], size: { w: number; h: number }, options: { near?: Rect; side?: Side; margin?: number } = {}): { x1: number; y1: number } {
	const { w, h } = size;
	const margin = options.margin ?? 160;
	const done = (x: number, y: number) => ({ x1: Math.round(x), y1: Math.round(y) });
	const near = options.near;
	if (near) {
		const side = options.side ?? "right";
		let x = side === "right" ? near.x + near.w + margin : side === "left" ? near.x - margin - w : near.x;
		let y = side === "below" ? near.y + near.h + margin : side === "above" ? near.y - margin - h : near.y;
		// Every step passes at least one more item, so this ends within as many steps as there are items.
		for (let step = 0; step <= items.length; step++) {
			const inWay = blockers(items, x, y, w, h, margin);
			if (inWay.length === 0) break;
			if (side === "right") x = Math.max(...inWay.map((b) => b.x + b.w)) + margin;
			else if (side === "left") x = Math.min(...inWay.map((b) => b.x)) - margin - w;
			else if (side === "below") y = Math.max(...inWay.map((b) => b.y + b.h)) + margin;
			else y = Math.min(...inWay.map((b) => b.y)) - margin - h;
		}
		return done(x, y);
	}
	if (items.length === 0) return done(0, 0);
	const left = Math.min(...items.map((b) => b.x));
	const top = Math.min(...items.map((b) => b.y));
	const right = Math.max(...items.map((b) => b.x + b.w));
	const bottom = Math.max(...items.map((b) => b.y + b.h));
	const cx = (left + right) / 2;
	const cy = (top + bottom) / 2;
	// Corners just clear of each item's edges, and the one centred on everything.
	const xs = [...new Set([cx - w / 2, ...items.flatMap((b) => [b.x + b.w + margin, b.x - margin - w, b.x])])];
	const ys = [...new Set([cy - h / 2, ...items.flatMap((b) => [b.y + b.h + margin, b.y - margin - h, b.y])])];
	const corners: Array<{ x: number; y: number; d: number }> = [];
	for (const x of xs) for (const y of ys) corners.push({ x, y, d: Math.hypot(x + w / 2 - cx, y + h / 2 - cy) });
	corners.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
	for (const corner of corners) if (blockers(items, corner.x, corner.y, w, h, margin).length === 0) return done(corner.x, corner.y);
	// Never reached (right of everything is always clear), but an answer all the same.
	return done(right + margin, top);
}
