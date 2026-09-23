import assert from "node:assert/strict";
import { test } from "node:test";
import { expand, layout, type PenDocument } from "@decks/pen";
import { backdrops, boundsOf } from "./bounds.ts";

const board = (id: string, x: number, y: number) => ({ type: "browser", id, x, y, width: 100, height: 80, metadata: { type: "decks.board", path: `boards/${id}.html` } });

test("a backdrop is an item listed before a board that holds the whole board; everything else is over the boards", () => {
	const doc: PenDocument = {
		version: "2.14",
		children: [
			{ type: "frame", id: "panel", layout: "none", x: 0, y: 0, width: 400, height: 300 },
			{ type: "rectangle", id: "partly", x: 150, y: 20, width: 100, height: 100 },
			board("b", 20, 20),
			{ type: "frame", id: "after", layout: "none", x: 0, y: 0, width: 400, height: 300 },
		],
	};
	const nodes = expand(doc);
	const placed = layout(doc, nodes, { theme: {} });
	assert.deepEqual([...backdrops(nodes, boundsOf(placed), placed)], ["panel"]);
});

test("a path is bounded by what it draws, not by its viewBox's box", () => {
	const doc: PenDocument = {
		version: "2.14",
		children: [{ type: "path", id: "p", x: 100, y: 100, width: 600, height: 700, viewBox: [0, 0, 600, 700], geometry: "M300 30 L360 30 L360 260 L300 260 Z" }],
	};
	const placed = layout(doc, expand(doc), { theme: {} });
	assert.deepEqual(boundsOf(placed).get("p"), { x: 400, y: 130, w: 60, h: 230 });
});
