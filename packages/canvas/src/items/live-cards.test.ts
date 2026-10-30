import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxIndex } from "../render/spatial.ts";
import { chooseLive, sameLive } from "./live-cards.ts";

const view = { width: 1000, height: 800 };
/** A row of 300×200 cards 400 apart along y = 0, `a0` at x = 0, and one board in the middle. */
const items = [
	...Array.from({ length: 20 }, (_, i) => ({ path: `a${i}`, x: i * 400, y: 0, w: 300, h: 200, card: true })),
	{ path: "board", x: 1200, y: 0, w: 300, h: 200 },
];
const index = new BoxIndex(items);
const at = (x: number, zoom = 1) => ({ x, y: 100, zoom });
const budget = { live: 3, kept: 2 };

test("the nearest cards to the middle of the screen are live, cut to the budget", () => {
	// The middle is on a5 (2000..2300): then a4 and a6, 100 px either side.
	const { live } = chooseLive({ index, items, rest: at(2150), view, budget });
	assert.deepEqual(live, ["a5", "a4", "a6"]);
});

test("a board is never chosen", () => {
	const { live } = chooseLive({ index, items, rest: at(1350), view, budget: { live: 5, kept: 0 } });
	assert.ok(!live.includes("board"));
	assert.equal(live[0], "a3");
});

test("only cards near the window: none far off, however large the budget", () => {
	const { live } = chooseLive({ index, items, rest: at(2150), view, budget: { live: 50, kept: 0 } });
	// The window is 1000 wide and half a window more each side: x from 1150 to 3150.
	assert.deepEqual([...live].sort(), ["a3", "a4", "a5", "a6", "a7"].sort());
});

test("below the card live zoom no card is live", () => {
	assert.deepEqual(chooseLive({ index, items, rest: at(2150, 0.39), view, budget }).live, []);
	assert.equal(chooseLive({ index, items, rest: at(2150, 0.4), view, budget }).live.length, 3);
});

test("the selected card is live at any zoom, anywhere, beside the budget", () => {
	const low = chooseLive({ index, items, rest: at(2150, 0.1), view, budget, selected: "a19" });
	assert.deepEqual(low.live, ["a19"]);
	const high = chooseLive({ index, items, rest: at(2150), view, budget, selected: "a19" });
	assert.deepEqual(high.live, ["a19", "a5", "a4", "a6"]);
	// Selected and near: counted once, and the budget still fills with others.
	const near = chooseLive({ index, items, rest: at(2150), view, budget, selected: "a5" });
	assert.deepEqual(near.live, ["a5", "a4", "a6", "a3"]);
	// A selected board is no card.
	assert.deepEqual(chooseLive({ index, items, rest: at(2150, 0.1), view, budget, selected: "board" }).live, []);
});

test("cards let go are kept, the latest first, up to the budget's kept", () => {
	const first = chooseLive({ index, items, rest: at(2150), view, budget });
	const moved = chooseLive({ index, items, rest: at(6150), view, budget, was: first });
	assert.deepEqual(moved.live, ["a15", "a14", "a16"]);
	assert.deepEqual(moved.kept, ["a5", "a4"]);
	// Zoomed out: everything live is let go, the kept ones after them.
	const out = chooseLive({ index, items, rest: at(6150, 0.2), view, budget, was: moved });
	assert.deepEqual(out.live, []);
	assert.deepEqual(out.kept, ["a15", "a14"]);
	// A card gone from the canvas is not kept.
	const fewer = items.filter((item) => item.path !== "a15");
	assert.deepEqual(chooseLive({ index: new BoxIndex(fewer), items: fewer, rest: at(6150, 0.2), view, budget, was: moved }).kept, ["a14", "a16"]);
});

test("the same choice is the same, whatever the order", () => {
	assert.ok(sameLive({ live: ["a", "b"], kept: ["c"] }, { live: ["b", "a"], kept: ["c"] }));
	assert.ok(!sameLive({ live: ["a", "b"], kept: [] }, { live: ["a"], kept: ["b"] }));
});
