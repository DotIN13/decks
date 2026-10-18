import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeScene } from "./fake-scene.ts";
import { penKey, type KeyContext, type KeyPress } from "./keys.ts";

const scene = fakeScene(
	[
		{ id: "a", box: { x: 10, y: 20, w: 100, h: 50 }, extra: { x: 10, y: 20 } },
		{ id: "b", box: { x: 200, y: 20, w: 100, h: 50 }, extra: { x: 200, y: 20 } },
	],
	[{ path: "boards/one.html", x: 1000, y: 0, w: 400, h: 300 }],
);
const context = (fields: Partial<KeyContext> = {}): KeyContext => {
	let n = 0;
	return { selection: ["a"], boards: [], tool: "select", boardSelected: false, canStep: true, scene, nextId: () => `n${++n}`, ...fields };
};
const key = (name: string, mods: Omit<KeyPress, "key"> = {}): KeyPress => ({ key: name, ...mods });
const none = { handled: false };

test("⌘Z undoes and ⇧⌘Z redoes, with Ctrl too, when the page can step; never with Alt", () => {
	assert.deepEqual(penKey(key("z", { meta: true }), context()), { handled: true, do: "step", step: "undo" });
	assert.deepEqual(penKey(key("Z", { meta: true, shift: true }), context()), { handled: true, do: "step", step: "redo" });
	assert.deepEqual(penKey(key("z", { ctrl: true }), context({ selection: [] })), { handled: true, do: "step", step: "undo" });
	assert.deepEqual(penKey(key("z", { meta: true, alt: true }), context()), none);
	assert.deepEqual(penKey(key("z", { meta: true }), context({ canStep: false })), none);
});

test("Delete and Backspace take the selection off, and nothing without one", () => {
	const gone = { handled: true, do: "delete", ops: [{ op: "delete", id: "a" }, { op: "delete", id: "b" }], select: [] };
	assert.deepEqual(penKey(key("Delete"), context({ selection: ["a", "b"] })), gone);
	assert.deepEqual(penKey(key("Backspace"), context({ selection: ["a", "b"] })), gone);
	assert.deepEqual(penKey(key("Delete"), context({ selection: [] })), none);
});

test("Escape puts a tool down first, then lets go of items and boards; with nothing to let go it is not the drawing's", () => {
	assert.deepEqual(penKey(key("Escape"), context({ tool: "rectangle" })), { handled: true, do: "escape", tool: "select" });
	assert.deepEqual(penKey(key("Escape"), context({ tool: "rectangle", selection: [] })), { handled: true, do: "escape", tool: "select" });
	assert.deepEqual(penKey(key("Escape"), context()), { handled: true, do: "escape", select: [], boards: [] });
	assert.deepEqual(penKey(key("Escape"), context({ selection: [], boards: ["boards/one.html"] })), { handled: true, do: "escape", select: [], boards: [] });
	assert.deepEqual(penKey(key("Escape"), context({ selection: [] })), none);
});

test("⌘D duplicates the selection 24 down and right and selects the copies", () => {
	assert.deepEqual(penKey(key("d", { meta: true }), context({ selection: ["a", "b"] })), {
		handled: true,
		do: "duplicate",
		ops: [
			{ op: "copy", id: "a", as: "n1" },
			{ op: "update", id: "n1", set: { x: 34, y: 44 } },
			{ op: "copy", id: "b", as: "n2" },
			{ op: "update", id: "n2", set: { x: 224, y: 44 } },
		],
		select: ["n1", "n2"],
	});
	assert.deepEqual(penKey(key("D", { ctrl: true }), context()).handled, true);
	assert.deepEqual(penKey(key("d", { meta: true, alt: true }), context()), none);
	// With nothing selected ⌘D is not the drawing's, and a bare d is no tool.
	assert.deepEqual(penKey(key("d", { meta: true }), context({ selection: [] })), none);
	assert.deepEqual(penKey(key("d"), context()), none);
});

test("the arrows nudge items 1 px and boards with them; Shift makes it 10", () => {
	assert.deepEqual(penKey(key("ArrowRight"), context()), { handled: true, do: "nudge", ops: [{ op: "update", id: "a", set: { x: 11, y: 20 } }], boards: [] });
	assert.deepEqual(penKey(key("ArrowUp", { shift: true }), context({ boards: ["boards/one.html"] })), {
		handled: true,
		do: "nudge",
		ops: [{ op: "update", id: "a", set: { x: 10, y: 10 } }],
		boards: [{ path: "boards/one.html", x: 1000, y: -10 }],
	});
	assert.deepEqual(penKey(key("ArrowLeft", { shift: true }), context({ selection: ["a", "b"] })), {
		handled: true,
		do: "nudge",
		ops: [
			{ op: "update", id: "a", set: { x: 0, y: 20 } },
			{ op: "update", id: "b", set: { x: 190, y: 20 } },
		],
		boards: [],
	});
	// Boards alone move; nothing selected, nothing moves; ⌘ or Alt are not a nudge.
	assert.deepEqual(penKey(key("ArrowDown"), context({ selection: [], boards: ["boards/one.html"] })), { handled: true, do: "nudge", ops: [], boards: [{ path: "boards/one.html", x: 1000, y: 1 }] });
	assert.deepEqual(penKey(key("ArrowDown"), context({ selection: [] })), none);
	assert.deepEqual(penKey(key("ArrowDown", { meta: true }), context()), none);
	assert.deepEqual(penKey(key("ArrowDown", { alt: true }), context()), none);
});

test("a letter arms its tool, unless a board is selected or a modifier is held", () => {
	const arms: Record<string, string> = { n: "note", s: "note", c: "card", t: "text", r: "rectangle", o: "ellipse", f: "frame", a: "arrow" };
	for (const [letter, tool] of Object.entries(arms)) assert.deepEqual(penKey(key(letter), context({ selection: [] })), { handled: true, do: "arm", tool });
	assert.deepEqual(penKey(key("r"), context({ boardSelected: true })), none);
	assert.deepEqual(penKey(key("r", { meta: true }), context()), none);
	assert.deepEqual(penKey(key("r", { alt: true }), context()), none);
	// Capitals and other letters are not tools.
	assert.deepEqual(penKey(key("R"), context()), none);
	assert.deepEqual(penKey(key("v"), context()), none);
	assert.deepEqual(penKey(key("x"), context()), none);
});
