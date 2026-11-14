import assert from "node:assert/strict";
import { test } from "node:test";
import { foldedOf, tabBeside, tabOf, toggled } from "./model.ts";

// The side panel opens on the tab last left, keeps folders folded, and steps between tabs round the ends.

test("a kept tab opens; anything else opens Recent", () => {
	assert.equal(tabOf("apps"), "apps");
	assert.equal(tabOf("files"), "recent");
	assert.equal(tabOf(null), "recent");
});

test("folded folders are the strings of a kept list; a broken list is none", () => {
	assert.deepEqual([...foldedOf('["a", 2, "b"]')], ["a", "b"]);
	assert.deepEqual([...foldedOf("{")], []);
	assert.deepEqual([...toggled(new Set(["a"]), "a")], []);
	assert.deepEqual([...toggled(new Set(), "b")], ["b"]);
});

test("the arrows step round the ends of the tabs", () => {
	assert.equal(tabBeside("recent", -1), "apps");
	assert.equal(tabBeside("apps", 1), "recent");
	assert.equal(tabBeside("canvas", 1), "agents");
});
