import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, emptyDocument, idFor, read, type PenDocument } from "./index.ts";

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
