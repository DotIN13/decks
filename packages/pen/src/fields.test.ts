import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FIELDS, updateWarnings, warnings } from "./fields.ts";

/** The fields `PenNode` declares in types.ts, read from its source. */
function penNodeFields(): Set<string> {
	const source = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
	const body = source.slice(source.indexOf("export interface PenNode {"));
	const block = body.slice(0, body.indexOf("\n}\n"));
	return new Set([...block.matchAll(/^\t(\w+)\??:/gm)].map((m) => m[1]!));
}

test("the table of fields per type and PenNode in types.ts name the same fields", () => {
	const declared = penNodeFields();
	const tabled = new Set(Object.values(FIELDS).flatMap((set) => [...set]));
	assert.deepEqual([...tabled].filter((field) => !declared.has(field)), [], "in the table, not in PenNode");
	assert.deepEqual([...declared].filter((field) => !tabled.has(field)), [], "in PenNode, not in the table");
});

test("a field a type does not have is one warning, children too, and a ref is never checked", () => {
	assert.deepEqual(warnings({ type: "text", content: "hi", padding: 8 }), ['"padding" does nothing on a text.']);
	assert.deepEqual(warnings({ type: "frame", children: [{ type: "note", id: "n1", content: "x", fill: "#fff" } as never] }), ['"fill" does nothing on a note (n1).']);
	assert.deepEqual(warnings({ type: "ref", ref: "card", anything: 1 }), []);
	assert.deepEqual(warnings({ type: "frame", layout: "vertical", gap: 8, padding: [8, 12], fill: "#fff", cornerRadius: 4, clip: true, children: [] }), []);
	assert.match(warnings({ type: "widget" })[0]!, /"widget" is not an item type pen\.dev has/);
});

test("fills, effects and items Decks keeps but does not draw are said", () => {
	assert.deepEqual(warnings({ type: "rectangle", fill: [{ type: "mesh_gradient", colors: [] }, "#fff"], effect: [{ type: "blur", radius: 4 }, { type: "shadow", shadowType: "inner" }, { type: "shadow" }] }), [
		"A mesh_gradient fill on a rectangle is kept for pen.dev, but Decks does not draw it.",
	]);
	assert.deepEqual(warnings({ type: "rectangle", effect: [{ type: "background_blur", radius: 4 }] }), ["A background_blur effect on a rectangle is kept for pen.dev, but Decks does not draw it."]);
	// An inner shadow is drawn in a box and a whole ellipse, not in a path or an arc.
	const inner = { type: "shadow", shadowType: "inner", blur: 4 };
	assert.deepEqual(warnings({ type: "ellipse", effect: inner } as never), []);
	assert.deepEqual(warnings({ type: "ellipse", sweepAngle: 90, effect: inner } as never), ["An inner shadow on an ellipse is kept for pen.dev, but Decks does not draw it."]);
	assert.deepEqual(updateWarnings("path", { effect: inner }), ["An inner shadow on a path is kept for pen.dev, but Decks does not draw it."]);
	assert.deepEqual(updateWarnings("frame", { effect: [inner] }), []);
	assert.match(warnings({ type: "script", scriptUri: "./a.js" })[0]!, /Decks does not run scripts/);
	assert.deepEqual(updateWarnings("text", { padding: 4, fill: { type: "shader", url: "./a.glsl" }, fontSize: null }), ['"padding" does nothing on a text.', "A shader fill on a text is kept for pen.dev, but Decks does not draw it."]);
});
