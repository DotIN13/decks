import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { apply, baseTheme, DECKS_COLORS, decksColorOf, reroute, layout, emptyDocument, makeShape, resolve, shapeKind, toHtml, withDecksColors, type PenDocument } from "./index.ts";

const rect = (id: string) => ({ op: "insert", node: { type: "rectangle", id, fill: "$decks-shape", width: 100, height: 60 }, box: { x1: 0, y1: 0 } });

test("an insert that uses a Decks colour defines it, and the light/dark axis, once", () => {
	const ops = withDecksColors(emptyDocument(), [rect("r")]);
	assert.equal(ops.length, 2);
	assert.deepEqual(ops[0], {
		op: "variables",
		set: { "decks-shape": { type: "color", value: [{ value: "#dbe4f0" }, { value: DECKS_COLORS["decks-shape"]!.dark, theme: { mode: "dark" } }] } },
		themes: { mode: ["light", "dark"] },
	});
	const doc = apply(emptyDocument(), ops as Parameters<typeof apply>[1], { theme: {} }).doc;
	// Drawn again: nothing more to define.
	assert.deepEqual(withDecksColors(doc, [rect("s")]), [rect("s")]);
	// Light as the tools always made it; dark its dark value.
	assert.equal(resolve(doc, "$decks-shape", baseTheme(doc, "light")), "#dbe4f0");
	assert.equal(resolve(doc, "$decks-shape", baseTheme(doc, "dark")), DECKS_COLORS["decks-shape"]!.dark);
});

test("a library shape's fill and line are defined with it, a drawing's own axis and its own variable kept", () => {
	const doc: PenDocument = { version: "2.6", themes: { Mode: ["Light", "Dark"], Brand: ["a", "b"] }, variables: { "decks-figure": { type: "color", value: "#ff0000" } }, children: [] };
	const shape = makeShape(shapeKind("Decision")!, { frame: "d", outline: "d-o" }, { w: 160, h: 120 });
	const [vars] = withDecksColors(doc, [{ op: "insert", node: shape }]) as Array<{ set: Record<string, unknown>; themes?: unknown }>;
	assert.deepEqual(Object.keys(vars!.set), ["decks-figure-line"], "the drawing's own decks-figure is left as it is");
	assert.equal(vars!.themes, undefined, "the drawing's Mode axis is used, not a new one");
	const done = apply(doc, [vars, { op: "insert", node: shape }] as Parameters<typeof apply>[1], { theme: {} }).doc;
	assert.equal(resolve(done, "$decks-figure-line", baseTheme(done, "dark")), DECKS_COLORS["decks-figure-line"]!.dark);
	assert.equal(resolve(done, "$decks-figure-line", baseTheme(done, "light")), "#1f2328");
});

test("an exported page carries the Decks colours, dark under prefers-color-scheme", () => {
	const doc = apply(emptyDocument(), withDecksColors(emptyDocument(), [rect("r")]) as Parameters<typeof apply>[1], { theme: {} }).doc;
	const html = toHtml(doc, ["r"], { format: "html" });
	assert.match(html, /--decks-shape: #dbe4f0;/);
	assert.match(html, new RegExp(`prefers-color-scheme: dark\\) \\{\\n:root \\{\\n  --decks-shape: ${DECKS_COLORS["decks-shape"]!.dark};`));
	assert.match(html, /var\(--decks-shape\)/);
});

test("an edit that already carries its Decks colours (run twice, by the canvas and then the server) gets nothing more", () => {
	const once = withDecksColors(emptyDocument(), [rect("r")]);
	assert.deepEqual(withDecksColors(emptyDocument(), once), once);
});

test("decksColorOf names a Decks colour and nothing else", () => {
	assert.equal(decksColorOf("$decks-red"), "decks-red");
	assert.equal(decksColorOf("$brand"), undefined);
	assert.equal(decksColorOf("#e5484d"), undefined);
	assert.equal(decksColorOf("$decks-nope"), undefined);
});

test("an arrow given no colour is drawn in the drawing's $decks-line when it has it, its light grey when not", () => {
	const arrow = { type: "path", id: "ab", metadata: { type: "decks.arrow", from: "a", to: "b" } };
	const box = (id: string, x: number) => ({ type: "rectangle", id, x, y: 0, width: 50, height: 50 });
	for (const has of [false, true]) {
		const doc = { version: "2.6", children: [box("a", 0), box("b", 200), structuredClone(arrow)], ...(has ? { variables: { "decks-line": { type: "color", value: "#8a8f98" } } } : {}) } as unknown as PenDocument;
		reroute(doc, layout(doc, doc.children, { theme: {} }));
		assert.equal(doc.children[2]!.stroke, has ? "$decks-line" : "#8a8f98");
	}
});

test("the canvas skills teach every Decks colour, with its light and dark values", () => {
	const skill = readFileSync(new URL("../../../runtime/skills/canvas-authoring/SKILL.md", import.meta.url), "utf8");
	for (const [name, color] of Object.entries(DECKS_COLORS)) {
		const line = skill.split("\n").find((one) => one.includes(`\`$${name}\``));
		assert.ok(line, `canvas-authoring names $${name}`);
		assert.ok(line.includes(color.light) && line.includes(color.dark), `$${name}'s line gives ${color.light} and ${color.dark}`);
	}
	const design = readFileSync(new URL("../../../runtime/skills/canvas-design/SKILL.md", import.meta.url), "utf8");
	assert.match(design, /\$decks-/, "canvas-design points at the Decks colours");
});
