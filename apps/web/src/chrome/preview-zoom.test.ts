import assert from "node:assert/strict";
import { test } from "node:test";
import { clampPreviewZoom, MAX_PREVIEW_ZOOM, MIN_PREVIEW_ZOOM, scrollToHold, wheelFactor } from "./preview-zoom.ts";

test("the preview's zoom stays between half and eight times the fitted size", () => {
	assert.equal(clampPreviewZoom(0.01), MIN_PREVIEW_ZOOM);
	assert.equal(clampPreviewZoom(100), MAX_PREVIEW_ZOOM);
	assert.equal(clampPreviewZoom(2), 2);
});

test("a wheel towards the reader zooms in, away zooms out, and one notch is clamped", () => {
	assert.ok(wheelFactor(-10) > 1);
	assert.ok(wheelFactor(10) < 1);
	assert.equal(wheelFactor(-1000), 1.3);
	assert.equal(wheelFactor(1000), 1 / 1.3);
});

test("the point under the cursor stays under it", () => {
	// Cursor at 300, board edge at 100, so 200 drawn pixels in at scale 0.5: board x 400.
	// At scale 1 that point is 400 from the edge. If the edge stayed at 100 it is drawn at
	// 500, so the box scrolls 200 to bring it back under 300.
	assert.equal(scrollToHold(300, 200, 0.5, 1, 100), 200);
	// Nothing changes, nothing scrolls.
	assert.equal(scrollToHold(300, 200, 0.5, 0.5, 100), 0);
	// An edge that moved (the box stopped being centred) is part of the answer.
	assert.equal(scrollToHold(300, 200, 0.5, 1, 12), 112);
});
