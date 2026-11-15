import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, emptyDocument, idFor, outlineOf, read, themeFrom, type PenDocument } from "./index.ts";

/**
 * The calls borrowed from pen.dev's drawing API, as the pen package answers them: ids from names,
 * warnings, reading part of a document, values worked out, clipping.
 */

const light = { theme: {} };

test("an item with a name and no id is given its name as an id, made unique; its children too", () => {
	const doc: PenDocument = { ...emptyDocument(), children: [{ type: "rectangle", id: "pricing-card" }] };
	const step = apply(doc, [
		{ op: "insert", node: { type: "frame", name: "Pricing card", children: [{ type: "text", name: "Title!", content: "Pro" }, { type: "text", content: "no name" }] as never } },
		{ op: "insert", node: { type: "frame", name: "Pricing card" } },
	], light);
	const [, first, second] = step.doc.children;
	assert.equal(first!.id, "pricing-card-2");
	assert.equal(first!.children![0]!.id, "title");
	assert.match(first!.children![1]!.id, /^[A-Za-z0-9]{5}$/);
	assert.equal(second!.id, "pricing-card-3");
	assert.deepEqual(step.results.map((r) => r.id), ["pricing-card-2", "pricing-card-3"]);
});

test("a copy's items take ids from their names too, and an `as` still names the copy", () => {
	const doc: PenDocument = { ...emptyDocument(), children: [{ type: "frame", id: "card", name: "Card", children: [{ type: "text", id: "label", name: "Label", content: "x" }] }] };
	const step = apply(doc, [{ op: "copy", id: "card" }, { op: "copy", id: "card", as: "third" }], light);
	assert.deepEqual(step.doc.children.map((n) => [n.id, n.children![0]!.id]), [["card", "label"], ["third", "label-3"], ["card-2", "label-2"]]);
});

test("ids from names keep letters of any script, join words with -, and stop near 40 characters at a word", () => {
	const none = new Set<string>();
	assert.equal(idFor("  Hello, World  ", none), "hello-world");
	assert.equal(idFor("水墨 花卉", none), "水墨-花卉");
	assert.equal(idFor("one two three four five six seven eight nine ten", none), "one-two-three-four-five-six-seven-eight");
	assert.match(idFor("!!!", none), /^[A-Za-z0-9]{5}$/);
	assert.match(idFor(undefined, none), /^[A-Za-z0-9]{5}$/);
	assert.equal(idFor("a/b", none), "a-b");
});

const nested = (): PenDocument => ({
	...emptyDocument(),
	children: [
		{ type: "frame", id: "card", reusable: true, layout: "none", width: 100, height: 60, children: [{ type: "text", id: "label", content: "Card", x: 10, y: 10 }] },
		{ type: "ref", id: "c1", ref: "card", x: 200, y: 0, descendants: { label: { content: "First" } } },
		{ type: "frame", id: "page", layout: "none", width: 400, height: 300, x: 0, y: 400, children: [{ type: "frame", id: "row", layout: "none", width: 100, height: 40, children: [{ type: "rectangle", id: "dot", width: 4, height: 4 }] }] },
	],
});

test("read of one item gives it with its subtree, an id inside an instance too", () => {
	const page = read(nested(), { ...light, of: "page" }).children;
	assert.deepEqual(page.map((n) => n.id), ["page"]);
	assert.equal(page[0]!.children![0]!.children![0]!.id, "dot");
	const inner = read(nested(), { ...light, of: "c1/label" }).children[0]!;
	assert.equal(inner.id, "c1/label");
	assert.equal(inner.content, "First");
	assert.deepEqual(inner.box, { x1: 210, y1: 10, x2: inner.box.x2, y2: inner.box.y2 });
	assert.ok(!("instanceOf" in inner));
	assert.throws(() => read(nested(), { ...light, of: "nope" }), /no item "nope"/);
});

test("depth keeps that many levels of children and counts the rest", () => {
	const top = read(nested(), { ...light, depth: 0 }).children;
	assert.deepEqual(top.map((n) => [n.id, n.children, n.childCount]), [["card", undefined, 1], ["c1", undefined, undefined], ["page", undefined, 1]]);
	const one = read(nested(), { ...light, of: "page", depth: 1 }).children[0]!;
	assert.equal(one.children![0]!.id, "row");
	assert.equal(one.children![0]!.childCount, 1);
	assert.equal(one.children![0]!.children, undefined);
	assert.throws(() => read(nested(), { ...light, depth: -1 }), /depth is a whole number/);
});

const themed = (): PenDocument => ({
	...emptyDocument(),
	themes: { Mode: ["Light", "Dark"] },
	variables: { ink: { type: "color", value: [{ value: "#111111" }, { value: "#eeeeee", theme: { Mode: "Dark" } }] }, pad: { type: "number", value: 12 } },
	children: [
		{ type: "frame", id: "card", reusable: true, layout: "vertical", padding: "$pad", fill: "$ink", children: [{ type: "text", id: "label", content: "Card", fill: "$ink" }] },
		{ type: "ref", id: "c1", ref: "card", x: 300, descendants: { label: { content: "First" } } },
		{ type: "rectangle", id: "r", width: 40, height: 20, cornerRadius: 5, fill: [{ type: "color", color: "$ink" }, "$nope"] },
	],
});

