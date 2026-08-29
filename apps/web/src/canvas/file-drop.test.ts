import assert from "node:assert/strict";
import { test } from "node:test";
import { flow } from "./file-drop.ts";

/**
 * Where a batch of dropped files lands. The property worth pinning is the one a user
 * notices: no two components on top of each other, however many were dropped.
 */
const overlapping = (boxes: Array<{ left: number; top: number; width: number; height: number }>) =>
	boxes.some((a, i) =>
		boxes.some(
			(b, j) =>
				i !== j &&
				a.left < b.left + b.width &&
				b.left < a.left + a.width &&
				a.top < b.top + b.height &&
				b.top < a.top + a.height,
		),
	);

test("one file lands exactly at the drop point, snapped to the grid", () => {
	assert.deepEqual(flow([{ width: 320, height: 240 }], { x: 101, y: 199 }, 1200), [
		{ left: 104, top: 200, width: 320, height: 240 },
	]);
});

test("a batch flows rightwards and does not stack", () => {
	const boxes = flow(
		[
			{ width: 320, height: 240 },
			{ width: 200, height: 400 },
			{ width: 160, height: 120 },
		],
		{ x: 80, y: 80 },
		1200,
	);
	assert.deepEqual(
		boxes.map((box) => box.left),
		[80, 408, 616],
	);
	assert.deepEqual(
		boxes.map((box) => box.top),
		[80, 80, 80],
	);
	assert.equal(overlapping(boxes), false);
});

test("it wraps at the board's edge, under the tallest of the row", () => {
	const boxes = flow(
		[
			{ width: 400, height: 240 },
			{ width: 400, height: 480 },
			{ width: 400, height: 120 },
		],
		{ x: 80, y: 80 },
		1000,
	);
	// The third does not fit beside the first two (80 + 400 + 8 + 400 + 8 = 896, and
	// another 400 runs past 1000), so it starts a new row below the taller of them.
	assert.deepEqual(boxes[2], { left: 80, top: 568, width: 400, height: 120 });
	assert.equal(overlapping(boxes), false);
});

test("a component wider than the board overhangs rather than piling up", () => {
	const boxes = flow(
		[
			{ width: 900, height: 200 },
			{ width: 900, height: 200 },
		],
		{ x: 40, y: 40 },
		600,
	);
	assert.deepEqual(
		boxes.map((box) => box.top),
		[40, 248],
	);
	assert.equal(overlapping(boxes), false);
});
