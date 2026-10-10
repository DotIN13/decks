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
	const view = { width: 1440, height: 900 };
	const insets = { left: 264, right: 0, top: 0 };
	const board = { x: 2000, y: 600, w: 1000, h: 700 };
	const camera = cameraOntoPage(board, view, insets);
	assert.ok(Math.abs(camera.zoom - 1176 / 1000) < 1e-9, "a designed board is as wide as the room beside the board list");
	const corner = toScreen(camera, view, { x: board.x, y: board.y });
	assert.ok(Math.abs(corner.x - 264) < 0.5, "edge to edge from the board list");
	assert.ok(Math.abs(corner.y - 52) < 0.5, "under the view's header");
	const huge = cameraOntoPage({ x: 0, y: 0, w: 400, h: 300 }, view, insets);
	assert.equal(huge.zoom, 2, "never more than twice life size");
	const file = cameraOntoPage(board, view, insets, { fills: true });
	assert.ok(Math.abs(toScreen(file, view, { x: board.x, y: board.y }).y) < 0.5, "a board that fills itself has its own bar at the top");
});
