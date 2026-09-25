import assert from "node:assert/strict";
import { test } from "node:test";
import { between, breathingRoom, clampZoom, easeOutCubic, EDGE_FLOOR, fit, fitInto, INTERACT_ZOOM, keepVisible, MAX_ZOOM, middleOf, MIN_ZOOM, STAGE_ZOOM, pan, pinchCamera, toScreen, toWorld, zoomAbout } from "./camera.ts";

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

/*
 * `fitInto` — fitting into the canvas column rather than into the window.
 *
 * The regression these guard is the one `EDGE_FLOOR` is named for: padding counted on top
 * of the panels, so a flown-to board landed under `INTERACT_ZOOM` and could not be clicked.
 */
test("fitInto with no chrome is fit", () => {
	const view = { width: 1400, height: 900 };
	const box = { x: 0, y: 0, w: 700, h: 450 };
	const a = fit([box], view);
	const b = fitInto([box], view, { x: 0, y: 0, width: 1400, height: 900 });
	assert.equal(b.zoom, a.zoom);
	assert.equal(b.x, a.x);
	assert.equal(b.y, a.y);
});

test("fitInto zooms to the region, not the window", () => {
	const view = { width: 1400, height: 900 };
	const box = { x: 0, y: 0, w: 1000, h: 500 };
	const region = { x: 276, y: 52, width: 800, height: 800 };
	const camera = fitInto([box], view, region);
	// 800 wide minus a 24px floor each side, over 1000 of board.
	assert.equal(camera.zoom, (800 - EDGE_FLOOR * 2) / 1000);
});

test("fitInto puts the content in the middle of the region, not of the window", () => {
	const view = { width: 1400, height: 900 };
	const box = { x: 0, y: 0, w: 200, h: 200 };
	// A left panel only: the region's centre is left of the window's, so the camera has to
	// look right of the content for the content to appear centred in the region.
	const region = { x: 400, y: 0, width: 1000, height: 900 };
	const camera = fitInto([box], view, region);
	const screenCentreOfRegion = region.x + region.width / 2;
	const at = toScreen(camera, view, { x: 100, y: 100 });
	assert.ok(Math.abs(at.x - screenCentreOfRegion) < 0.001, `content centred at ${at.x}, region at ${screenCentreOfRegion}`);
});

test("a board flown to inside the chrome stays above INTERACT_ZOOM", () => {
	// The actual failure: 1400x900 window, 264px panel and a 320px inspector, one 1600px
	// board. With `breathingRoom` added on top of the panels this came out at 0.42.
	const view = { width: 1400, height: 900 };
	const region = { x: 288, y: 52, width: 1400 - 288 - 344, height: 900 - 52 - 12 };
	const camera = fitInto([{ x: 0, y: 0, w: 1600, h: 1000 }], view, region);
	assert.ok(camera.zoom >= 0.4, `zoom ${camera.zoom}`);
});

test("a glide's two ends are the cameras it was given, exactly", () => {
	const from = { x: 0.1, y: -12.5, zoom: 0.3 };
	const to = { x: 0.3, y: 4000.25, zoom: 2.4 };
	assert.equal(between(from, to, 0), from);
	assert.equal(between(from, to, 1), to);
	// And not by arithmetic: `0.1 + (0.3 - 0.1)` is 0.30000000000000004, so a last frame that
	// multiplied its way to the end would leave every glide a hair off the fit it was asked for.
	assert.equal(between(from, to, 1).x, 0.3);
	assert.equal(between(from, to, -3), from, "a t outside the move is clamped, not extrapolated");
	assert.equal(between(from, to, 4), to);
});

test("halfway through a glide is halfway for the camera's position, and the geometric mean for its zoom", () => {
	const from = { x: -1000, y: 500, zoom: 0.2 };
	const to = { x: 2000, y: -1500, zoom: 2.4 };
	const half = between(from, to, 0.5);
	assert.equal(half.x, 500);
	assert.equal(half.y, -500);
	// 0.69, not the 1.3 a linear interpolation would give: zoom is a ratio, and the *rate* of
	// scaling is what a person sees. The wrong one lurches and then crawls.
	assert.ok(Math.abs(half.zoom - Math.sqrt(0.2 * 2.4)) < 1e-12, `zoom ${half.zoom}`);
});

