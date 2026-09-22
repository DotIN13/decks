import assert from "node:assert/strict";
import { test } from "node:test";
import { isRead, overlap, READ_ZOOM } from "./glow.ts";

const screen = { x: 0, y: 0, w: 1400, h: 900 };

test("overlap: the share of the board on screen, and the share of the screen it fills", () => {
	assert.deepEqual(overlap({ x: 100, y: 100, w: 400, h: 300 }, screen), { share: 1, fill: (400 * 300) / (1400 * 900) });
	// Half off the right edge.
	assert.equal(overlap({ x: 1200, y: 100, w: 400, h: 300 }, screen).share, 0.5);
	assert.deepEqual(overlap({ x: 2000, y: 0, w: 400, h: 300 }, screen), { share: 0, fill: 0 });
	assert.deepEqual(overlap({ x: 0, y: 0, w: 0, h: 0 }, screen), { share: 0, fill: 0 });
});

test("isRead: close enough, mostly on screen, and the camera at rest", () => {
	const box = { x: 200, y: 100, w: 1000, h: 700 };
	assert.equal(isRead({ zoom: 1, moving: false, box, within: screen }), true);
	assert.equal(isRead({ zoom: READ_ZOOM, moving: false, box, within: screen }), true);
	assert.equal(isRead({ zoom: 0.5, moving: false, box, within: screen }), false, "a tile on a map is not read");
	assert.equal(isRead({ zoom: 1, moving: true, box, within: screen }), false, "flown past is not read");
	assert.equal(isRead({ zoom: 1, moving: false, box: { ...box, x: 1000 }, within: screen }), false, "less than half of it on screen");
	// A board taller than the window, read from its top: it fills the window, so it is read.
	assert.equal(isRead({ zoom: 1, moving: false, box: { x: 200, y: 60, w: 1000, h: 4000 }, within: screen }), true);
	// The same tall board with only its bottom corner showing is not.
	assert.equal(isRead({ zoom: 1, moving: false, box: { x: 1100, y: -3800, w: 1000, h: 4000 }, within: screen }), false);
});
