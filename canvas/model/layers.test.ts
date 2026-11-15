import assert from "node:assert/strict";
import { test } from "node:test";
import type { PenDocument } from "@decks/pen";
import { canvasItems } from "./layers.ts";

const doc = {
	version: "2.6",
	children: [
		{ type: "browser", id: "b1", name: "The finding", x: 0, y: 0, width: 400, height: 300, metadata: { type: "decks.board", path: "boards/b1.html" } },
		{ type: "note", id: "n1", x: 500, y: 0, content: "Remember\\nthe second line" },
		{ type: "path", id: "a1", metadata: { type: "decks.arrow" } },
		{ type: "text", id: "t1", name: "Title", x: 0, y: -80, content: "Hello" },
	],
} as unknown as PenDocument;

test("the Canvas tab lists the drawing's items by name, arrows as one row", () => {
	const { items, arrows } = canvasItems(doc);
	assert.deepEqual(items.map((one) => [one.kind, one.label]), [["board", "The finding"], ["note", "Remember\\nthe second line"], ["text", "Title"]]);
	assert.equal(items[0]!.board, "boards/b1.html");
	assert.deepEqual(arrows, ["a1"]);
});

test("a query narrows the items and leaves the arrows out", () => {
	const { items, arrows } = canvasItems(doc, "titl");
	assert.deepEqual(items.map((one) => one.id), ["t1"]);
	assert.deepEqual(arrows, []);
});

test("a card with no name of its own is listed by its folder, not as index", () => {
	const named = { version: "2.6", children: [{ type: "browser", id: "c1", x: 0, y: 0, width: 400, height: 300, metadata: { type: "decks.card", path: "cards/sales/index.html" } }] } as unknown as PenDocument;
	assert.deepEqual(canvasItems(named).items.map((one) => [one.kind, one.label, one.board]), [["board", "sales", "cards/sales/index.html"]]);
});
