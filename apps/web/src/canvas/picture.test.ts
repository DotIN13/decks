import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { drawScale, MAX_SIDE, needsRedraw, pictureSize } from "./picture.ts";

describe("pictureSize", () => {
	it("is the board's size in device pixels at the zoom it is seen at", () => {
		const size = pictureSize({ w: 1200, h: 900 }, 0.5, 2);
		assert.deepEqual(size, { w: 1200, h: 900 });
		const small = pictureSize({ w: 1200, h: 900 }, 0.25, 1);
		assert.deepEqual(small, { w: 300, h: 225 });
	});

	it("caps a side and keeps the board's proportions", () => {
		const size = pictureSize({ w: 1200, h: 900 }, 4, 2);
		assert.equal(size.w, MAX_SIDE);
		assert.equal(size.h, 3072);
		assert.ok(Math.abs(size.w / 1200 - size.h / 900) < 1e-9);
	});

	it("fits a box when the cap is one", () => {
		const size = pictureSize({ w: 1200, h: 900 }, 1, 1, { w: 800, h: 1000 });
		assert.equal(size.w, 800);
		assert.equal(size.h, 600);
	});

	it("never comes out at zero pixels", () => {
		const size = pictureSize({ w: 400, h: 300 }, 0.001, 1);
		assert.ok(size.w >= 1 && size.h >= 1);
	});
});

describe("drawScale", () => {
	it("is one when the frame is its canvas's own box", () => {
		// A canvas per board on a 2× screen: a 940-wide board at a 0.9 zoom stands 846 CSS px
		// wide and its canvas has 1692 pixels, two for each of them. The frame arrives at
		// 846 × 2 = 1692, which is the picture — so it is drawn as it comes, at every zoom.
		assert.deepEqual(drawScale({ w: 1692, h: 1612 }, { width: 846, height: 806 }, { x: 2, y: 2 }), { x: 1, y: 1 });
	});

	it("shrinks the frame when the picture is smaller than the canvas it is drawn in", () => {
		// The one-canvas darkroom: it stands at the stage's size with two pixels per CSS
		// pixel, the frame in it stands at the board's own 940 wide, and the picture wanted is
		// the 470 pixels the board takes at a quarter zoom. 470 / (940 × 2).
		assert.deepEqual(drawScale({ w: 470, h: 447 }, { width: 940, height: 894 }, { x: 2, y: 2 }), { x: 0.25, y: 0.25 });
	});

	it("does not confuse the picture's pixels with the canvas's", () => {
		// The same board at half zoom on a 1× screen: 470 pixels wanted, frame arriving at 940.
		assert.deepEqual(drawScale({ w: 470, h: 447 }, { width: 940, height: 894 }, { x: 1, y: 1 }), { x: 0.5, y: 0.5 });
	});

	it("has no answer for a frame that has not been laid out, or a picture of nothing", () => {
		assert.equal(drawScale({ w: 100, h: 100 }, { width: 0, height: 0 }, { x: 1, y: 1 }), undefined);
		assert.equal(drawScale({ w: 0, h: 0 }, { width: 100, height: 100 }, { x: 1, y: 1 }), undefined);
	});
});

describe("needsRedraw", () => {
	it("draws when there is nothing, when the picture is soft, and when it is wasteful", () => {
		assert.equal(needsRedraw(undefined, { w: 100, h: 100 }), true);
		assert.equal(needsRedraw({ w: 100, h: 100 }, { w: 100, h: 100 }), false);
		assert.equal(needsRedraw({ w: 100, h: 100 }, { w: 101, h: 100 }), false, "a pixel of rounding is not a repaint");
		assert.equal(needsRedraw({ w: 100, h: 100 }, { w: 110, h: 100 }), true, "10% soft is");
		assert.equal(needsRedraw({ w: 100, h: 100 }, { w: 80, h: 80 }), false, "a little too large is fine");
		assert.equal(needsRedraw({ w: 100, h: 100 }, { w: 40, h: 40 }), true, "six times the pixels is memory");
	});
});
