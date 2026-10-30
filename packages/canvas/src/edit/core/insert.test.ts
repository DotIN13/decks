import assert from "node:assert/strict";
import { test } from "node:test";
import { drawHints, insertPick, opensWords } from "./insert.ts";

test("words, a note and a card open for typing when made", () => {
	assert.deepEqual(
		(["text", "note", "card", "rectangle", "ellipse", "frame", "shape", "icon", "arrow"] as const).filter(opensWords),
		["text", "note", "card"],
	);
});

test("an arrow being drawn lights up its start, and what it would join now if that is something else", () => {
	const a = { name: "a", box: { x: 0, y: 0, w: 10, h: 10 } };
	const b = { name: "b", box: { x: 50, y: 0, w: 20, h: 20 }, side: "left" as const };
	assert.deepEqual(drawHints(a, b), { joins: [a.box, b.box], sides: [{ box: b.box, side: "left" }] });
	assert.deepEqual(drawHints(a, a), { joins: [a.box], sides: [] });
	assert.deepEqual(drawHints(undefined, { name: "c", box: b.box }), { joins: [b.box], sides: [{ box: b.box }] });
	assert.deepEqual(drawHints(undefined, undefined), { joins: [], sides: [] });
});

test("a pick in the insert panel: an icon changed, put where it was opened for, or armed", () => {
	const icon = { library: "lucide", name: "heart" };
	assert.deepEqual(insertPick({ replace: "i1", at: { x: 1, y: 2 } }, "icon", icon), { do: "update", ops: [{ op: "update", id: "i1", set: { library: "lucide", icon: "heart", name: "heart" } }] });
	// A shape is never a replacement.
	assert.deepEqual(insertPick({ replace: "i1", at: { x: 1, y: 2 } }, "shape", icon), { do: "make", at: { x: 1, y: 2 } });
	assert.deepEqual(insertPick({}, "shape", icon), { do: "arm" });
	assert.deepEqual(insertPick(undefined, "icon", icon), { do: "arm" });
});
