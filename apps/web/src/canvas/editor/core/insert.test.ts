import assert from "node:assert/strict";
import { test } from "node:test";
import { drawHints, insertPick, menuPick, menuPlace, menuShift, opensWords } from "./insert.ts";

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

test("a pick in the canvas menu: the arrow in hand, a shape or an icon to the panel, the rest made", () => {
	assert.deepEqual(menuPick("arrow"), { do: "arm", tool: "arrow" });
	assert.deepEqual(menuPick("shape"), { do: "panel", tab: "shapes" });
	assert.deepEqual(menuPick("icon"), { do: "panel", tab: "icons" });
	assert.deepEqual(menuPick("note"), { do: "make", tool: "note" });
});

test("a pick in the insert panel: an icon changed, put where the menu was, or armed", () => {
	const icon = { library: "lucide", name: "heart" };
	assert.deepEqual(insertPick({ replace: "i1", at: { x: 1, y: 2 } }, "icon", icon), { do: "update", ops: [{ op: "update", id: "i1", set: { library: "lucide", icon: "heart", name: "heart" } }] });
	// A shape is never a replacement.
	assert.deepEqual(insertPick({ replace: "i1", at: { x: 1, y: 2 } }, "shape", icon), { do: "make", at: { x: 1, y: 2 } });
	assert.deepEqual(insertPick({}, "shape", icon), { do: "arm" });
	assert.deepEqual(insertPick(undefined, "icon", icon), { do: "arm" });
});

test("the canvas menu sits at the point, on the screen, above it in the lower half", () => {
	const screen = { w: 1000, h: 800 };
	assert.deepEqual(menuPlace({ x: 300, y: 200 }, screen), { left: 300, top: 200, width: 220, above: false });
	assert.deepEqual(menuPlace({ x: 900, y: 600 }, screen), { left: 772, top: 600, width: 220, above: true });
	assert.deepEqual(menuPlace({ x: 2, y: 400 }, screen), { left: 8, top: 400, width: 220, above: false });
	assert.equal(menuShift(true), "translateY(calc(-100% - 12px))");
	assert.equal(menuShift(false), "translateY(12px)");
});
