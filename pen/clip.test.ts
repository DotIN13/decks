import assert from "node:assert/strict";
import { test } from "node:test";
import { clipFromHtml, clipHtml, clipItems, pastedItems, type Clip } from "./clip.ts";
import { placements } from "./read.ts";
import { baseTheme } from "./values.ts";
import type { PenDocument } from "./types.ts";

const doc = {
	version: "2.14",
	children: [
		{ type: "note", id: "a", content: "A", x: 0, y: 0, width: 100, height: 60 },
		{ type: "note", id: "b", content: "B", x: 300, y: 0, width: 100, height: 60 },
		{ type: "path", id: "ab", metadata: { type: "decks.arrow", from: "a", to: "b" }, x: 100, y: 30, width: 200, height: 1, geometry: "M0 0 L200 0" },
		{ type: "frame", id: "f", x: 0, y: 200, width: 300, height: 200, layout: "none", children: [{ type: "rectangle", id: "r", x: 20, y: 30, width: 50, height: 40 }] },
	],
} as unknown as PenDocument;
const placed = placements(doc, { theme: baseTheme(doc, "light") });

test("a copy takes the selected items whole, lifts one out of its frame, and frees an arrow's end on what stays", () => {
	const taken = clipItems(doc, ["b", "ab", "r"], placed)!;
	assert.deepEqual(taken.items.map((one) => one.id), ["b", "ab", "r"]);
	const rect = taken.items[2]!;
	assert.deepEqual([rect.x, rect.y], [20, 230], "placed where it is drawn");
	const arrow = taken.items[1]!.metadata as unknown as { from: unknown; to: unknown };
	assert.ok(Array.isArray(arrow.from), "the end on a, left behind, is a point");
	assert.equal(arrow.to, "b");
	assert.deepEqual(clipItems(doc, ["f", "r"], placed)!.items.map((one) => one.id), ["f"], "an item inside another taken goes with it");
});

test("a paste gives every item a new id, joins the arrow to the copies and moves them", () => {
	const taken = clipItems(doc, ["a", "b", "ab"], placed)!;
	const pasted = pastedItems(taken.items, new Set(["a", "b", "ab"]), { dx: 10, dy: 20 });
	const [a, b, ab] = pasted.items;
	assert.ok(![a!.id, b!.id, ab!.id].some((id) => ["a", "b", "ab"].includes(id)));
	assert.deepEqual(ab!.metadata, { type: "decks.arrow", from: a!.id, to: b!.id });
	assert.deepEqual([b!.x, b!.y], [310, 20]);
});

test("a clip survives in html", () => {
	const clip: Clip = { v: 1, harness: "h", canvas: "c", box: { x: 0, y: 0, w: 1, h: 1 }, items: [{ type: "note", id: "n", content: 'say "<hi>" & go' } as never] };
	assert.deepEqual(clipFromHtml(clipHtml(clip, "words")), clip);
});
