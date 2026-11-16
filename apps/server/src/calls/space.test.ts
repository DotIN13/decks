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
