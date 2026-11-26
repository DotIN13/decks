import assert from "node:assert/strict";
import { test } from "node:test";
import { freeSpot } from "./space.ts";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

test("an empty canvas has room at its corner", () => {
	assert.deepEqual(freeSpot([], { w: 100, h: 100 }), { x1: 0, y1: 0 });
});

test("near an item, room starts on its side, aligned, and steps past what is in the way", () => {
	const a = box(0, 0, 900, 400);
	assert.deepEqual(freeSpot([a], { w: 300, h: 200 }, { near: a }), { x1: 1060, y1: 0 });
	assert.deepEqual(freeSpot([a], { w: 300, h: 200 }, { near: a, side: "below" }), { x1: 0, y1: 560 });
	assert.deepEqual(freeSpot([a], { w: 300, h: 200 }, { near: a, side: "left" }), { x1: -460, y1: 0 });
	assert.deepEqual(freeSpot([a], { w: 300, h: 200 }, { near: a, side: "above", margin: 40 }), { x1: 0, y1: -240 });
	const b = box(1100, 100, 500, 500);
	assert.deepEqual(freeSpot([a, b], { w: 300, h: 200 }, { near: a }), { x1: 1760, y1: 0 });
});

test("with nothing named, the free spot nearest the middle of everything, clear by the margin", () => {
	const items = [box(0, 0, 400, 400), box(1000, 0, 400, 400)];
	// The middle (700, 200) has a 600 px gap: a 200 px box fits with 160 px each side.
	assert.deepEqual(freeSpot(items, { w: 200, h: 200 }), { x1: 600, y1: 100 });
	// A 400 px box does not; the nearest corner clear of both is above or below the middle.
	const spot = freeSpot(items, { w: 400, h: 200 });
	const grown = { x: spot.x1 - 160, y: spot.y1 - 160, w: 720, h: 520 };
	for (const item of items) assert.ok(!(grown.x < item.x + item.w && item.x < grown.x + grown.w && grown.y < item.y + item.h && item.y < grown.y + grown.h), JSON.stringify(spot));
	assert.ok(Math.abs(spot.x1 + 200 - 700) <= 300, JSON.stringify(spot));
});

test("aim, then step clear: a clear aim is kept; a taken one goes on its way, or to the nearest clear corner", async () => {
	const { stepClear } = await import("@decks/deck-kit");
	const a = box(0, 0, 400, 300);
	assert.deepEqual(stepClear([a], { w: 200, h: 200 }, { x1: 560, y1: 0 }, "right"), { x1: 560, y1: 0, past: 0 });
	const row = [a, box(600, 0, 300, 300), box(1000, 50, 300, 300)];
	// Right: past both, tops kept where the aim had them.
	assert.deepEqual(stepClear(row, { w: 200, h: 200 }, { x1: 560, y1: 0 }, "right"), { x1: 1460, y1: 0, past: 2 });
	// Down: past what is under, lefts kept.
	assert.deepEqual(stepClear([a, box(0, 500, 300, 300)], { w: 200, h: 200 }, { x1: 0, y1: 460 }, "down"), { x1: 0, y1: 960, past: 1 });
	// Near: the clear corner nearest the aim, clear by the margin.
	const near = stepClear([box(0, 0, 1000, 1000)], { w: 100, h: 100 }, { x1: 450, y1: 50 }, "near", 40);
	assert.deepEqual(near, { x1: 450, y1: -140, past: 1 });
});
