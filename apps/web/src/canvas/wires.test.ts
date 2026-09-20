import assert from "node:assert/strict";
import { test } from "node:test";
import { fence, LEAD, route } from "./wires.ts";

/*
 * The route of an arrow between two boards, worked out from where they are now.
 */

test("side by side, the arrow leaves the facing side and enters the other one", () => {
	const wire = route({ x: 0, y: 0, w: 100, h: 80 }, { x: 300, y: 0, w: 100, h: 80 });
	assert.equal(wire.d, `M100,40 H${300 - LEAD}`, "middles level: one straight run");
	assert.deepEqual(wire.end, { x: 300 - LEAD, y: 40, direction: "right" });
});

test("side by side at different heights, it bends twice and arrives at the target's middle", () => {
	const wire = route({ x: 0, y: 0, w: 100, h: 80 }, { x: 300, y: 200, w: 100, h: 80 });
	assert.match(wire.d, /^M100,40 H\d+(\.\d+)? V240 H290$/);
});

test("going left, it leaves the left side", () => {
	const wire = route({ x: 400, y: 0, w: 100, h: 80 }, { x: 0, y: 0, w: 100, h: 80 });
	assert.equal(wire.d, `M400,40 H${100 + LEAD}`);
	assert.equal(wire.end.direction, "left");
});

test("one above the other, it runs down from the bottom into the top", () => {
	const wire = route({ x: 0, y: 0, w: 100, h: 80 }, { x: 0, y: 300, w: 100, h: 80 });
	assert.equal(wire.d, `M50,80 V${300 - LEAD}`);
	assert.equal(wire.end.direction, "down");
});

test("the wider gap decides: a board far to the right and a little lower is side by side", () => {
	const wire = route({ x: 0, y: 0, w: 100, h: 80 }, { x: 600, y: 120, w: 100, h: 80 });
	assert.equal(wire.end.direction, "right");
});

test("overlapping boards still get a line, middle to middle", () => {
	const wire = route({ x: 0, y: 0, w: 100, h: 80 }, { x: 50, y: 40, w: 100, h: 80 });
	assert.equal(wire.d, "M50,40 L100,80");
});

test("a group's border takes in every member and leaves room for the title bars", () => {
	const border = fence([
		{ x: 0, y: 100, w: 200, h: 100 },
		{ x: 300, y: 100, w: 200, h: 300 },
	]);
	assert.deepEqual(border, { x: -28, y: 100 - 28 - 34, w: 500 + 56, h: 300 + 56 + 34 });
	assert.equal(fence([]), undefined);
});
