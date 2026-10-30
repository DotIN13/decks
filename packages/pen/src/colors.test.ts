import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { apply, baseTheme, DECKS_COLORS, DECKS_LEGACY, decksColorOf, expandVariables, reroute, shortVariables, layout, emptyDocument, makeShape, resolve, shapeKind, toHtml, withDecksColors, type PenDocument } from "./index.ts";

const rect = (id: string) => ({ op: "insert", node: { type: "rectangle", id, fill: "$decks-fill-slate", width: 100, height: 60 }, box: { x1: 0, y1: 0 } });

test("an insert that uses a Decks colour defines it, and the light/dark axis, once", () => {
	const ops = withDecksColors(emptyDocument(), [rect("r")]);
	assert.equal(ops.length, 2);
	assert.deepEqual(ops[0], {
		op: "variables",
		set: { "decks-fill-slate": { type: "color", value: [{ value: "#dbe4f0" }, { value: DECKS_COLORS["decks-fill-slate"]!.dark, theme: { mode: "dark" } }] } },
		themes: { mode: ["light", "dark"] },
	});
	const doc = apply(emptyDocument(), ops as Parameters<typeof apply>[1], { theme: {} }).doc;
	// Drawn again: nothing more to define.
	assert.deepEqual(withDecksColors(doc, [rect("s")]), [rect("s")]);
	// Light as the tools always made it; dark its dark value.
	assert.equal(resolve(doc, "$decks-fill-slate", baseTheme(doc, "light")), "#dbe4f0");
	assert.equal(resolve(doc, "$decks-fill-slate", baseTheme(doc, "dark")), DECKS_COLORS["decks-fill-slate"]!.dark);
});

test("a library shape's fill and line are defined with it, a drawing's own axis and its own variable kept", () => {
	const doc: PenDocument = { version: "2.6", themes: { Mode: ["Light", "Dark"], Brand: ["a", "b"] }, variables: { "decks-surface": { type: "color", value: "#ff0000" } }, children: [] };
	const shape = makeShape(shapeKind("Decision")!, { frame: "d", outline: "d-o" }, { w: 160, h: 120 });
	const [vars] = withDecksColors(doc, [{ op: "insert", node: shape }]) as Array<{ set: Record<string, unknown>; themes?: unknown }>;
	assert.deepEqual(Object.keys(vars!.set), ["decks-line-strong"], "the drawing's own decks-surface is left as it is");
	assert.equal(vars!.themes, undefined, "the drawing's Mode axis is used, not a new one");
	const done = apply(doc, [vars, { op: "insert", node: shape }] as Parameters<typeof apply>[1], { theme: {} }).doc;
	assert.equal(resolve(done, "$decks-line-strong", baseTheme(done, "dark")), DECKS_COLORS["decks-line-strong"]!.dark);
	assert.equal(resolve(done, "$decks-line-strong", baseTheme(done, "light")), "#1f2328");
});

