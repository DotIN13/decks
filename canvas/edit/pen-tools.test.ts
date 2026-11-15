import assert from "node:assert/strict";
import { test } from "node:test";
import { feedSelection, keptSelection, penSelection, setPenSelection } from "./pen-tools.ts";

/** A stage's editor as `feedSelection` sees it: its items, and a way to set them. */
const stage = (start: readonly string[]) => {
	let items = start;
	return { items: () => items, select: (next: readonly string[]) => (items = next) };
};

test("the selection survives a stage mounting again, as the page's own signal did before the editor held it", () => {
	setPenSelection([]);
	// A stage starts with what is kept: nothing yet.
	const first = stage(keptSelection());
	const giveBack = feedSelection(first);
	assert.deepEqual(penSelection(), []);
	// The properties panel and the stage select through the one selection.
	setPenSelection(["a", "b"]);
	assert.deepEqual(first.items(), ["a", "b"]);
	assert.deepEqual(keptSelection(), ["a", "b"], "a stage mounted beside it starts with it too");
	first.select(["b"]);
	assert.deepEqual(penSelection(), ["b"]);
	// The stage goes: what it had selected is kept, and the next one starts with it.
	giveBack();
	assert.deepEqual(penSelection(), ["b"]);
	assert.deepEqual(keptSelection(), ["b"]);
	const second = stage(keptSelection());
	const giveBackSecond = feedSelection(second);
	assert.deepEqual(second.items(), ["b"]);
	assert.deepEqual(penSelection(), ["b"]);
	giveBackSecond();
});

test("a stage replaced before it is put away does not write over the one that replaced it", () => {
	setPenSelection([]);
	const old = stage(["x"]);
	const giveBackOld = feedSelection(old);
	const next = stage(keptSelection());
	const giveBackNext = feedSelection(next);
	assert.deepEqual(next.items(), ["x"]);
	next.select(["y"]);
	giveBackOld();
	assert.deepEqual(penSelection(), ["y"], "the old stage's give-back is a no-op");
	giveBackNext();
	assert.deepEqual(keptSelection(), ["y"]);
});

test("a switch of connection clears what is kept (`connections/switch.ts`)", () => {
	const one = stage(["a"]);
	feedSelection(one)();
	assert.deepEqual(keptSelection(), ["a"]);
	// The stage is unmounted by then, so this is the kept selection it clears.
	setPenSelection([]);
	assert.deepEqual(keptSelection(), []);
	assert.deepEqual(penSelection(), []);
});
