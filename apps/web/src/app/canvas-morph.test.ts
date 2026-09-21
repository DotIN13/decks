import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board, Camera } from "@decks/protocol";
import { camera as liveCamera, moveCamera } from "../state/camera.ts";
import { createCanvasMorph } from "./canvas-morph.ts";

/*
 * Where a canvas is left, and where it is found again.
 *
 * Leaving shrinks the canvas into its card, so by the last frame the live camera is a picture
 * of a card: one percent, aimed at a place on the dashboard. That camera must never be the one
 * a canvas is kept at — and `leave` is the only thing that knows the difference, because it
 * parks the view *before* it starts flying. This is what went wrong: something else parked the
 * camera afterwards, and the next open of that canvas landed at one percent with the boards in
 * the corner.
 */

function store() {
	const written = new Map<string, string>();
	return { written, getItem: (key: string) => written.get(key) ?? null, setItem: (key: string, value: string) => void written.set(key, value) };
}

const boards = (): Board[] => [{ path: "boards/plan.html", title: "Plan", x: 0, y: 0, w: 1000, h: 700, inContext: [] } as unknown as Board];

/** A stage that fills a window, and no cards on the shelf, so nothing animates. */
function morphOn(storage: ReturnType<typeof store>) {
	(globalThis as { document?: unknown }).document ??= { querySelector: () => null };
	(globalThis as { CSS?: unknown }).CSS ??= { escape: (value: string) => value };
	const rect = { left: 0, top: 0, width: 1400, height: 900, right: 1400, bottom: 900, x: 0, y: 0, toJSON: () => ({}) };
	return createCanvasMorph({
		deckPath: () => "/deck",
		stage: () => ({ getBoundingClientRect: () => rect }) as unknown as Element,
		camera: () => liveCamera(),
		storage,
	});
}

test("leaving parks the view you were looking at, and coming back lands on it", () => {
	const storage = store();
	const morph = morphOn(storage);
	const reading: Camera = { x: 500, y: 350, zoom: 0.8 };
	moveCamera(reading);

	morph.leave("cv_1", boards(), () => {});
	// The flight ends on the card: one percent, somewhere over the dashboard.
	moveCamera({ x: 20470, y: 528679, zoom: 0.0135 });

	assert.equal(morph.arrived("cv_1", boards()), true);
	assert.deepEqual(liveCamera(), reading, "the camera comes back to the reading, not to the card");
});

test("a canvas nobody has opened lands on a fit of its boards, not on nothing", () => {
	const morph = morphOn(store());
	moveCamera({ x: 0, y: 0, zoom: 0.0135 });
	assert.equal(morph.arrived("cv_never", boards()), true);
	assert.ok(liveCamera().zoom > 0.5, `a fit of one 1000px board in a 1400px window, not ${liveCamera().zoom}`);
});

test("a canvas whose boards have not arrived is not landed on, so the caller keeps asking", () => {
	const morph = morphOn(store());
	assert.equal(morph.arrived("cv_1", []), false);
});
