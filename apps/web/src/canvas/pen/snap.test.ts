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
