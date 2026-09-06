import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoardMeta, withBoardSize } from "./meta.ts";

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

/*
 * `withBoardSize` is the write behind `stage.resize` and `stage.fit`. Everything it does
 * wrong is quiet — a lost `bg`, a mangled attribute, a second meta tag — so the cases
 * here are mostly "what else was in the file, and is it still there".
 */
test("resizing a board rewrites the two numbers and nothing else", () => {
	const html = `<!doctype html>\n<html><head><title>A</title>\n<meta name="board" content='{"w":800,"h":600,"bg":"dots"}' />\n</head><body class="board"><p>hi</p></body></html>`;
	const out = withBoardSize(html, { w: 1200, h: 900 });
	assert.deepEqual(readBoardMeta(out), { title: "A", w: 1200, h: 900, bg: "dots" });
	assert.ok(out.includes("<p>hi</p>"));
	assert.equal(out.match(/name="board"/g)?.length, 1);
});

test("a missing dimension keeps the one the board already had", () => {
	const html = `<html><head><meta name="board" content='{"w":800,"h":600}'></head><body></body></html>`;
	assert.deepEqual(readBoardMeta(withBoardSize(html, { h: 1500 })), { w: 800, h: 1500 });
});

test("a board with no meta tag gets one, under its title", () => {
	const html = `<!doctype html>\n<html><head><title>Hand written</title></head><body class="board"></body></html>`;
	const out = withBoardSize(html, { w: 640, h: 480 });
	assert.deepEqual(readBoardMeta(out), { title: "Hand written", w: 640, h: 480, bg: "grid" });
	assert.ok(out.indexOf("name=\"board\"") > out.indexOf("</title>"), "and it goes after the title, not before it");
});

test("an entity-escaped tag survives being resized", () => {
	const html = `<html><head><meta name="board" content="{&quot;w&quot;:800,&quot;h&quot;:600,&quot;theme&quot;:&quot;dark&quot;}"></head><body></body></html>`;
	const out = withBoardSize(html, { w: 900, h: 700 });
	assert.equal(readBoardMeta(out).w, 900);
	assert.ok(out.includes('"theme":"dark"'), "and keeps the key this build does not use itself");
});

test("a size is a positive whole number of pixels", () => {
	const html = `<html><head><meta name="board" content='{"w":800,"h":600}'></head><body></body></html>`;
	assert.deepEqual(readBoardMeta(withBoardSize(html, { w: 640.4, h: -12 })), { w: 640, h: 1 });
});
