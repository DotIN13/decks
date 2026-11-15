import assert from "node:assert/strict";
import { test } from "node:test";
import { snapEdges, snapMove } from "./snap.ts";

test("a moved box lines its edge up with a neighbour's within the threshold, and says so with a guide", () => {
	const other = { x: 0, y: 0, w: 100, h: 50 };
	const { dx, dy, guides } = snapMove({ x: 3, y: 200, w: 80, h: 40 }, [other], 6);
	assert.equal(dx, -3);
	assert.equal(dy, 0);
	assert.ok(guides.some((g) => g.kind === "line" && g.x1 === 0 && g.x2 === 0 && g.y1 === 0 && g.y2 === 240));
});

test("nothing near enough is no snap and no guide", () => {
	const { dx, dy, guides } = snapMove({ x: 30, y: 200, w: 80, h: 40 }, [{ x: 0, y: 0, w: 100, h: 50 }], 6);
	assert.deepEqual([dx, dy, guides.length], [0, 0, 0]);
});

test("a box settles into the gap two others keep, and between two at equal distance", () => {
	const a = { x: 0, y: 0, w: 100, h: 50 };
	const b = { x: 140, y: 0, w: 100, h: 50 };
	// After b by b's gap of 40: 280.
	const after = snapMove({ x: 284, y: 10, w: 60, h: 30 }, [a, b], 6);
	assert.equal(after.dx, -4);
	assert.equal(after.guides.filter((g) => g.kind === "gap").length, 2);
	// Centred between a and c: a ends at 100, c starts at 300, a 60-wide box sits at 170.
	const c = { x: 300, y: 0, w: 100, h: 50 };
	const between = snapMove({ x: 173, y: 10, w: 60, h: 30 }, [a, c], 6);
	assert.equal(between.dx, -3);
	assert.equal(between.guides.filter((g) => g.kind === "gap").length, 2);
});

test("a resize pulls only the edges it moves", () => {
	const { box, guides } = snapEdges({ x1: 10, y1: 10, x2: 97, y2: 60 }, ["x2"], [{ x: 0, y: 200, w: 100, h: 50 }], 6);
	assert.deepEqual(box, { x1: 10, y1: 10, x2: 100, y2: 60 });
	assert.equal(guides.length, 1);
});

test("an alignment marks every point on it that lines up: each box's corners and middle on the line", () => {
	const other = { x: 0, y: 0, w: 100, h: 50 };
	const { guides } = snapMove({ x: 3, y: 200, w: 80, h: 40 }, [other], 5);
	const left = guides.find((g) => g.kind === "line" && g.x1 === 0 && g.x2 === 0);
	assert.deepEqual(left?.points, [
		{ x: 0, y: 200 },
		{ x: 0, y: 220 },
		{ x: 0, y: 240 },
		{ x: 0, y: 0 },
		{ x: 0, y: 25 },
		{ x: 0, y: 50 },
	]);
});

test("a board keeps the reading gap: 160 beside, above or below another, marked with its size", () => {
	const board = { x: 0, y: 0, w: 400, h: 300 };
	// 3 short of 160 to the right of it: it settles at 560.
	const right = snapMove({ x: 557, y: 40, w: 400, h: 300 }, [], 5, [board]);
	assert.equal(right.dx, 3);
	assert.deepEqual(right.guides, [{ kind: "gap", x1: 400, y1: 170, x2: 560, y2: 170, label: "160" }]);
	// 4 past 160 above it: the bottom settles 160 over its top.
	const above = snapMove({ x: 0, y: -464, w: 400, h: 300 }, [], 5, [board]);
	assert.equal(above.dy, 4);
	assert.deepEqual(above.guides.find((g) => g.label), { kind: "gap", x1: 200, y1: -160, x2: 200, y2: 0, label: "160" });
	// Further than the reach: nothing.
	assert.deepEqual(snapMove({ x: 570, y: 40, w: 400, h: 300 }, [], 5, [board]).guides, []);
});
