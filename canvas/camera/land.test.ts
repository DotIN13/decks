import assert from "node:assert/strict";
import { test } from "node:test";
import { landingCamera, sameOwner } from "./land.ts";

const viewport = { width: 1400, height: 900 };
const region = { x: 0, y: 0, width: 1400, height: 900 };

test("a saved view comes back exactly, even when only drawing is under it", () => {
	const view = { camera: { x: -8022, y: -12652, zoom: 0.4 } };
	assert.deepEqual(landingCamera({ view, boxes: [{ x: 9000, y: 9000, w: 100, h: 100 }], viewport, region }), view.camera);
});

test("a saved view comes back on a canvas with nothing on it", () => {
	const view = { camera: { x: 12, y: 34, zoom: 2 } };
	assert.deepEqual(landingCamera({ view, boxes: [], viewport, region }), view.camera);
});

test("with no saved view, the middle of everything on the canvas, drawing included", () => {
	const camera = landingCamera({ view: undefined, boxes: [{ x: 0, y: 0, w: 200, h: 100 }, { x: 1000, y: 0, w: 200, h: 100 }, { x: 2000, y: 0, w: 200, h: 100 }], viewport, region });
	assert.equal(camera.x, 1100);
	assert.equal(camera.y, 50);
});

test("an empty canvas with no saved view lands at its origin, never at the camera on screen", () => {
	assert.deepEqual(landingCamera({ view: undefined, boxes: [], viewport, region }), { x: 0, y: 0, zoom: 1 });
});

test("owners are the same key only when scope and canvas both match", () => {
	assert.equal(sameOwner({ scope: "a", canvas: "x" }, { scope: "a", canvas: "x" }), true);
	assert.equal(sameOwner({ scope: "a", canvas: "x" }, { scope: "a", canvas: "y" }), false);
	assert.equal(sameOwner({ scope: "a", canvas: "x" }, undefined), false);
});
