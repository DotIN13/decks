import assert from "node:assert/strict";
import { test } from "node:test";
import type { Camera } from "@decks/protocol";
import { createAgentViews } from "./agent-views.ts";
import { createLanding, type LandingHost } from "./landing.ts";
import type { CameraOwner } from "./land.ts";

/** A host whose canvas on screen, boxes and camera a test sets. */
function host() {
	const store = new Map<string, string>();
	const views = createAgentViews("t", { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) });
	const at: { camera: Camera; onScreen?: string; boxes: Array<{ x: number; y: number; w: number; h: number }>; current?: CameraOwner; landed: Camera[] } = { camera: { x: 0, y: 0, zoom: 1 }, boxes: [], landed: [] };
	const made: LandingHost = {
		views: () => views,
		camera: () => at.camera,
		selected: () => undefined,
		boxes: () => at.boxes,
		viewport: () => ({ width: 1000, height: 800 }),
		region: (v) => ({ x: 0, y: 0, ...v }),
		current: (to) => at.current?.scope === to.scope && at.current.canvas === to.canvas,
		onScreen: (to) => at.onScreen === to.canvas,
		land: (next) => {
			at.camera = next;
			at.landed.push(next);
		},
		select: () => {},
	};
	return { at, views, landing: createLanding(made) };
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

test("a view kept under the key lands at once, and the one left is parked under its owner", async () => {
	const { at, views, landing } = host();
	views.keep("b", "two", { camera: { x: 5, y: 6, zoom: 2 } });
	at.current = { scope: "b", canvas: "two" };
	landing.arrive(at.current);
	assert.deepEqual(at.camera, { x: 5, y: 6, zoom: 2 });
	assert.deepEqual(landing.owner(), { scope: "b", canvas: "two" });
	at.camera = { x: 1, y: 1, zoom: 1 };
	at.current = { scope: "a", canvas: "one" };
	landing.arrive(at.current);
	assert.deepEqual(views.of("b", "two")?.camera, { x: 1, y: 1, zoom: 1 });
	landing.stop();
});

test("with no view, the landing waits for its canvas on screen, then frames what is on it", async () => {
	const { at, landing } = host();
	at.current = { scope: "a", canvas: "one" };
	landing.arrive(at.current);
	await wait(250);
	assert.equal(at.landed.length, 0);
	at.onScreen = "one";
	at.boxes = [{ x: 400, y: 300, w: 200, h: 200 }];
	await wait(250);
	assert.equal(at.landed.length, 1);
	assert.equal(at.camera.x, 500);
	landing.stop();
});

test("a person's move that shows the arriving canvas calls the landing off and is theirs", async () => {
	const { at, landing } = host();
	at.current = { scope: "a", canvas: "one" };
	at.boxes = [{ x: 0, y: 0, w: 100, h: 100 }];
	landing.arrive(at.current);
	at.onScreen = "one";
	landing.personMoved({ x: 50, y: 50, zoom: 1 });
	assert.deepEqual(landing.owner(), { scope: "a", canvas: "one" });
	await wait(250);
	assert.equal(at.landed.length, 0);
});
