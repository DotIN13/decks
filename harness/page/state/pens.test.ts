import assert from "node:assert/strict";
import { test } from "node:test";
import { nodeOf } from "./pens.ts";

// The page's copy of the drawing reads items as pen.dev nodes, as today's drawing had them.

test("a box becomes x, y, width and height; a card's title becomes its name", () => {
	const node = nodeOf({ type: "card", id: "plan", title: "The plan", box: { x1: 10, y1: 20, x2: 110, y2: 70 } } as never);
	assert.deepEqual([node.x, node.y, node.width, node.height, node.name], [10, 20, 100, 50, "The plan"]);
	assert.equal(nodeOf({ type: "note", id: "n", name: "Kept", title: "Other" } as never).name, "Kept");
});

test("children are read the same way", () => {
	const node = nodeOf({ type: "frame", id: "f", children: [{ type: "text", id: "t", box: { x1: 1, y1: 2, x2: 3, y2: 4 } }] } as never);
	assert.equal((node.children?.[0] as { width: number }).width, 2);
});
