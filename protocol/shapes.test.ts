import { test } from "node:test";
import assert from "node:assert/strict";
import { idsOf } from "./shapes.ts";

// The ids an op touches, one rule for the canvas, news and the kernel.

test("each op names the ids it touches", () => {
	assert.deepEqual(idsOf({ op: "insert", item: { type: "note", id: "n1" } }), ["n1"]);
	assert.deepEqual(idsOf({ op: "insert", item: { type: "note" } }), []);
	assert.deepEqual(idsOf({ op: "update", id: "n1", set: { text: "hi" } }), ["n1"]);
	assert.deepEqual(idsOf({ op: "replace", id: "n1", item: { type: "note" } }), ["n1"]);
	assert.deepEqual(idsOf({ op: "delete", id: "n1" }), ["n1"]);
	assert.deepEqual(idsOf({ op: "move", id: "n1", at: { x: 0, y: 0 } }), ["n1"]);
	assert.deepEqual(idsOf({ op: "copy", id: "n1", as: "n2" }), ["n1", "n2"]);
	assert.deepEqual(idsOf({ op: "copy", id: "n1" }), ["n1"]);
	assert.deepEqual(idsOf({ op: "variables", set: { brand: "#000" } }), []);
});
