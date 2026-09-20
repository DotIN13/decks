import assert from "node:assert/strict";
import { test } from "node:test";
import { toScreen } from "./camera.ts";
import { boundsOf, cameraInto, cameraOntoPage, morphFrame } from "./morph.ts";

/*
 * The first frame of opening a canvas has to put its boards inside the card that was pressed,
 * or the animation starts with a jump. That is the one property worth asserting.
 */

test("the canvas's boards land inside the card on the first frame", () => {
	const boards = [
		{ x: 0, y: 0, w: 1000, h: 700 },
		{ x: 1120, y: 0, w: 1000, h: 900 },
	];
	const box = boundsOf(boards)!;
	const stage = { left: 264, top: 0, width: 1336, height: 900 };
	const card = { left: 300, top: 120, width: 240, height: 150 };
	const camera = cameraInto(box, card, stage);
	const view = { width: stage.width, height: stage.height };
	const topLeft = toScreen(camera, view, { x: box.x, y: box.y });
	const bottomRight = toScreen(camera, view, { x: box.x + box.w, y: box.y + box.h });
	// In window coordinates: add the stage's own offset back.
	const [l, t, r, b] = [topLeft.x + stage.left, topLeft.y + stage.top, bottomRight.x + stage.left, bottomRight.y + stage.top];
	assert.ok(l >= card.left - 0.5 && r <= card.left + card.width + 0.5, `x ${l}..${r} inside the card`);
	assert.ok(t >= card.top - 0.5 && b <= card.top + card.height + 0.5, `y ${t}..${b} inside the card`);
	// And centred on it, so the growth is about the card's middle.
	assert.ok(Math.abs((l + r) / 2 - (card.left + card.width / 2)) < 0.5);
	assert.ok(Math.abs((t + b) / 2 - (card.top + card.height / 2)) < 0.5);
});

test("an empty canvas has no bounds, so there is nothing to grow from", () => {
	assert.equal(boundsOf([]), undefined);
});

test("in the middle of the grow the boards stay on the line from the card to their place", () => {
	const box = { x: 0, y: 0, w: 2000, h: 900 };
	const stage = { left: 0, top: 0, width: 1400, height: 900 };
	const view = { width: 1400, height: 900 };
	const from = cameraInto(box, { left: 300, top: 150, width: 235, height: 46 }, stage);
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
