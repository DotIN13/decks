import assert from "node:assert/strict";
import { test } from "node:test";
import type { Board } from "@decks/protocol";
import { selectionOnSwitch, viewOnSwitch, viewToPark } from "./agent-view.ts";

/*
 * The cases here are the ones that were found by switching agents and being 3000px from
 * anything: a camera that did not move, a remembered view of boards that no longer exist,
 * and a selection restored around a board that had been hidden since.
 */

const board = (path: string, x: number, y: number): Board => ({
	path,
	title: path,
	x,
	y,
	w: 1200,
	h: 800,
	rev: 1,
	inContext: [],
});

// The example deck's own geometry, which is where the bug was measured: 3009px apart.
const boards = [board("boards/plan.html", 0, 0), board("boards/risks.html", 1760, 0), board("boards/deep.html", 0, 2440)];
const viewport = { width: 1500, height: 1000 };
/* The canvas's own box: the window minus the boards panel on the left, which is what the
   app's Fit button frames into. A fit that centres a board behind the panel is not a fit. */
const region = { x: 276, y: 0, width: 1224, height: 1000 };
const at = (over: Record<string, unknown>) => ({ boards, viewport, region, ...over }) as Parameters<typeof viewOnSwitch>[0];
const somewhere = { x: 612, y: 2964, zoom: 0.735 };

test("an agent with nothing on the canvas leaves the camera alone", () => {
	// Moving to look at nothing is worse than not moving, and this is the common case for a
	// brand-new agent — which would otherwise jump the view on every `+`.
	assert.equal(viewOnSwitch(at({ view: undefined, playing: [] })), undefined);
	assert.equal(viewOnSwitch(at({ view: { camera: somewhere }, playing: [] })), undefined);
});

test("…including when everything it remembers has been deleted", () => {
	const gone = viewOnSwitch(at({ view: { camera: somewhere }, playing: ["boards/deleted.html"] }));
	assert.equal(gone, undefined, "a path the deck no longer has is not something to look at");
});

test("a remembered view comes back exactly, not as a fresh fit of the same boards", () => {
	const back = viewOnSwitch(at({ view: { camera: somewhere }, playing: ["boards/deep.html"] }));
	assert.deepEqual(back, somewhere, "position and zoom as they were, including having scrolled into a corner");
});

test("no memory at all is a fit of what it holds", () => {
	const fresh = viewOnSwitch(at({ view: undefined, playing: ["boards/risks.html"] }));
	assert.ok(fresh, "there is something to look at, so the camera moves");
	// Centred on the board it holds, which is at 1760,0 and 1200x800.
	/*
	 * Centred on the board, and *offset* for the panel: `fitInto` shifts the camera so the
	 * board lands in the canvas's own box rather than in the middle of the window, so the x
	 * is not simply the board's centre.
	 */
	assert.ok(fresh.y > 300 && fresh.y < 500, `y ${fresh.y}`);
	assert.ok(fresh.x < 1760 + 600, `x ${fresh.x} — shifted left of centre to clear the panel`);
	/* A board smaller than the canvas is zoomed slightly *in*, which is what `fit` has always
	   done; the cap is `clampZoom`, not 1. */
	assert.ok(fresh.zoom > 0.5, `zoom ${fresh.zoom}`);
});

test("…and it frames all of them, not the first", () => {
	const both = viewOnSwitch(at({ view: undefined, playing: ["boards/plan.html", "boards/deep.html"] }));
	assert.ok(both);
	// Those two are 2440 apart vertically, so the fit must sit between them and zoom out.
	assert.ok(both.y > 800 && both.y < 2440, `y ${both.y}`);
	const one = viewOnSwitch(at({ view: undefined, playing: ["boards/plan.html"] }));
	assert.ok(one);
	assert.ok(both.zoom < one.zoom, "two boards frame wider than one");
});

test("the two agents from the measurement no longer share a view", () => {
	/*
	 * This is the reported bug, as a test. Ada showed `deep` and Bo showed `risks`; switching
	 * left the camera byte-identical, 2200 screen pixels from Bo's only board.
	 */
	const ada = viewOnSwitch(at({ view: undefined, playing: ["boards/deep.html"] }));
	const bo = viewOnSwitch(at({ view: undefined, playing: ["boards/risks.html"] }));
	assert.notDeepEqual(ada, bo);
	// And once each has a memory, coming back is exact rather than approximate.
	assert.ok(ada);
	const parked = viewToPark(ada, "boards/deep.html");
	assert.deepEqual(viewOnSwitch(at({ view: parked, playing: ["boards/deep.html"] })), ada);
});

test("parking copies the camera, so a later pan does not rewrite the memory", () => {
	const live = { x: 10, y: 20, zoom: 0.5 };
	const parked = viewToPark(live, "boards/plan.html");
	live.x = 999;
	assert.equal(parked.camera.x, 10, "the record is a copy, not a reference to the live signal");
	assert.equal(parked.selected, "boards/plan.html");
	assert.equal(viewToPark(live, undefined).selected, undefined, "no selection is no field");
});

test("a selection comes back only if its board is still on that canvas", () => {
	assert.equal(selectionOnSwitch({ camera: somewhere, selected: "boards/plan.html" }, ["boards/plan.html"]), "boards/plan.html");
	assert.equal(selectionOnSwitch({ camera: somewhere, selected: "boards/plan.html" }, ["boards/risks.html"]), undefined, "hidden since: a handle around nothing");
	assert.equal(selectionOnSwitch({ camera: somewhere }, ["boards/plan.html"]), undefined, "nothing was selected");
	assert.equal(selectionOnSwitch(undefined, ["boards/plan.html"]), undefined, "no memory at all");
});
