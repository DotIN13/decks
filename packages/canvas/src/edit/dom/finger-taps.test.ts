import assert from "node:assert/strict";
import { test } from "node:test";
import { createFingerTaps } from "./finger-taps.ts";

test("two fingers down and up together are a two-finger tap; three are three; one is nothing", () => {
	const taps = createFingerTaps();
	taps.down(1, 100, 100, 0);
	taps.down(2, 160, 100, 40);
	assert.equal(taps.up(1, 120), undefined, "one still down");
	assert.equal(taps.up(2, 130), 2);
	taps.down(1, 100, 100, 1000);
	taps.down(2, 160, 100, 1030);
	taps.down(3, 220, 100, 1060);
	taps.up(1, 1200);
	taps.up(2, 1210);
	assert.equal(taps.up(3, 1220), 3);
	taps.down(1, 100, 100, 2000);
	assert.equal(taps.up(1, 2100), undefined, "a single finger is a tap of the drawing's, not this");
});

test("a finger that lands late, travels, or stays makes it a pinch, a pan or a hold: no tap", () => {
	const taps = createFingerTaps();
	taps.down(1, 100, 100, 0);
	taps.down(2, 160, 100, 400);
	taps.up(1, 450);
	assert.equal(taps.up(2, 460), undefined, "the second landed past the window");
	taps.down(1, 100, 100, 1000);
	taps.down(2, 160, 100, 1020);
	taps.move(2, 200, 140);
	taps.up(1, 1100);
	assert.equal(taps.up(2, 1110), undefined, "a finger travelled: a pinch");
	taps.down(1, 100, 100, 2000);
	taps.down(2, 160, 100, 2020);
	taps.up(1, 2500);
	assert.equal(taps.up(2, 2510), undefined, "held too long");
	// Clean again after: the state does not leak.
	taps.down(1, 100, 100, 3000);
	taps.down(2, 160, 100, 3020);
	taps.up(1, 3100);
	assert.equal(taps.up(2, 3110), 2);
});
