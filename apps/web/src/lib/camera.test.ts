import assert from "node:assert/strict";
import { test } from "node:test";
import { breathingRoom, clampZoom, fit, keepVisible, MAX_ZOOM, MIN_ZOOM, pan, pinchCamera, toScreen, toWorld, zoomAbout } from "./camera.ts";

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

test("a phone gets less breathing room than a laptop, because it has less to give", () => {
	// A laptop and a tablet are unchanged: the cap is what they were always given.
	assert.equal(breathingRoom({ width: 1500, height: 950 }), 96);
	assert.equal(breathingRoom({ width: 810, height: 1080 }), 96);
	// A phone, where a constant 96 left the deck in the middle quarter of the screen.
	assert.ok(breathingRoom({ width: 393, height: 659 }) < 60);
	const wide = fit([{ x: 0, y: 0, w: 1600, h: 1000 }], { width: 393, height: 659 });
	const narrow = fit([{ x: 0, y: 0, w: 1600, h: 1000 }], { width: 393, height: 659 }, 96);
	assert.ok(wide.zoom > narrow.zoom, `${wide.zoom} should be closer than ${narrow.zoom}`);
});

test("a pinch is a pan and a zoom in one expression", () => {
	const camera = { x: 0, y: 0, zoom: 1 };
	// Same distance, both fingers moved right: a pan and nothing else.
	const panned = pinchCamera(camera, view, [{ x: 400, y: 400 }, { x: 600, y: 400 }], [{ x: 450, y: 400 }, { x: 650, y: 400 }]);
	assert.equal(panned.zoom, 1);
	assert.ok(Math.abs(panned.x + 50) < 1e-9);

	// Same midpoint, twice the distance: a zoom and nothing else.
	const zoomed = pinchCamera(camera, view, [{ x: 500, y: 400 }, { x: 700, y: 400 }], [{ x: 400, y: 400 }, { x: 800, y: 400 }]);
	assert.equal(zoomed.zoom, 2);
	assert.deepEqual(toWorld(zoomed, view, { x: 600, y: 400 }), toWorld(camera, view, { x: 600, y: 400 }));
});

test("two fingers landing on the same spot do not divide by zero", () => {
	const camera = { x: 10, y: 20, zoom: 1.5 };
	const step = pinchCamera(camera, view, [{ x: 300, y: 300 }, { x: 300, y: 300 }], [{ x: 310, y: 300 }, { x: 300, y: 300 }]);
	assert.equal(step.zoom, 1.5);
	assert.ok(Number.isFinite(step.x) && Number.isFinite(step.y));
});

test("keeping a box visible moves as little as it can, and not at all when it already is", () => {
	const camera = { x: 0, y: 0, zoom: 1 };
	const middle = { x: -100, y: -100, w: 200, h: 200 };
	assert.equal(keepVisible(camera, view, middle), camera);

	// The on-screen keyboard: 300px of the bottom is gone, and the box is under it.
	const low = { x: -100, y: 200, w: 200, h: 100 };
	const moved = keepVisible(camera, view, low, { bottom: 300 });
	const at = toScreen(moved, view, { x: low.x, y: low.y + low.h });
	assert.ok(at.y <= view.height - 300 + 1e-6, `the bottom of the box is at ${at.y}`);
	// Vertically only: nothing was wrong horizontally.
	assert.equal(moved.x, camera.x);
});

test("a box too big for the room left is aligned to its top left, where reading starts", () => {
	const camera = { x: 0, y: 0, zoom: 1 };
	const tall = { x: -100, y: 100, w: 200, h: 900 };
	const moved = keepVisible(camera, view, tall, { top: 40, bottom: 300 });
	const top = toScreen(moved, view, { x: tall.x, y: tall.y });
	assert.ok(Math.abs(top.y - 40) < 1e-6, `the top of the box is at ${top.y}`);
});
