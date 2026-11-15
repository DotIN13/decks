import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sourceOf, writeLike } from "./spans.ts";

// Writing a drawing back: unchanged items keep their bytes, at any depth.

const FIXTURE = new URL("../../tools/fixtures/deck/canvases/auth-refresh/canvas.pen", import.meta.url);

test("an unchanged drawing is written back byte for byte", () => {
	const text = readFileSync(FIXTURE, "utf8");
	assert.equal(writeLike(sourceOf(text), JSON.parse(text)), text);
});

test("an item you did not touch keeps its bytes after an edit", () => {
	const text = readFileSync(FIXTURE, "utf8");
	const doc = JSON.parse(text);
	doc.children[1].x = 999;
	doc.children.push({ type: "note", id: "new", content: "Hi — there" });
	const out = writeLike(sourceOf(text), doc);
	const source = sourceOf(text);
	for (const id of ["plan", "notes", "sources", "how-deep-is-the-deep-sea"]) {
		const span = source.items.get(id)!;
		assert.ok(out.includes(text.slice(span.start, span.end)), `${id} kept its bytes`);
	}
	assert.deepEqual(JSON.parse(out), doc);
});

test("a change deep in a frame rewrites only the changed item", () => {
	const text = JSON.stringify({ version: "2.14", children: [{ type: "frame", id: "f", children: [{ type: "text", id: "a", content: "é" }, { type: "text", id: "b", content: "x" }] }] }, null, "\t").replace("é", "\\u00e9");
	const doc = JSON.parse(text);
	doc.children[0].children[1].content = "y";
	const out = writeLike(sourceOf(text), doc);
	assert.ok(out.includes('"content": "\\u00e9"'));
	assert.deepEqual(JSON.parse(out), doc);
});
