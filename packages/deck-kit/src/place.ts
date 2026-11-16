/**
 * Where an item goes when a caller says "beside" or "below" another, and how a caller names a corner.
 * The same on a harness and on a service, so a card put beside another lands in one place.
 */

/** How far clear of another item `beside` and `below` put one. */
export const GAP = 160;

/** The corner a caller gave, `{ x1, y1 }` or `{ x, y }`, as two whole numbers; nothing when none was given. */
export function cornerOf(at: unknown): { x1: number; y1: number } | undefined {
	if (at === undefined || at === null) return undefined;
	const raw = at as { x1?: unknown; y1?: unknown; x?: unknown; y?: unknown };
	const x = raw.x1 ?? raw.x;
	const y = raw.y1 ?? raw.y;
	if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error("at is a top-left corner on the canvas, as in at: { x1: 1160, y1: 0 }.");
	return { x1: Math.round(x), y1: Math.round(y) };
}

/** The corner `beside` or `below` an item's box: `GAP` clear of it, tops (beside) or lefts (below) aligned. */
export function placeBy(box: { x: number; y: number; w: number; h: number }, how: "beside" | "below"): { x1: number; y1: number } {
	return how === "beside" ? { x1: Math.round(box.x + box.w + GAP), y1: Math.round(box.y) } : { x1: Math.round(box.x), y1: Math.round(box.y + box.h + GAP) };
}
