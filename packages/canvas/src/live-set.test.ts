import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseLive, EMPTY_LIVE, type LiveChoice, type LiveSet } from "./live-set.ts";

/** A row of boards a…j, one unit apart; the window shows `from` to `to`, its middle `centre`. */
const row = "abcdefghij".split("");
const at = (from: number, to: number, centre: number, was: LiveSet = EMPTY_LIVE, more: Partial<LiveChoice> = {}): LiveSet =>
	chooseLive({
		was,
		liveZoom: true,
		near: row.map((path, i) => ({ path, distance: Math.abs(i - centre) })),
		inWindow: (path) => row.indexOf(path) >= from && row.indexOf(path) <= to,
		exists: (path) => row.includes(path),
		limit: 3,
		keep: 2,
		...more,
	});

test("the nearest boards come up first", () => {
	assert.deepEqual(at(0, 4, 2).live, ["c", "b", "d"]);
});

test("a short pan keeps every page still on screen", () => {
	const first = at(0, 4, 2);
	const after = at(1, 5, 3.4, first);
	assert.deepEqual(new Set(after.live), new Set(["c", "b", "d"]));
	assert.deepEqual(after.hidden, []);
});

test("a board that leaves the window is let go, and kept hidden", () => {
	const first = at(0, 4, 2);
	const after = at(3, 7, 5, first);
	assert.deepEqual(new Set(after.live), new Set(["d", "e", "f"]));
	assert.deepEqual(new Set(after.hidden), new Set(["c", "b"]));
});

test("panning back loads nothing: every page shown was up or hidden", () => {
	const first = at(0, 4, 2);
	const away = at(3, 7, 5, first);
	const back = at(0, 4, 2, away);
	const had = new Set([...away.live, ...away.hidden]);
	assert.ok(back.live.every((path) => had.has(path)), `${back.live} from ${[...had]}`);
});

test("the selected board is live at any zoom, and below the live zoom alone", () => {
	const first = at(0, 4, 2);
	const out = at(0, 9, 5, first, { liveZoom: false, selected: "j" });
	assert.deepEqual(out.live, ["j"]);
	assert.deepEqual(new Set(out.hidden), new Set(["c", "b"]));
});

test("a board taken off the canvas leaves both lists", () => {
	const first = at(0, 4, 2);
	const after = at(0, 4, 2, first, { exists: (path) => path !== "c" && row.includes(path) });
	assert.ok(!after.live.includes("c") && !after.hidden.includes("c"));
});
