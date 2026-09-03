import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoardMeta } from "./meta.ts";

test("a board's title, size and poster come off the head", () => {
	const meta = readBoardMeta(`<!doctype html><html><head>
		<title>  Auth refresh —
		the plan </title>
		<meta name="board" content='{"w":1600,"h":1000,"bg":"dots"}'>
		<meta name="poster" content="assets/plan.png">
		</head><body class="board"></body></html>`);
	assert.equal(meta.title, "Auth refresh — the plan");
	assert.equal(meta.w, 1600);
	assert.equal(meta.h, 1000);
	assert.equal(meta.bg, "dots");
	assert.equal(meta.poster, "assets/plan.png");
});

test("a board that says nothing says nothing — the loader supplies defaults", () => {
	const meta = readBoardMeta("<html><body></body></html>");
	assert.deepEqual(meta, {});
});

test("broken board meta is ignored rather than fatal", () => {
	const meta = readBoardMeta(`<meta name="board" content='{"w":1600,'><title>x</title>`);
	assert.equal(meta.title, "x");
	assert.equal(meta.w, undefined);
});

test("attribute order and quoting do not matter", () => {
	/*
	 * This test used to assert the opposite — that entity-encoded JSON fell back to the
	 * default size — which documented a limitation as though it were a requirement. It is
	 * not: `content="{&quot;w&quot;:800}"` is the *only* legal way a double-quoted
	 * attribute can carry that JSON, so a board written by hand, or by an editor that
	 * normalises quotes, silently lost its size while the file looked correct.
	 */
	const encoded = readBoardMeta(`<meta content="{&quot;w&quot;:800}" name="board">`);
	assert.equal(encoded.w, 800);
	const plain = readBoardMeta(`<meta content='{"w":800}' name="board">`);
	assert.equal(plain.w, 800);
});

test("a numeric character reference is decoded too", () => {
	assert.equal(readBoardMeta(`<meta name="board" content="{&#34;w&#34;:120}">`).w, 120);
});

test("a board that is still broken falls back rather than throwing", () => {
	// The point of unescaping is not to accept anything: half a tag is still half a tag.
	assert.equal(readBoardMeta(`<meta name="board" content="{&quot;w&quot;:}">`).w, undefined);
	assert.equal(readBoardMeta(`<meta name="board" content="not json at all">`).w, undefined);
});
