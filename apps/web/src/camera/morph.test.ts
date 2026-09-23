import assert from "node:assert/strict";
import { test } from "node:test";
import { toScreen } from "./camera.ts";
import { cameraOntoPage, morphFrame } from "./morph.ts";

test("in the middle of a flight the boards stay on the line from where they were to their place", () => {
	const box = { x: 0, y: 0, w: 2000, h: 900 };
	const view = { width: 1400, height: 900 };
	const from = { x: 3200, y: 2400, zoom: 0.11 };
	const to = { x: 1000, y: 450, zoom: 0.6 };
	const middle = { x: 1000, y: 450 };
	const start = toScreen(from, view, middle);
	const end = toScreen(to, view, middle);
	for (const s of [0.1, 0.25, 0.5, 0.75, 0.9]) {
		const at = toScreen(morphFrame(from, to, s, box, view), view, middle);
		const expected = { x: start.x + (end.x - start.x) * s, y: start.y + (end.y - start.y) * s };
		assert.ok(Math.abs(at.x - expected.x) < 0.5 && Math.abs(at.y - expected.y) < 0.5, `s=${s}: ${at.x},${at.y} vs ${expected.x},${expected.y}`);
		assert.ok(at.x > 0 && at.x < view.width && at.y > 0 && at.y < view.height, "never off the screen");
	}
});

test("the camera for a board's page puts it where the reading view draws the page", () => {
	const view = { width: 1400, height: 900 };
	const insets = { left: 0, right: 0, top: 52 };
	const board = { x: 2000, y: 600, w: 1000, h: 700 };
	const camera = cameraOntoPage(board, view, insets);
	assert.equal(camera.zoom, 1, "a board narrower than the window is read at its own size");
	const corner = toScreen(camera, view, { x: board.x, y: board.y });
	assert.ok(Math.abs(corner.x - 200) < 0.5, "centred: (1400 - 1000) / 2");
	assert.ok(Math.abs(corner.y - 64) < 0.5, "a line under the top inset");
	const wide = cameraOntoPage({ x: 0, y: 0, w: 2000, h: 900 }, view, insets);
	assert.ok(Math.abs(wide.zoom - (1400 - 64) / 2000) < 1e-9, "a wide board is fitted to the window less its air");
});
