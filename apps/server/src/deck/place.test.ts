import assert from "node:assert/strict";
import { test } from "node:test";
import { freeSpot, joinSpot, keepsPlace, viewBox } from "./place.ts";

const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
	a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("a board joins in the middle of the view when the canvas is empty there", () => {
	const camera = { x: 4000, y: 4000, zoom: 1, width: 1440, height: 900 };
	const spot = joinSpot({ w: 1000, h: 600 }, [], camera);
	assert.deepEqual(spot, { x: 3500, y: 3700 }, "centred on the point the camera is looking at");
});

test("a board aimed at an occupied spot lands beside it, not on it", () => {
	const camera = { x: 0, y: 0, zoom: 1, width: 1440, height: 900 };
	const there = { x: -500, y: -400, w: 1000, h: 800 };
	const spot = joinSpot({ w: 1000, h: 800 }, [there], camera);
	const landed = { ...spot, w: 1000, h: 800 };
	assert.equal(overlap(landed, there), false, "clear of the board already on the canvas");
	// And near it: within a gutter of one of its edges, rather than at the bottom of the deck.
	assert.ok(Math.abs(landed.x - (there.x + there.w)) <= 160 || Math.abs(landed.y - (there.y + there.h)) <= 160);
});

test("a camera reports the world it can see, and zoom widens it", () => {
	const near = viewBox({ x: 0, y: 0, zoom: 1, width: 1000, height: 500 });
	const far = viewBox({ x: 0, y: 0, zoom: 0.5, width: 1000, height: 500 });
	assert.deepEqual(near, { x: -500, y: -250, w: 1000, h: 500 });
	assert.deepEqual(far, { x: -1000, y: -500, w: 2000, h: 1000 });
});

test("a place is kept when it is visible or beside the canvas, and dropped when it is neither", () => {
	const camera = { x: 0, y: 0, zoom: 1, width: 1440, height: 900 };
	const onCanvas = [{ x: 0, y: 0, w: 1000, h: 800 }];
	const size = { w: 1000, h: 800 };
	assert.equal(keepsPlace({ x: 0, y: 0, ...size }, onCanvas, camera), true, "where you are looking");
	assert.equal(keepsPlace({ x: 1160, y: 0, ...size }, onCanvas, camera), true, "one board along from the canvas");
	assert.equal(keepsPlace({ x: 0, y: 900_000, ...size }, onCanvas, camera), false, "the old deck-wide column");
	// Nothing on the canvas is nothing to be far from, and a place is somebody's decision.
	assert.equal(keepsPlace({ x: 0, y: 900_000, ...size }, [], camera), true, "the first board back on an empty canvas");
});

test("with every candidate taken, a board goes to the right of everything rather than on top", () => {
	const wall = Array.from({ length: 4 }, (_, index) => ({ x: index * 1160, y: 0, w: 1000, h: 800 }));
	const spot = freeSpot({ x: 0, y: 0 }, { w: 1000, h: 800 }, wall);
	for (const box of wall) assert.equal(overlap({ ...spot, w: 1000, h: 800 }, box), false);
});

test("the nearest free spot wins, which is the short way round the board in the way", () => {
	const camera = { x: 0, y: 0, zoom: 1, width: 1440, height: 900 };
	// The anchor is the middle of the board already there, which is what "you are looking at it" means.
	const tall = { x: -500, y: -600, w: 1000, h: 1200 };
	const beside = joinSpot({ w: 1000, h: 1200 }, [tall], camera);
	assert.ok(beside.x >= tall.x + tall.w, "a tall board is passed at the side: 1000 across beats 1200 down");
	assert.equal(beside.y, tall.y, "and kept in line with it");

	const wide = { x: -900, y: -300, w: 1800, h: 600 };
	const under = joinSpot({ w: 1800, h: 600 }, [wide], camera);
	assert.ok(under.y >= wide.y + wide.h, "a wide one is passed underneath, for the same reason");
	assert.equal(under.x, wide.x, "and kept in line with it");
});

test("a spot to the left is only taken when it is the nearest one", () => {
	const there = { x: 0, y: 0, w: 1000, h: 800 };
	// Looking at the right-hand edge of the board: the free spot on that side is the near one.
	const right = joinSpot({ w: 1000, h: 800 }, [there], { x: 1000, y: 400, zoom: 1, width: 400, height: 300 });
	assert.ok(right.x >= there.x + there.w);
	// Looking at its left-hand edge: the other side is.
	const left = joinSpot({ w: 1000, h: 800 }, [there], { x: 0, y: 400, zoom: 1, width: 400, height: 300 });
	assert.ok(left.x + 1000 <= there.x);
});