test("a glide never overshoots and never goes backwards", () => {
	const from = { x: 0, y: 0, zoom: 1 };
	const to = { x: 900, y: -400, zoom: 0.25 };
	let last = from;
	for (let step = 0; step <= 40; step++) {
		const at = between(from, to, easeOutCubic(step / 40));
		assert.ok(at.x >= last.x && at.y <= last.y && at.zoom <= last.zoom, `overshot at step ${step}: ${JSON.stringify(at)}`);
		assert.ok(at.x <= to.x && at.y >= to.y && at.zoom >= to.zoom, `past the target at step ${step}`);
		last = at;
	}
	assert.deepEqual(last, to);
});

test("the ease leaves at speed and arrives slowly", () => {
	assert.equal(easeOutCubic(0), 0);
	assert.equal(easeOutCubic(1), 1);
	// The first tenth of the time is already a quarter of the distance; the last tenth is 1%.
	assert.ok(easeOutCubic(0.1) > 0.25, String(easeOutCubic(0.1)));
	assert.ok(1 - easeOutCubic(0.9) < 0.01, String(1 - easeOutCubic(0.9)));
	for (let t = 0; t < 1; t += 0.05) assert.ok(easeOutCubic(t) < easeOutCubic(t + 0.05), `not rising at ${t}`);
});

/*
 * Landing on a stage from the manager: the middle of its work, not a fit of everything it holds.
 *
 * The case that decides the rule is the stray board — one board parked a long way from the rest.
 * A fit has to include it, so it takes the whole stage down to a zoom where nothing reads; the
 * weighted middle barely notices it, which is the right answer, because a board nobody has
 * looked at in a month is not what you came to see.
 */
const REGION = { x: 0, y: 0, width: 1200, height: 800 };
const VIEW = { width: 1200, height: 800 };

test("landing frames the middle of the work, and a stray board does not drag it", () => {
	const cluster = [
		{ x: 0, y: 0, w: 1000, h: 700 },
		{ x: 1040, y: 0, w: 1000, h: 700 },
	];
	const near = middleOf(cluster, REGION, VIEW);
	const strayed = middleOf([...cluster, { x: 40000, y: 30000, w: 300, h: 200 }], REGION, VIEW);
	assert.ok(Math.abs(near.x - 1020) < 1, `the middle of the pair: ${near.x}`);
	// The median lands on a board of the cluster, and the stray one 39,000px away cannot move it off.
	assert.ok(strayed.x >= 0 && strayed.x <= 2040, `landed at ${Math.round(strayed.x)}, which should be inside the cluster`);
	assert.ok(fit([...cluster, { x: 40000, y: 30000, w: 300, h: 200 }], VIEW).zoom < 0.1, "where a fit of the same boards is unreadable");
});

/*
 * Arriving is a looking scale, the same one every time.
 *
 * Deliberately below the line where a board takes pointer events: what an arrival answers is
 * "what is on this stage", which is several boards at once. A zoom worked out from the boards
 * would make every arrival a different size, and the gesture would never become a habit.
 */
test("every landing is at the same zoom, whatever the stage holds", () => {
	const one = middleOf([{ x: 0, y: 0, w: 1000, h: 700 }], REGION, VIEW);
	const many = middleOf([{ x: 0, y: 0, w: 9000, h: 6000 }, { x: 200, y: 200, w: 200, h: 120 }], REGION, VIEW);
	assert.equal(one.zoom, STAGE_ZOOM);
	assert.equal(many.zoom, STAGE_ZOOM);
	assert.ok(STAGE_ZOOM < INTERACT_ZOOM, "a looking scale, not a working one");
});

test("an empty stage leaves the camera where it is, at the same arriving zoom", () => {
	const kept = middleOf([], REGION, VIEW, { x: 50, y: 60, zoom: 0.02 });
	assert.deepEqual({ x: kept.x, y: kept.y }, { x: 50, y: 60 });
	assert.equal(kept.zoom, STAGE_ZOOM);
});