test("resolve variables puts each $name's value in, in the light theme or the one asked for", () => {
	assert.deepEqual(themeFrom(themed(), { mode: "dark" }), { Mode: "Dark" });
	const light = read(themed(), { theme: themeFrom(themed(), undefined), resolve: { variables: true } }).children;
	assert.equal(light[0]!.fill, "#111111");
	assert.equal(light[0]!.padding, 12);
	assert.equal(light[0]!.children![0]!.fill, "#111111");
	assert.deepEqual(light[2]!.fill, [{ type: "color", color: "#111111" }, "$nope"]);
	const dark = read(themed(), { theme: themeFrom(themed(), { mode: "dark" }), resolve: { variables: true } }).children;
	assert.equal(dark[0]!.fill, "#eeeeee");
	const asWritten = read(themed(), { theme: {} }).children;
	assert.equal(asWritten[0]!.fill, "$ink");
});

test("resolve instances reads a ref as its copy, overrides applied, its items as ref/child", () => {
	const [, c1] = read(themed(), { theme: {}, resolve: { instances: true } }).children;
	assert.equal(c1!.type, "frame");
	assert.equal(c1!.ref, "card");
	assert.equal(c1!.reusable, undefined);
	assert.deepEqual(c1!.children!.map((n) => [n.id, n.content]), [["c1/label", "First"]]);
	assert.ok(c1!.children![0]!.box);
	assert.equal(c1!.inside, undefined);
	const plain = read(themed(), { theme: {} }).children[1]!;
	assert.equal(plain.type, "ref");
	assert.equal(plain.inside![0]!.id, "c1/label");
});

test("resolve geometry gives a path's or shape's outline in its own space", () => {
	const r = read(themed(), { theme: {}, resolve: { geometry: true } }).children[2]!;
	assert.equal(r.outline, "M5 0 L35 0 A5 5 0 0 1 40 5 L40 15 A5 5 0 0 1 35 20 L5 20 A5 5 0 0 1 0 15 L0 5 A5 5 0 0 1 5 0 Z");
	const doc = emptyDocument();
	assert.equal(outlineOf(doc, { type: "path", id: "p", geometry: "M10 10 l10 0 v10 z" }, 100, 50, {}), "M0 0 L100 0 L100 50 Z");
	assert.equal(outlineOf(doc, { type: "path", id: "p", geometry: "M0 0 H4", viewBox: [0, 0, 4, 4] }, 8, 8, {}), "M0 0 L8 0");
	assert.equal(outlineOf(doc, { type: "polygon", id: "g", polygonCount: 4 }, 10, 10, {}), "M5 0 L10 5 L5 10 L0 5 Z");
	assert.match(outlineOf(doc, { type: "ellipse", id: "e" }, 10, 10, {})!, /^M10 5 A5 5 0 0 1 0 5 A5 5 0 0 1 10 5 Z$/);
	assert.equal(outlineOf(doc, { type: "text", id: "t" }, 10, 10, {}), undefined);
	assert.equal(read(themed(), { theme: {} }).children[2]!.outline, undefined);
});

test("an item cut by a clipping frame round it is clipped partly or fully, and a text overflowing its fixed box partly", () => {
	const doc: PenDocument = {
		...emptyDocument(),
		children: [
			{
				type: "frame", id: "view", layout: "none", clip: true, width: 100, height: 100,
				children: [
					{ type: "rectangle", id: "in", x: 10, y: 10, width: 20, height: 20 },
					{ type: "rectangle", id: "edge", x: 90, y: 10, width: 20, height: 20 },
					{ type: "rectangle", id: "out", x: 150, y: 10, width: 20, height: 20 },
					{ type: "frame", id: "inner", layout: "none", x: 80, y: 0, width: 100, height: 50, children: [{ type: "rectangle", id: "deep", x: 30, y: 0, width: 10, height: 10 }] },
					{ type: "text", id: "long", x: 0, y: 60, width: 40, height: 10, textGrowth: "fixed-width-height", content: "far too many words for this box" },
					{ type: "text", id: "fits", x: 0, y: 80, width: 90, height: 20, textGrowth: "fixed-width-height", content: "ok" },
				],
			},
			{ type: "frame", id: "open", layout: "none", width: 10, height: 10, x: 300, children: [{ type: "rectangle", id: "spill", x: 50, y: 0, width: 10, height: 10 }] },
		],
	};
	const flags = Object.fromEntries(read(doc, { theme: {} }).children.flatMap((n) => [n, ...(n.children ?? []), ...(n.children ?? []).flatMap((c) => c.children ?? [])]).map((n) => [n.id, n.clipped]));
	assert.deepEqual(flags, { view: undefined, in: undefined, edge: "partly", out: "fully", inner: "partly", deep: "fully", long: "partly", fits: undefined, open: undefined, spill: undefined });
});
