import assert from "node:assert/strict";
import { test } from "node:test";
import { createTouches } from "./touch.ts";
import { pinchCamera, toScreen, toWorld } from "../lib/camera.ts";

const view = { width: 800, height: 600 };

test("one finger is a pan, measured against the last event and not the first", () => {
	const touches = createTouches();
	touches.down({ id: 1, x: 100, y: 100 });
	assert.deepEqual(touches.move({ id: 1, x: 110, y: 130 }), { kind: "pan", dx: 10, dy: 30 });
	assert.deepEqual(touches.move({ id: 1, x: 110, y: 140 }), { kind: "pan", dx: 0, dy: 10 });
});

test("a finger nobody saw land moves nothing", () => {
	const touches = createTouches();
	touches.down({ id: 1, x: 0, y: 0 });
	assert.deepEqual(touches.move({ id: 7, x: 400, y: 400 }), { kind: "idle" });
});

/*
 * The bug this whole module exists for. Two fingers used to be two independent pans:
 * every `pointermove` panned the camera, so a pinch pulled the canvas about instead of
 * zooming it and a two-finger pan travelled at double speed.
 */
test("a second finger stops the gesture being a pan", () => {
	const touches = createTouches();
	touches.down({ id: 1, x: 200, y: 200 });
	touches.down({ id: 2, x: 300, y: 200 });
	const step = touches.move({ id: 1, x: 190, y: 200 });
	assert.equal(step.kind, "pinch");
	assert.deepEqual(step.kind === "pinch" ? step.from.map((f) => f.x) : [], [200, 300]);
	assert.deepEqual(step.kind === "pinch" ? step.to.map((f) => f.x) : [], [190, 300]);
});

test("lifting one of two fingers leaves a pan, not a jump", () => {
	const touches = createTouches();
	touches.down({ id: 1, x: 200, y: 200 });
	touches.down({ id: 2, x: 400, y: 200 });
	touches.move({ id: 1, x: 100, y: 200 });
	touches.up(1);
	// The finger that stayed reports from where it actually is, so nothing lurches.
	assert.deepEqual(touches.move({ id: 2, x: 410, y: 205 }), { kind: "pan", dx: 10, dy: 5 });
	assert.equal(touches.count(), 1);
});

test("spreading two fingers zooms by the ratio of the distance between them", () => {
	const touches = createTouches();
	touches.down({ id: 1, x: 300, y: 300 });
	touches.down({ id: 2, x: 500, y: 300 });
	const step = touches.move({ id: 2, x: 700, y: 300 });
	assert.equal(step.kind, "pinch");
	if (step.kind !== "pinch") return;
	const camera = pinchCamera({ x: 0, y: 0, zoom: 1 }, view, step.from, step.to);
	assert.equal(camera.zoom, 2);
});

test("the midpoint between two fingers stays on the world point it started on", () => {
	const touches = createTouches();
	let camera = { x: 120, y: -40, zoom: 0.8 };
	touches.down({ id: 1, x: 300, y: 320 });
	touches.down({ id: 2, x: 460, y: 380 });
	const anchor = toWorld(camera, view, { x: 380, y: 350 });

	// A hand doing both at once: spreading, and drifting up and to the left.
	let a = { x: 300, y: 320 };
	let b = { x: 460, y: 380 };
	for (let i = 0; i < 12; i++) {
		a = { x: a.x - 7, y: a.y - 4 };
		b = { x: b.x + 4, y: b.y + 1 };
		for (const finger of [
			{ id: 1, ...a },
			{ id: 2, ...b },
		]) {
			const step = touches.move(finger);
			if (step.kind === "pinch") camera = pinchCamera(camera, view, step.from, step.to);
		}
		const at = toScreen(camera, view, anchor);
		const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		assert.ok(
			Math.abs(at.x - centre.x) < 1e-6 && Math.abs(at.y - centre.y) < 1e-6,
			`the anchor drifted to ${JSON.stringify(at)} from the midpoint ${JSON.stringify(centre)}`,
		);
	}
	assert.ok(camera.zoom > 0.8, `expected to have zoomed in, got ${camera.zoom}`);
});

test("two fingers moving together pan by what they moved, not by twice it", () => {
	const touches = createTouches();
	let camera = { x: 0, y: 0, zoom: 1 };
	touches.down({ id: 1, x: 200, y: 200 });
	touches.down({ id: 2, x: 400, y: 200 });
	for (const finger of [
		{ id: 1, x: 240, y: 200 },
		{ id: 2, x: 440, y: 200 },
	]) {
		const step = touches.move(finger);
		if (step.kind === "pinch") camera = pinchCamera(camera, view, step.from, step.to);
	}
	assert.equal(camera.zoom, 1);
	// 40px of finger at zoom 1 is 40 world units, and the world went the other way.
	assert.ok(Math.abs(camera.x + 40) < 1e-9, `camera.x is ${camera.x}`);
});

test("a pinch past the zoom limit still pans, and comes back the moment it can", () => {
	const touches = createTouches();
	let camera = { x: 0, y: 0, zoom: 4 };
	touches.down({ id: 1, x: 380, y: 300 });
	touches.down({ id: 2, x: 420, y: 300 });
	let a = { x: 380, y: 300 };
	let b = { x: 420, y: 300 };
	for (let i = 0; i < 6; i++) {
		a = { x: a.x - 20, y: a.y };
		b = { x: b.x + 20, y: b.y };
		for (const finger of [
			{ id: 1, ...a },
			{ id: 2, ...b },
		]) {
			const step = touches.move(finger);
			if (step.kind === "pinch") camera = pinchCamera(camera, view, step.from, step.to);
		}
	}
	assert.equal(camera.zoom, 4);

	// Pinching back in is answered immediately: the steps were never accumulated into
	// a spread the camera would have to unwind first.
	const step = touches.move({ id: 1, x: a.x + 100, y: a.y });
	assert.equal(step.kind, "pinch");
	if (step.kind !== "pinch") return;
	assert.ok(pinchCamera(camera, view, step.from, step.to).zoom < 4);
});
