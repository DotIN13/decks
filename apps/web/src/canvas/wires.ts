/**
 * Where an arrow between two boards runs, and where a group's dashed border goes.
 *
 * An arrow belongs to the canvas, not to either board, so it has to be worked out from where
 * the boards are *now* — after a drag, and after a board grows because its contents were
 * measured. That is why nothing about a line is stored but its two ends: the route is this
 * function, run again whenever a board moves.
 *
 * The route is orthogonal, the way the design boards draw them: it leaves the side of one board
 * that faces the other and enters the facing side, with one bend or two. Pure, so the cases —
 * side by side, one above the other, overlapping — are tested without a canvas.
 */

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Wire {
	/** An SVG path in world coordinates. */
	d: string;
	/** Where a label sits: the middle of the longest straight run. */
	label: { x: number; y: number };
	/** The end, so an arrowhead can be drawn pointing into the board. */
	end: { x: number; y: number; direction: "left" | "right" | "up" | "down" };
}

/** Room left between a line and the board it enters, so the arrowhead is not under the frame. */
export const LEAD = 10;

/**
 * An arrow from one board to another.
 *
 * **Side by side** when the gap between them is wider than it is tall: out of the facing side at
 * the source's middle, across, and into the target's facing side at its middle — a straight line
 * when the middles line up, two bends when they do not. **One above the other** otherwise, by the
 * same rule turned on its side. Boards that overlap still get a line, from middle to middle,
 * because a person who drew an arrow between two boards should see it even while they are
 * dragging one over the other.
 */
export function route(from: Rect, to: Rect): Wire {
	const a = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
	const b = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
	const gapX = Math.max(to.x - (from.x + from.w), from.x - (to.x + to.w));
	const gapY = Math.max(to.y - (from.y + from.h), from.y - (to.y + to.h));

	if (gapX <= 0 && gapY <= 0) {
		return { d: `M${a.x},${a.y} L${b.x},${b.y}`, label: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, end: { x: b.x, y: b.y, direction: b.x >= a.x ? "right" : "left" } };
	}

	if (gapX >= gapY) {
		const rightward = b.x > a.x;
		const startX = rightward ? from.x + from.w : from.x;
		const endX = rightward ? to.x - LEAD : to.x + to.w + LEAD;
		const midX = (startX + endX) / 2;
		const d = a.y === b.y ? `M${startX},${a.y} H${endX}` : `M${startX},${a.y} H${midX} V${b.y} H${endX}`;
		return { d, label: { x: (startX + midX) / 2, y: a.y }, end: { x: endX, y: b.y, direction: rightward ? "right" : "left" } };
	}

	const downward = b.y > a.y;
	const startY = downward ? from.y + from.h : from.y;
	const endY = downward ? to.y - LEAD : to.y + to.h + LEAD;
	const midY = (startY + endY) / 2;
	const d = a.x === b.x ? `M${a.x},${startY} V${endY}` : `M${a.x},${startY} V${midY} H${b.x} V${endY}`;
	return { d, label: { x: (a.x + b.x) / 2, y: midY }, end: { x: b.x, y: endY, direction: downward ? "down" : "up" } };
}

/**
 * The dashed border round a group: the members' bounds, with air.
 *
 * More air on top, because every board on the canvas has its title bar above its frame, and a
 * border that cut through the titles would fence the boards and not their names.
 */
export function fence(boards: readonly Rect[], air = 28, bar = 34): Rect | undefined {
	if (boards.length === 0) return undefined;
	const left = Math.min(...boards.map((board) => board.x));
	const top = Math.min(...boards.map((board) => board.y));
	const right = Math.max(...boards.map((board) => board.x + board.w));
	const bottom = Math.max(...boards.map((board) => board.y + board.h));
	return { x: left - air, y: top - air - bar, w: right - left + air * 2, h: bottom - top + air * 2 + bar };
}
