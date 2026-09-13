import assert from "node:assert/strict";
import { test } from "node:test";
import { BOARD_CLASSES, BOX_CLASSES, CALLOUT_TONES, COMPONENTS, COMPONENT_KINDS, PALETTE, component } from "./index.ts";

/**
 * The vocabulary, checked against itself.
 *
 * Everything here is a property of the data — a duplicate, an omission, a key two kinds
 * share — and it is here rather than in the server or the browser because it has nothing to
 * do with either. What the *apps* check is the half that cannot be data: that `board.css`
 * styles these classes and the authoring skill teaches them (`boards/vocabulary.test.ts`).
 */

test("the specs and the kinds are the same list", () => {
	assert.deepEqual(
		COMPONENTS.map((spec) => spec.kind),
		[...COMPONENT_KINDS],
		"the order of COMPONENTS is the palette's order, so this is a real comparison, not a set one",
	);
	for (const kind of COMPONENT_KINDS) assert.ok(component(kind), `${kind} has no spec`);
});

test("an unknown kind is not a component", () => {
	assert.equal(component("note"), undefined);
});

test("a palette key is one letter, lower case, and belongs to one kind", () => {
	const seen = new Set<string>();
	for (const spec of PALETTE) {
		assert.match(spec.key, /^[a-z]$/, `${spec.kind}'s key must be a single lower-case letter`);
		assert.ok(!seen.has(spec.key), `two kinds are armed by "${spec.key}"`);
		seen.add(spec.key);
	}
	// `select` owns v, and the manifest must not take it: Stage's key map is built from
	// this list plus `v`, and a collision would silently overwrite one of them.
	assert.ok(!seen.has("v"), "v is the select tool's key");
});

test("only the kinds with a key are on the palette", () => {
	assert.deepEqual(
		PALETTE.map((spec) => spec.kind),
		COMPONENTS.filter((spec) => spec.key !== undefined).map((spec) => spec.kind),
	);
	// An image arrives by dropping one on a board. A palette button for it would open a file
	// picker for the same thing, which is why the absence here is deliberate rather than a
	// key somebody forgot to add.
	assert.ok(!PALETTE.some((spec) => spec.kind === "image"));
});

test("a component is inserted with a class the stylesheet knows", () => {
	for (const spec of COMPONENTS) {
		// `embed` is the one class in this list that is not in the prose vocabulary: an embed
		// is not a box of words an agent writes by hand, it is a component the app makes, and
		// the skill teaches it in its own section with its own `data-embed`.
		const known = spec.className === "embed" || BOARD_CLASSES.some((entry) => entry.name === spec.className);
		assert.ok(known, `${spec.kind} is inserted as .${spec.className}, which is not a class the vocabulary names`);
	}
});

test("a kind that holds text says what a new one starts with, and one that does not holds nothing", () => {
	const worded = ["sticky", "card", "text"];
	for (const spec of COMPONENTS) {
		if (worded.includes(spec.kind)) assert.ok((spec.text ?? "").length > 0, `${spec.kind} is inserted empty`);
		else assert.equal(spec.text, undefined, `${spec.kind} holds no words of its own`);
	}
});

test("a new component has a size a board can hold", () => {
	for (const spec of COMPONENTS) {
		assert.ok(spec.size.width > 0 && spec.size.width <= 1200, `${spec.kind}'s width`);
		if (spec.size.height !== undefined) assert.ok(spec.size.height > 0, `${spec.kind}'s height`);
	}
});

test("the box classes are a subset of the vocabulary, and the only swappable ones", () => {
	const names = BOARD_CLASSES.map((entry) => entry.name);
	for (const name of BOX_CLASSES) assert.ok(names.includes(name), `.${name} is a box class the vocabulary does not list`);
	assert.deepEqual(
		BOARD_CLASSES.filter((entry) => entry.box).map((entry) => entry.name),
		[...BOX_CLASSES],
	);
});

test("no class is listed twice, and a callout tone is not an empty word", () => {
	assert.equal(new Set(BOARD_CLASSES.map((entry) => entry.name)).size, BOARD_CLASSES.length);
	assert.equal(new Set(CALLOUT_TONES).size, CALLOUT_TONES.length);
	for (const tone of CALLOUT_TONES) assert.ok(tone.length > 0);
});

/**
 * The one box class that is not on the palette, pinned so the decision stays visible.
 *
 * A callout is made by swapping a box the inspector already knows how to swap. If a future
 * change puts one on the palette, this test fails — not because that would be wrong, but
 * because it would be a decision, and this is where the decision is written down.
 */
test("callout is reachable by swapping and not by placing, on purpose", () => {
	const placeable = new Set(COMPONENTS.map((spec) => spec.className));
	assert.deepEqual(
		BOX_CLASSES.filter((name) => !placeable.has(name)),
		["callout"],
	);
});
