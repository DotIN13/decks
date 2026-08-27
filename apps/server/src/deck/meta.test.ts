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
	const meta = readBoardMeta(`<meta content="{&quot;w&quot;:800}" name="board">`);
	// Entity-encoded JSON is not parsed — the size falls back — but nothing throws
	// and the rest of the head is still read.
	assert.equal(meta.w, undefined);
	const plain = readBoardMeta(`<meta content='{"w":800}' name="board">`);
	assert.equal(plain.w, 800);
});
