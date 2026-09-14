/**
 * Where a board goes when nobody has said where.
 *
 * **Immediately to the right of the boards it belongs beside, top-aligned with them** — because
 * that is where the eye already is. The rule this replaces was *rows of three, below
 * everything*, which is a good way to lay out a directory and a poor way to answer an agent: on
 * a deck that has grown into regions, "below everything" is the far end of whichever column
 * happens to be lowest, so a board written in the middle of a conversation could appear
 * hundreds of thousands of pixels from anything anyone was looking at, and the person who asked
 * for it had to go and find it.
 *
 * Three things decide what it produces:
 *
 * - **The reference is what is *on the canvas*** — the boards in play, for a board an agent is
 *   writing; the arranged boards, for a deck being opened. Not the whole deck, which on a real
 *   one is every region at once and no place in particular.
 * - **A board with a position of its own is never moved here.** Whether a board counts as placed
 *   is the caller's question, not this file's: `Deck.arranged` answers it from `deck.json`, and
 *   the difference is the whole point — a position somebody chose is a decision, and a position
 *   nothing ever chose is free to change.
 * - **Nothing lands on top of anything.** A board put beside the ones in play can still land on
 *   a board nobody is looking at, so a spot that collides is walked downwards until it is clear.
 *
 * With nothing to sit beside — a deck opened for the first time, before anything has a place —
 * the origin does the same job as the reference boxes, which is the layout a fresh directory of
 * boards has always had.
 */

/** The space left between two boards, in either direction. */
export const GUTTER = 160;

/** How many boards a row holds, when a batch of them arrives at once. */
export const PER_ROW = 3;

/** A board's place and size: everything the arrangement is allowed to look at. */
export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Where each of `wanted` should go, in the order they were given. */
export function placeBeside(wanted: readonly Box[], reference: readonly Box[], taken: readonly Box[] = reference): Array<{ x: number; y: number }> {
	const spots: Array<{ x: number; y: number }> = [];
	if (wanted.length === 0) return spots;

	// The right-hand edge of everything to sit beside, and the top of it. Top-aligned rather
	// than centred: a column of boards beside a column of boards reads as one arrangement, and
	// the eye starts at the top of both.
	const right = reference.length > 0 ? Math.max(...reference.map((box) => box.x + box.w)) + GUTTER : 0;
	const top = reference.length > 0 ? Math.min(...reference.map((box) => box.y)) : 0;

	let x = right;
	let y = top;
	let rowHeight = 0;
	wanted.forEach((board, index) => {
		if (index > 0 && index % PER_ROW === 0) {
			x = right;
			y += rowHeight + GUTTER;
			rowHeight = 0;
		}
		let spot = { x, y };
		// Down until it is clear of everything already on the canvas, and of the earlier boards
		// of this same batch. Terminates because each step is at least one board's height.
		while (taken.some((other) => overlaps(spot, board, other)) || spots.some((other) => overlaps(spot, board, { ...other, w: board.w, h: board.h }))) {
			spot = { x, y: spot.y + board.h + GUTTER };
		}
		spots.push(spot);
		x += board.w + GUTTER;
		// A board pushed down carries the rest of its row with it, or the row would be a ragged
		// line and the next row would start inside it.
		rowHeight = Math.max(rowHeight, spot.y - y + board.h);
	});
	return spots;
}

/** Whether a board at `spot` would cover `other`. Touching edges are not an overlap. */
function overlaps(spot: { x: number; y: number }, board: Box, other: Box): boolean {
	return spot.x < other.x + other.w && other.x < spot.x + board.w && spot.y < other.y + other.h && other.y < spot.y + board.h;
}
