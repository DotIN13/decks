import assert from "node:assert/strict";
import { test } from "node:test";
import { freeSpot, GUTTER, joinPlaces, joinSpot, keepsPlace } from "./place.ts";

const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
	a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("the first board on an empty stage goes at the origin", () => {
	assert.deepEqual(joinSpot({ w: 1000, h: 600 }, undefined, []), { x: 0, y: 0 });
});

test("a board joins just right of the stage's newest board, top edges level", () => {
	const newest = { x: 5000, y: 2000, w: 1000, h: 800 };
	assert.deepEqual(joinSpot({ w: 1000, h: 600 }, newest, [newest]), { x: 5000 + 1000 + GUTTER, y: 2000 });
});

test("near means the newest board, not the far edge of all of them", () => {
	const old = { x: 20_000, y: 0, w: 1000, h: 800 };
	const newest = { x: 0, y: 0, w: 1000, h: 800 };
	const spot = joinSpot({ w: 1000, h: 800 }, newest, [old, newest]);
	assert.deepEqual(spot, { x: 1000 + GUTTER, y: 0 });
});

test("a taken slot sends the board to the nearest open one, clear of what is there", () => {
	const newest = { x: 0, y: 0, w: 1000, h: 800 };
	const note = { x: 1100, y: 0, w: 400, h: 300 };
	const spot = joinSpot({ w: 1000, h: 800 }, newest, [newest, note]);
	const landed = { ...spot, w: 1000, h: 800 };
	assert.equal(overlap(landed, note), false, "clear of the note drawn beside the board");
	assert.equal(overlap(landed, newest), false, "and of the board");
	assert.ok(Math.hypot(spot.x, spot.y) < 3000, `${JSON.stringify(spot)} is still beside it`);
});

test("drawn items are kept clear of, and a row of newcomers forms beside the newest board", () => {
	const spots = joinPlaces({
		wanted: ["a", "b", "c"],
		playing: ["a"],
		places: { a: { x: 0, y: 0 } },
		size: () => ({ w: 1000, h: 800 }),
		drawn: [{ x: 1100, y: 0, w: 400, h: 300 }],
	});
	const b = { ...spots.b!, w: 1000, h: 800 };
	const c = { ...spots.c!, w: 1000, h: 800 };
	assert.equal(overlap(b, { x: 1100, y: 0, w: 400, h: 300 }), false, "b misses the drawing");
	assert.equal(overlap(b, c), false, "b and c miss each other");
	assert.ok(Math.hypot(c.x - b.x, c.y - b.y) < 2500, "c sits beside b, the board placed just before it");
});

test("a place is kept when it is beside the stage's boards, and dropped when it is far from them", () => {
	const onCanvas = [{ x: 0, y: 0, w: 1000, h: 800 }];
	const size = { w: 1000, h: 800 };
	assert.equal(keepsPlace({ x: 1160, y: 0, ...size }, onCanvas), true, "one board along");
	assert.equal(keepsPlace({ x: 0, y: 900_000, ...size }, onCanvas), false, "the old deck-wide column");
	// Nothing on the stage is nothing to be far from, and a place is somebody's decision.
	assert.equal(keepsPlace({ x: 0, y: 900_000, ...size }, []), true, "the first board back on an empty stage");
});

test("with every candidate taken, a board goes to the right of everything rather than on top", () => {
	const wall = Array.from({ length: 4 }, (_, index) => ({ x: index * 1160, y: 0, w: 1000, h: 800 }));
	const spot = freeSpot({ x: 0, y: 0 }, { w: 1000, h: 800 }, wall);
	for (const box of wall) assert.equal(overlap({ ...spot, w: 1000, h: 800 }, box), false);
});

test("the nearest free spot wins, which is the short way round the board in the way", () => {
	const tall = { x: -500, y: -600, w: 1000, h: 1200 };
	const beside = freeSpot({ x: 0, y: 0 }, { w: 1000, h: 1200 }, [tall]);
	assert.ok(beside.x >= tall.x + tall.w, "a tall board is passed at the side: 1000 across beats 1200 down");
	assert.equal(beside.y, tall.y, "and kept in line with it");

	const wide = { x: -900, y: -300, w: 1800, h: 600 };
	const under = freeSpot({ x: 0, y: 0 }, { w: 1800, h: 600 }, [wide]);
	assert.ok(under.y >= wide.y + wide.h, "a wide one is passed underneath, for the same reason");
	assert.equal(under.x, wide.x, "and kept in line with it");
});

test("a place the caller names is kept exactly, however far or crowded, and the rest keep clear of it", () => {
	const spots = joinPlaces({
		wanted: ["a", "far", "onTop", "free"],
		playing: ["a"],
		places: { a: { x: 0, y: 0 } },
		size: () => ({ w: 1000, h: 800 }),
		at: { far: { x: 90_000, y: 40_000 }, onTop: { x: 100, y: 100 } },
	});
	assert.deepEqual(spots.far, { x: 90_000, y: 40_000 }, "far from everything, and kept");
	assert.deepEqual(spots.onTop, { x: 100, y: 100 }, "on top of a, and kept: saying so is the tool's job");
	const free = { ...spots.free!, w: 1000, h: 800 };
	for (const box of [{ x: 0, y: 0 }, spots.far!, spots.onTop!]) assert.equal(overlap(free, { ...box, w: 1000, h: 800 }), false, "the unnamed board misses all three");
});