test("an exported page carries the Decks colours, dark under prefers-color-scheme", () => {
	const doc = apply(emptyDocument(), withDecksColors(emptyDocument(), [rect("r")]) as Parameters<typeof apply>[1], { theme: {} }).doc;
	const html = toHtml(doc, ["r"], { format: "html" });
	assert.match(html, /--decks-fill-slate: #dbe4f0;/);
	assert.match(html, new RegExp(`prefers-color-scheme: dark\\) \\{\\n:root \\{\\n  --decks-fill-slate: ${DECKS_COLORS["decks-fill-slate"]!.dark};`));
	assert.match(html, /var\(--decks-fill-slate\)/);
});

test("an edit that already carries its Decks colours (run twice, by the canvas and then the server) gets nothing more", () => {
	const once = withDecksColors(emptyDocument(), [rect("r")]);
	assert.deepEqual(withDecksColors(emptyDocument(), once), once);
});

test("decksColorOf names a Decks colour and nothing else", () => {
	assert.equal(decksColorOf("$decks-accent-red"), "decks-accent-red");
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

test("the canvas skills point at the Decks colours, and their reference gives every one with its light and dark values", () => {
	const guide = readFileSync(new URL("../../../runtime/skills/canvas-authoring/SKILL.md", import.meta.url), "utf8");
	assert.match(guide, /\[colors\.md\]\(colors\.md\)/, "canvas-authoring links its colour reference");
	const skill = readFileSync(new URL("../../../runtime/skills/canvas-authoring/colors.md", import.meta.url), "utf8");
	for (const [name, color] of Object.entries(DECKS_COLORS)) {
		const line = skill.split("\n").find((one) => one.includes(`\`$${name}\``));
		assert.ok(line, `colors.md names $${name}`);
		assert.ok(line.includes(color.light) && line.includes(color.dark), `$${name}'s line gives ${color.light} and ${color.dark}`);
	}
	const design = readFileSync(new URL("../../../runtime/skills/canvas-design/SKILL.md", import.meta.url), "utf8");
	assert.match(design, /\$decks-/, "canvas-design points at the Decks colours");
});

test("an old Decks colour name resolves, reads as its new one, and an edit using it defines it with the new one's values", () => {
	assert.equal(decksColorOf("$decks-ink"), "decks-text");
	assert.equal(decksColorOf("$decks-card-line"), "decks-line-subtle");
	assert.equal(decksColorOf("$decks-red-fill"), "decks-fill-red");
	assert.equal(decksColorOf("$decks-red"), "decks-accent-red");
	for (const [old, now] of Object.entries(DECKS_LEGACY)) assert.ok(DECKS_COLORS[now], `${old} maps to ${now}, which is in the palette`);
	const insert = { op: "insert", node: { type: "rectangle", id: "r", fill: "$decks-shape", stroke: "$decks-ink" } };
	const ops = withDecksColors(emptyDocument(), [insert]);
	const vars = ops[0] as { set: Record<string, unknown> };
	assert.deepEqual(Object.keys(vars.set).sort(), ["decks-ink", "decks-shape"], "the names the edit uses, as written");
	const doc = apply(emptyDocument(), ops as Parameters<typeof apply>[1], { theme: {} }).doc;
	assert.equal(resolve(doc, "$decks-ink", baseTheme(doc, "dark")), DECKS_COLORS["decks-text"]!.dark);
	assert.equal(resolve(doc, "$decks-shape", baseTheme(doc, "light")), DECKS_COLORS["decks-fill-slate"]!.light);
});

test("variables given short are expanded to pen's form on the drawing's own light/dark axis, and read back short", () => {
	const none = expandVariables({ brand: { light: "#4f46e5", dark: "#818cf8" }, mark: "#ff0000", space: 16, font: "Inter", gone: null }, undefined);
	assert.deepEqual(none.set, {
		brand: { type: "color", value: [{ value: "#4f46e5" }, { value: "#818cf8", theme: { mode: "dark" } }] },
		mark: { type: "color", value: "#ff0000" },
		space: { type: "number", value: 16 },
		font: { type: "string", value: "Inter" },
		gone: null,
	});
	assert.deepEqual(none.themes, { mode: ["light", "dark"] });
	const older = expandVariables({ brand: { light: "#4f46e5", dark: "#818cf8" } }, { Mode: ["Light", "Dark"] });
	assert.deepEqual(older.set.brand, { type: "color", value: [{ value: "#4f46e5" }, { value: "#818cf8", theme: { Mode: "Dark" } }] });
	assert.equal(older.themes, undefined, "the drawing's own axis, nothing added");
	const full = { type: "color", value: [{ value: "#111111" }, { value: "#eeeeee", theme: { mode: "dark" } }] };
	assert.deepEqual(expandVariables({ ink: full }, undefined), { set: { ink: full } }, "pen's own form is kept as it is");
	const doc: PenDocument = { version: "2.6", themes: { Mode: ["Light", "Dark"] }, variables: older.set as PenDocument["variables"], children: [] };
	assert.deepEqual(shortVariables(doc), { brand: { light: "#4f46e5", dark: "#818cf8" } });
});
