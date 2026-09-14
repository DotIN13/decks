import assert from "node:assert/strict";
import { test } from "node:test";
import { GUTTER, placeBeside } from "./layout.ts";

/**
 * Where a board goes when nobody has said.
 *
 * The rule is *to the right of the ones it belongs beside, top-aligned with them*, and each
 * case below is one of the ways that could have been got wrong: sitting below the deck (what it
 * replaced), jumping a width because the board is in its own reference list, covering a board
 * that happens to be in the way, or overlapping the rest of its own batch.
 */

const box = (x: number, y: number, w = 400, h = 300) => ({ x, y, w, h });

test("a board goes to the right of the one it belongs beside, aligned with its top", () => {
	const beside = box(100, 50, 400, 300);
	assert.deepEqual(placeBeside([box(0, 0, 300, 200)], [beside]), [{ x: 100 + 400 + GUTTER, y: 50 }]);
});

test("…right of all of them, and level with the highest", () => {
	// Three boards in a column of regions, at very different heights: the answer is the right
	// edge of the widest-thinking arrangement and the top of it — not the bottom of the deck,
	// which is what this replaced and what made a new board appear in another region entirely.
	const reference = [box(0, 0, 400, 300), box(0, 900, 400, 300), box(0, 5_000, 900, 300)];
	assert.deepEqual(placeBeside([box(0, 0, 300, 200)], reference), [{ x: 900 + GUTTER, y: 0 }]);
});

test("a batch flows in rows of three, starting at the right", () => {
	const beside = box(0, 0, 400, 300);
	const wanted = Array.from({ length: 4 }, () => box(0, 0, 300, 200));
	const spots = placeBeside(wanted, [beside]);

	const right = 400 + GUTTER;
	assert.deepEqual(spots[0], { x: right, y: 0 });
	assert.deepEqual(spots[1], { x: right + 300 + GUTTER, y: 0 });
	assert.deepEqual(spots[2], { x: right + 2 * (300 + GUTTER), y: 0 });
	// The fourth wraps under the first, not under the whole row.
	assert.deepEqual(spots[3], { x: right, y: 200 + GUTTER });
});

test("a spot that is already taken is walked downwards until it is clear", () => {
	const beside = box(0, 0, 400, 300);
	// A board nobody is looking at, sitting exactly where the new one would go.
	const inTheWay = box(400 + GUTTER, 0, 300, 200);
	const spots = placeBeside([box(0, 0, 300, 200)], [beside], [beside, inTheWay]);
	assert.deepEqual(spots, [{ x: 400 + GUTTER, y: 200 + GUTTER }]);
});

test("…including on top of another board of the same batch", () => {
	// Two boards of the batch at the same place: the second is pushed below the first, which is
	// also what the `taken` check does for a board already on the canvas.
	const spots = placeBeside([box(0, 0, 300, 200), box(0, 0, 300, 200)], [box(0, 0, 400, 300)], []);
	assert.equal(spots[0]?.y, 0);
	assert.equal(spots[1]?.y, 0);
	assert.notDeepEqual(spots[0], spots[1], "the second is not on the first");
	assert.equal(spots[1]?.x, spots[0]!.x + 300 + GUTTER, "and it is beside it rather than under it");
});

test("with nothing to sit beside, the origin does the same job", () => {
	// A deck opened for the first time: no arrangement to be to the right of, which is the
	// layout a fresh directory of boards has always had.
	assert.deepEqual(placeBeside([box(0, 0, 300, 200)], []), [{ x: 0, y: 0 }]);
	const many = Array.from({ length: 4 }, () => box(0, 0, 300, 200));
	assert.deepEqual(placeBeside(many, []).map((spot) => spot.y), [0, 0, 0, 200 + GUTTER]);
});

test("nothing wanted is nothing answered", () => {
	assert.deepEqual(placeBeside([], [box(0, 0)]), []);
});
