import assert from "node:assert/strict";
import { test } from "node:test";
import { itemOp } from "./decks.ts";

// pen.dev's own op form becomes an item op: the box's corner as at, its far corner as the size.

test("an insert's box gives the item its corner and its size", () => {
	assert.deepEqual(itemOp({ op: "insert", node: { type: "rectangle", id: "r" }, box: { x1: 10, y1: 20, x2: 110, y2: 70 } }), { op: "insert", item: { type: "rectangle", id: "r", width: 100, height: 50 }, at: { x: 10, y: 20 } });
});

test("a box with only a corner places the item at its own size; other ops pass as they are", () => {
	assert.deepEqual(itemOp({ op: "insert", node: { type: "ref", ref: "f" }, box: { x1: 1, y1: 2 } }), { op: "insert", item: { type: "ref", ref: "f" }, at: { x: 1, y: 2 } });
	assert.deepEqual(itemOp({ op: "delete", id: "x" }), { op: "delete", id: "x" });
});
