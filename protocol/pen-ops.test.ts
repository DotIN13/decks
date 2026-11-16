import { test } from "node:test";
import assert from "node:assert/strict";
import { itemOpOf, penOpOf, pointOf } from "./pen-ops.ts";

// A change two ways, pen's op and the item op, and back again.

test("a pen insert: a whole box goes as the item's box, a corner as x and y", () => {
	assert.deepEqual(itemOpOf({ op: "insert", node: { type: "note" }, box: { x1: 1, y1: 2, x2: 11, y2: 22 }, parent: null }), { op: "insert", item: { type: "note", box: { x1: 1, y1: 2, x2: 11, y2: 22 } }, parent: null });
	assert.deepEqual(itemOpOf({ op: "insert", node: { type: "note" }, box: { x1: 5, y1: 6 } }), { op: "insert", item: { type: "note", x: 5, y: 6 } });
});

test("a pen update: a box is a corner and a size; a lone x or y is a field", () => {
	assert.deepEqual(itemOpOf({ op: "update", id: "n", box: { x1: 0, y1: 0, x2: 100, y2: 50 } }), { op: "update", id: "n", at: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
	assert.deepEqual(itemOpOf({ op: "update", id: "n", set: { fill: "red" }, box: { x1: 9 } }), { op: "update", id: "n", set: { fill: "red", x: 9 } });
	assert.deepEqual(pointOf({ x1: 3, y1: 4 }), { x: 3, y: 4 });
});

test("an item op as a pen op: the item is the node, a corner and size the box, a lone size pen's width", () => {
	assert.deepEqual(penOpOf({ op: "insert", item: { type: "note" }, at: { x: 5, y: 6 }, beside: "a" }), { op: "insert", node: { type: "note" }, box: { x1: 5, y1: 6 }, beside: "a" });
	assert.deepEqual(penOpOf({ op: "update", id: "n", size: { w: 40 } }), { op: "update", id: "n", set: { width: 40 } });
	assert.deepEqual(penOpOf({ op: "move", id: "n", at: { x: 1, y: 2 }, parent: null }), { op: "move", id: "n", parent: null, box: { x1: 1, y1: 2 } });
	assert.deepEqual(penOpOf({ op: "delete", id: "n" }), { op: "delete", id: "n" });
});

test("there and back: an item op comes back as it went", () => {
	const ops = [
		{ op: "insert", item: { type: "note", box: { x1: 1, y1: 2, x2: 11, y2: 22 } }, parent: null },
		{ op: "update", id: "n", at: { x: 0, y: 0 }, size: { w: 100, h: 50 } },
		{ op: "replace", id: "n", item: { type: "text", id: "n" } },
		{ op: "move", id: "n", at: { x: 7, y: 8 } },
		{ op: "copy", id: "n", as: "m", at: { x: 1, y: 1 } },
		{ op: "delete", id: "n" },
	] as const;
	for (const op of ops) assert.deepEqual(itemOpOf(penOpOf(op as never)), op);
});
