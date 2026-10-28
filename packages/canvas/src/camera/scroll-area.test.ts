import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { cameraFor, MIDDLE, nearEdge, scrollFor, SIZE } from "./scroll-area.ts";

const view = { width: 1500, height: 900 };

describe("scroll area", () => {
	it("shows the origin at the middle of the window when the camera is on it", () => {
		assert.deepEqual(scrollFor({ x: 40, y: -20, zoom: 2 }, { x: 40, y: -20 }, view), { left: MIDDLE - 750, top: MIDDLE - 450 });
	});

	it("reads back the camera it was given, at any zoom", () => {
		for (const camera of [{ x: 0, y: 0, zoom: 1 }, { x: 1234.5, y: -987.25, zoom: 0.3 }, { x: -50000, y: 20000, zoom: 4 }]) {
			const origin = { x: 300, y: -700 };
			const back = cameraFor(scrollFor(camera, origin, view), origin, camera.zoom, view);
			assert.ok(Math.abs(back.x - camera.x) < 1e-6 && Math.abs(back.y - camera.y) < 1e-6, JSON.stringify(back));
		}
	});

	it("scrolls one screen pixel per canvas unit times the zoom", () => {
		const origin = { x: 0, y: 0 };
		const a = scrollFor({ x: 0, y: 0, zoom: 0.5 }, origin, view);
		const b = scrollFor({ x: 100, y: 10, zoom: 0.5 }, origin, view);
		assert.deepEqual({ dx: b.left - a.left, dy: b.top - a.top }, { dx: 50, dy: 5 });
	});

	it("is near an edge only within a few windows of one", () => {
		assert.equal(nearEdge({ left: MIDDLE, top: MIDDLE }, view), false);
		assert.equal(nearEdge({ left: 1000, top: MIDDLE }, view), true);
		assert.equal(nearEdge({ left: MIDDLE, top: SIZE - 2000 }, view), true);
	});
});
