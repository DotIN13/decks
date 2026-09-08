import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoardMeta } from "../deck/meta.ts";
import { renderShell } from "./shell.ts";

/*
 * The shell has one job and one trap. The job: be a document a board frame can render. The
 * trap: it is generated per request, so anything it gets wrong is wrong for every board of
 * that format at once, with no file anybody can open to see why.
 */

test("the shell is a board the loader can read back", () => {
	const html = renderShell({ path: "boards/notes.md", shell: "content", format: "flow", title: "Notes", w: 720, h: 400 });
	const meta = readBoardMeta(html);
	assert.equal(meta.title, "Notes");
	assert.equal(meta.w, 720);
	assert.equal(meta.h, 400);
	assert.match(html, /<body class="board board-shell" data-format="flow">/);
	assert.match(html, /data-embed="notes\.md\?raw=1"/);
});

/*
 * The nested case, and the reason the lib paths are absolute. `/api/board/boards/a/b.md` is
 * two directories deeper than `/api/board/boards/b.md`, so a relative `../lib/board.css`
 * would resolve to a different place for each — and the deeper one would 404 with no sign
 * beyond an unstyled board.
 */
test("a nested board reaches the same primitives as a top-level one", () => {
	const nested = renderShell({ path: "boards/talks/2026/notes.md", shell: "content", format: "flow", title: "N", w: 720, h: 400 });
	assert.match(nested, /href="\/api\/lib\/board\.css"/);
	assert.match(nested, /src="\/api\/lib\/board\.js"/);
	// And the file is addressed relative to the board's own URL, exactly as an `<img src>`
	// on a component board would be — so it resolves beside the board, not beside the deck.
	assert.match(nested, /data-embed="notes\.md\?raw=1"/);
});

test("a deck asks for the slide view, and carries its aspect", () => {
	const html = renderShell({ path: "boards/talk.slides.md", shell: "content", format: "slides", title: "Talk", w: 960, h: 540, aspect: "4:3" });
	assert.match(html, /data-format="slides"/);
	assert.match(html, /data-slides="talk\.slides\.md\?raw=1"/);
	assert.match(html, /data-aspect="4:3"/);
	// 16:9 is the default, so the common case says nothing rather than repeating it.
	const plain = renderShell({ path: "boards/talk.slides.md", shell: "content", format: "slides", title: "Talk", w: 960, h: 540 });
	assert.doesNotMatch(plain, /data-aspect/);
});

/*
 * A title is content, and content is a place an injection lives. Not a hypothetical: a
 * markdown board's title is its first heading, which somebody's file wrote.
 */
test("a title cannot close the tag it is inside", () => {
	const html = renderShell({
		path: "boards/x.md",
		shell: "content", format: "flow",
		title: '</title><script>fetch("/api/deck")</script>',
		w: 720,
		h: 400,
	});
	assert.doesNotMatch(html, /<script>fetch/);
	assert.match(html, /&lt;script&gt;/);
});

test("a filename with a quote in it cannot escape the attribute", () => {
	const html = renderShell({ path: 'boards/a" onload="alert(1).md', shell: "content", format: "flow", title: "x", w: 720, h: 400 });
	assert.doesNotMatch(html, /onload="alert/);
	assert.match(html, /&quot;/);
});

/*
 * The shell is served at the board's own URL, so a bare reference to the file resolves to
 * the shell — the embed fetches its own wrapper and the board renders empty, with nothing
 * anywhere saying why. `?raw=1` is what stops that, which makes it worth its own test.
 */
test("the file is asked for raw, or the shell would fetch itself", () => {
	const flow = renderShell({ path: "boards/notes.md", shell: "content", format: "flow", title: "n", w: 720, h: 400 });
	assert.match(flow, /data-embed="notes\.md\?raw=1"/);
	const deck = renderShell({ path: "boards/t.slides.md", shell: "content", format: "slides", title: "t", w: 960, h: 540 });
	assert.match(deck, /data-slides="t\.slides\.md\?raw=1"/);
});

test("the one component carries a data-id, so the editor has something to land on", () => {
	assert.match(renderShell({ path: "boards/n.md", shell: "content", format: "flow", title: "n", w: 720, h: 400 }), /data-id="body"/);
	assert.match(renderShell({ path: "boards/t.slides.md", shell: "content", format: "slides", title: "t", w: 960, h: 540 }), /data-id="deck"/);
});

/*
 * The fullscreen overlay loads the same board and needs it to fill the window rather than
 * its own rectangle — a 960-wide deck sat in the corner of a 1500px overlay until this
 * existed. One class, because the CSS is where the two layouts differ.
 */
test("a presented board says so, and an ordinary one does not", () => {
	const shown = renderShell({ path: "boards/t.slides.md", shell: "content", format: "slides", title: "t", w: 960, h: 540, present: true });
	assert.match(shown, /class="board board-shell board-present"/);
	const onCanvas = renderShell({ path: "boards/t.slides.md", shell: "content", format: "slides", title: "t", w: 960, h: 540 });
	assert.doesNotMatch(onCanvas, /board-present/);
});
