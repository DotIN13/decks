import assert from "node:assert/strict";
import { test } from "node:test";
import type * as Solid from "solid-js";
// Solid's browser build: in node, "solid-js" is the server build, which has no reactivity to count.
// @ts-expect-error the browser build has no types of its own; they are solid-js's, given below
import * as browser from "solid-js/dist/solid.js";

const { createEffect, createRoot, createSelector, createSignal } = browser as typeof Solid;

/*
 * Why each item asks `isSelected(path)` (`page-node.tsx`) rather than `selected === path`: a click
 * should wake the item that lost the selection and the one that gained it, not every item on the canvas.
 * Each item's `selected` feeds its outline, its card's `card.active` and its app's input.
 */
const ITEMS = 500;
const CLICKS = 10;

function runs(selector: boolean): number {
	let count = 0;
	const [selected, select] = createSignal<string | undefined>();
	const dispose = createRoot((dispose) => {
		const isSelected = createSelector(selected);
		for (let i = 0; i < ITEMS; i++) {
			const path = `card-${i}`;
			createEffect(() => {
				void (selector ? isSelected(path) : selected() === path);
				count++;
			});
		}
		return dispose;
	});
	count = 0; // only what the clicks wake
	for (let c = 0; c < CLICKS; c++) select(`card-${c}`);
	dispose();
	return count;
}

test("a selection change wakes two items, not every item", () => {
	const plain = runs(false);
	const selected = runs(true);
	assert.equal(plain, ITEMS * CLICKS, `the plain comparison wakes every item at every click: ${plain}`);
	assert.ok(selected <= 2 * CLICKS, `the selector wakes the one that lost it and the one that gained it: ${selected}`);
});
