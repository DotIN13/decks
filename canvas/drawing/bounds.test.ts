import assert from "node:assert/strict";
import { test } from "node:test";
import { expand, layout, type PenDocument } from "@decks/pen";
import { boundsOf } from "./bounds.ts";

test("a path is bounded by what it draws, not by its viewBox's box", () => {
	const doc: PenDocument = {
		version: "2.14",
		children: [{ type: "path", id: "p", x: 100, y: 100, width: 600, height: 700, viewBox: [0, 0, 600, 700], geometry: "M300 30 L360 30 L360 260 L300 260 Z" }],
	};
	const placed = layout(doc, expand(doc), { theme: {} });
	assert.deepEqual(boundsOf(placed).get("p"), { x: 400, y: 130, w: 60, h: 230 });
});
