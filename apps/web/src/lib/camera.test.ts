import assert from "node:assert/strict";
import { test } from "node:test";
import { clampZoom, fit, MAX_ZOOM, MIN_ZOOM, pan, toScreen, toWorld, zoomAbout } from "./camera.ts";

const view = { width: 1200, height: 800 };

test("world and screen are inverses of each other", () => {
	const camera = { x: 400, y: 250, zoom: 0.75 };
	for (const point of [
		{ x: 0, y: 0 },
		{ x: 400, y: 250 },
		{ x: -1200, y: 3000 },
	]) {
		const back = toWorld(camera, view, toScreen(camera, view, point));
		assert.ok(Math.abs(back.x - point.x) < 1e-9 && Math.abs(back.y - point.y) < 1e-9, JSON.stringify({ point, back }));
	}
});

test("the camera's own point is the centre of the viewport", () => {
	const camera = { x: 700, y: -300, zoom: 2 };
	assert.deepEqual(toScreen(camera, view, { x: 700, y: -300 }), { x: 600, y: 400 });
});

test("zooming holds the world point under the cursor — the property you notice when it is missing", () => {
	const camera = { x: 0, y: 0, zoom: 1 };
	const cursor = { x: 900, y: 200 };
	const before = toWorld(camera, view, cursor);

	let next = camera;
	for (const factor of [1.2, 1.2, 0.5, 3, 0.9]) {
		next = zoomAbout(next, view, cursor, factor);
		const after = toWorld(next, view, cursor);
		assert.ok(Math.abs(after.x - before.x) < 1e-6, `x drifted to ${after.x} from ${before.x}`);
		assert.ok(Math.abs(after.y - before.y) < 1e-6, `y drifted to ${after.y} from ${before.y}`);
	}
});

test("zoom stops at the limits, and stops moving the camera there too", () => {
	assert.equal(clampZoom(1000), MAX_ZOOM);
	assert.equal(clampZoom(0), MIN_ZOOM);

	const atMax = { x: 10, y: 20, zoom: MAX_ZOOM };
	assert.deepEqual(zoomAbout(atMax, view, { x: 0, y: 0 }, 2), atMax, "a no-op zoom must not pan");
});

test("panning moves the camera the other way, scaled by zoom", () => {
	// Dragging the canvas right moves the camera left, and at 0.25 zoom one screen
	// pixel is four world pixels — the thing every drag depends on.
	assert.deepEqual(pan({ x: 0, y: 0, zoom: 0.25 }, 100, 40), { x: -400, y: -160, zoom: 0.25 });
});

test("fitting one board centres it and leaves a margin", () => {
	const board = { x: 100, y: 100, w: 1600, h: 1000 };
	const camera = fit([board], view);
	assert.deepEqual({ x: camera.x, y: camera.y }, { x: 900, y: 600 }, "the centre of the board");
	// It fits, with the padding respected on the tighter axis.
	assert.ok(board.w * camera.zoom <= view.width - 100, `${board.w * camera.zoom} fits in ${view.width}`);
	assert.ok(board.h * camera.zoom <= view.height - 100);
});

test("fitting several boards frames all of them", () => {
	const boards = [
		{ x: 0, y: 0, w: 1600, h: 1000 },
		{ x: 1760, y: 0, w: 1400, h: 900 },
		{ x: 0, y: 1160, w: 1600, h: 1120 },
	];
	const camera = fit(boards, view);
	for (const board of boards) {
		const topLeft = toScreen(camera, view, { x: board.x, y: board.y });
		const bottomRight = toScreen(camera, view, { x: board.x + board.w, y: board.y + board.h });
		assert.ok(topLeft.x >= -1 && topLeft.y >= -1, `${JSON.stringify(topLeft)} is on screen`);
		assert.ok(bottomRight.x <= view.width + 1 && bottomRight.y <= view.height + 1, `${JSON.stringify(bottomRight)} is on screen`);
	}
});

test("fitting nothing, or into no viewport, is harmless", () => {
	assert.deepEqual(fit([], view), { x: 0, y: 0, zoom: 1 });
	assert.deepEqual(fit([{ x: 0, y: 0, w: 100, h: 100 }], { width: 0, height: 0 }), { x: 0, y: 0, zoom: 1 });
});
