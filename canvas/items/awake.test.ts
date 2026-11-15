import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxIndex } from "../render/spatial.ts";
import { chooseAwake, sameAwake, surfaceState, type AwakeItem } from "./awake.ts";

const view = { width: 1000, height: 800 };
/**
 * A row of 300×200 items 400 apart along y = 0, `i0` at x = 0: card, card, card, app, card, card, card,
 * document, … (every fourth an app, every eighth a document in an app's place), and one old board.
 */
const kindOf = (i: number) => (i % 8 === 7 ? "document" : i % 4 === 3 ? "app" : "card");
const items: AwakeItem[] = [...Array.from({ length: 24 }, (_, i) => ({ path: `i${i}`, x: i * 400, y: 0, w: 300, h: 200, kind: kindOf(i) as "card" | "app" | "document" })), { path: "board", x: 1200, y: 2000, w: 300, h: 200 }];
const index = new BoxIndex(items);
const at = (x: number, zoom = 1) => ({ x, y: 100, zoom });
const budget = { live: { card: 3, app: 1, document: 1 }, kept: 2 };

test("the nearest items to the middle of the screen are awake, each kind cut to its budget", () => {
	// The middle is on i5 (2000..2300): i4 and i6, 100 px either side; i3 is an app, i7 a document.
	const { live } = chooseAwake({ index, items, rest: at(2150), view, budget });
	assert.deepEqual(live, ["i5", "i4", "i6", "i3", "i7"]);
});

test("an app past its budget sleeps, however near: the nearest one runs", () => {
	// Middle on i3 (an app, 1200..1500); i7 is the next app, 1600 px right, within half a window... not: window is 1000 wide at 1×, so i7 at 2800 is out of reach.
	const wide = { width: 4000, height: 800 };
	const { live } = chooseAwake({ index: new BoxIndex(items), items, rest: at(1350), view: wide, budget: { live: { card: 0, app: 1, document: 0 }, kept: 0 } });
	assert.deepEqual(live, ["i3"]);
	// With room for two apps, the next nearest app follows.
	const two = chooseAwake({ index, items, rest: at(1350), view: wide, budget: { live: { card: 0, app: 2, document: 0 }, kept: 0 } });
	assert.deepEqual(two.live, ["i3", "i11"]);
});

test("an app that becomes nearest takes the place of one that was", () => {
	const wide = { width: 4000, height: 800 };
	const apps = { live: { card: 0, app: 1, document: 0 }, kept: 1 };
	const first = chooseAwake({ index, items, rest: at(1350), view: wide, budget: apps });
	assert.deepEqual(first.live, ["i3"]);
	const moved = chooseAwake({ index, items, rest: at(4550), view: wide, budget: apps, was: first });
	assert.deepEqual(moved.live, ["i11"]);
	assert.deepEqual(moved.kept, ["i3"]);
});

test("an old board is never awake, not even selected", () => {
	const { live } = chooseAwake({ index, items, rest: at(1350, 1), view, budget, selected: "board" });
	assert.ok(!live.includes("board"));
});

test("below the live zoom nothing is awake, whatever its kind", () => {
	assert.deepEqual(chooseAwake({ index, items, rest: at(2150, 0.39), view, budget }).live, []);
	assert.equal(chooseAwake({ index, items, rest: at(2150, 0.4), view, budget }).live.length, 5);
});

test("the selected item is awake at any zoom, anywhere, beside its kind's budget", () => {
	const low = chooseAwake({ index, items, rest: at(2150, 0.1), view, budget, selected: "i23" });
	assert.deepEqual(low.live, ["i23"]);
	// Selected and the only app near: the app budget still fills with the next app, i7 being a document.
	const app = chooseAwake({ index, items, rest: at(1350), view: { width: 4000, height: 800 }, budget: { live: { card: 0, app: 1, document: 0 }, kept: 0 }, selected: "i3" });
	assert.deepEqual(app.live, ["i3", "i11"]);
});

test("items let go are kept, the latest first, up to the budget's kept, of any kind", () => {
	const first = chooseAwake({ index, items, rest: at(2150), view, budget });
	const moved = chooseAwake({ index, items, rest: at(6150), view, budget, was: first });
	// The window at 6150 reaches 5150..7650: i13 (an app, at 5200) is near; i11 and i19 are not.
	assert.deepEqual(moved.live, ["i15", "i14", "i16", "i13"]);
	assert.deepEqual(moved.kept, ["i5", "i4"]);
	const gone = chooseAwake({ index: new BoxIndex(items.slice(6)), items: items.slice(6), rest: at(6150, 0.2), view, budget, was: moved });
	assert.deepEqual(gone.live, []);
	assert.deepEqual(gone.kept, ["i15", "i14"]);
});

test("the same camera gives the same answer, so a rest that changes nothing reaches no item", () => {
	const a = chooseAwake({ index, items, rest: at(2150), view, budget });
	const b = chooseAwake({ index, items, rest: at(2150), view, budget, was: a });
	assert.ok(sameAwake(a, b));
	assert.ok(!sameAwake(a, { live: [...a.live].reverse().slice(1), kept: a.kept }));
});

test("the five states, from what the stage knows", () => {
	assert.equal(surfaceState({ live: true, kept: false, leaving: false, shown: false }), "waking");
	assert.equal(surfaceState({ live: true, kept: false, leaving: false, shown: true }), "live");
	assert.equal(surfaceState({ live: false, kept: true, leaving: false, shown: true }), "kept");
	assert.equal(surfaceState({ live: false, kept: false, leaving: true, shown: true }), "leaving");
	assert.equal(surfaceState({ live: false, kept: false, leaving: false, shown: false }), "picture");
});
