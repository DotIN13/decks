import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoardMeta, readMeta, withBoardSize } from "./meta.ts";

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
	const out = withBoardSize("boards/a.html", html, { w: 1200, h: 900 });
	assert.deepEqual(readBoardMeta(out), { title: "A", w: 1200, h: 900, bg: "dots" });
	assert.ok(out.includes("<p>hi</p>"));
	assert.equal(out.match(/name="board"/g)?.length, 1);
});

test("a missing dimension keeps the one the board already had", () => {
	const html = `<html><head><meta name="board" content='{"w":800,"h":600}'></head><body></body></html>`;
	assert.deepEqual(readBoardMeta(withBoardSize("boards/a.html", html, { h: 1500 })), { w: 800, h: 1500 });
});

test("a board with no meta tag gets one, under its title", () => {
	const html = `<!doctype html>\n<html><head><title>Hand written</title></head><body class="board"></body></html>`;
	const out = withBoardSize("boards/a.html", html, { w: 640, h: 480 });
	assert.deepEqual(readBoardMeta(out), { title: "Hand written", w: 640, h: 480, bg: "grid" });
	assert.ok(out.indexOf("name=\"board\"") > out.indexOf("</title>"), "and it goes after the title, not before it");
});

test("an entity-escaped tag survives being resized", () => {
	const html = `<html><head><meta name="board" content="{&quot;w&quot;:800,&quot;h&quot;:600,&quot;theme&quot;:&quot;dark&quot;}"></head><body></body></html>`;
	const out = withBoardSize("boards/a.html", html, { w: 900, h: 700 });
	assert.equal(readBoardMeta(out).w, 900);
	assert.ok(out.includes('"theme":"dark"'), "and keeps the key this build does not use itself");
});

test("a size is a positive whole number of pixels", () => {
	const html = `<html><head><meta name="board" content='{"w":800,"h":600}'></head><body></body></html>`;
	assert.deepEqual(readBoardMeta(withBoardSize("boards/a.html", html, { w: 640.4, h: -12 })), { w: 640, h: 1 });
});

/*
 * Where a *deck* says what shape it is, per format.
 *
 * A `.slides.md` has front-matter. Reveal's HTML has nowhere at all — its slide size is an
 * argument to `Reveal.initialize`, a script this view deliberately does not run — so an HTML
 * deck declares it in `<meta name="board">`, the tag every board already carries. Without
 * this, every HTML deck was 16:9 and a 4:3 one could not be written.
 */
test("an HTML deck declares its aspect in the tag every board already has", () => {
	const meta = readMeta(
		"boards/talk.slides.html",
		`<!doctype html><html><head><title>The talk</title>
		<meta name="board" content='{"aspect":"4:3","w":1200}' />
		</head><body class="reveal"><div class="slides"><section>One</section></div></body></html>`,
	);
	assert.equal(meta.aspect, "4:3");
	assert.equal(meta.w, 1200);
	assert.equal(meta.title, "The talk", "from `<title>`, as any document's is");
});

test("a markdown deck still declares it in front-matter, and neither reads the other's", () => {
	const md = readMeta("boards/talk.slides.md", "---\ntitle: Talk\naspect: 4:3\n---\n\n# One\n");
	assert.equal(md.aspect, "4:3");
	assert.equal(md.title, "Talk");

	// A markdown file with a `<meta>` tag in it is a markdown file with a tag in it.
	const stray = readMeta("boards/notes.md", `<meta name="board" content='{"aspect":"4:3"}' />\n\n# Notes\n`);
	assert.equal(stray.aspect, undefined);
	assert.equal(stray.title, "Notes");
});

test("front-matter outranks the tag on an HTML file, because it is the more deliberate one", () => {
	// Not a shape anybody writes on purpose; asserted so the precedence is decided rather
	// than emergent, and so a future reader knows which line to change.
	const meta = readMeta(
		"boards/odd.slides.html",
		`---\naspect: 1:1\n---\n<meta name="board" content='{"aspect":"4:3"}' />\n<section>One</section>\n`,
	);
	assert.equal(meta.aspect, "1:1");
});

test("an HTML document with no tag keeps saying nothing about its size", () => {
	const meta = readMeta("boards/report.html", "<html><head><title>Report</title></head><body><h1>Report</h1></body></html>");
	assert.equal(meta.w, undefined);
	assert.equal(meta.aspect, undefined);
	assert.equal(meta.title, "Report");
});

/*
 * And the write half for markdown, which is front-matter rather than a tag.
 *
 * Until `withBoardSize` knew about it, resizing a `.md` wrote a `<meta>` in above the `---`: the
 * front-matter parser then never matched, and the reader saw the tag as text. These are the cases
 * that were wrong, one per shape of front-matter.
 */
test("a markdown board's width goes to its front-matter, not into a tag", () => {
	const out = withBoardSize("boards/notes.md", `---\ntitle: Notes\n---\n\n# Notes\n\nBody.\n`, { w: 900 });
	assert.equal(readMeta("boards/notes.md", out).w, 900);
	assert.equal(readMeta("boards/notes.md", out).title, "Notes");
	assert.equal(out.split("\n")[0], "---");
	assert.ok(out.includes("\nw: 900\n"), out.slice(0, 40));
	assert.ok(out.includes("# Notes") && out.includes("Body."), "and the document is untouched");
	assert.equal(/<meta/.test(out), false, "no HTML in a markdown file");
});

test("a width already in the front-matter is replaced, not added twice", () => {
	const out = withBoardSize("boards/notes.md", `---\nw: 700\ntitle: T\n---\n\n# T\n`, { w: 880 });
	assert.equal(readMeta("boards/notes.md", out).w, 880);
	assert.equal(out.match(/^w:/gm)?.length, 1);
});

test("a markdown board with no front-matter gets one, and keeps its heading for a title", () => {
	const out = withBoardSize("boards/notes.md", `# A heading\n\nBody.\n`, { w: 760 });
	assert.equal(readMeta("boards/notes.md", out).w, 760);
	assert.equal(readMeta("boards/notes.md", out).title, "A heading");
});

test("a height on its own writes nothing to a markdown board", () => {
	// Its height is its content's, and `stage.fit` asks for one on every call: a number written
	// here would be one nothing reads and every later write has to carry.
	const md = `---\nw: 700\n---\n\n# T\n`;
	assert.equal(withBoardSize("boards/notes.md", md, { h: 1400 }), md);
});
