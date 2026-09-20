import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultWidth, formatOf, isBoardFile, isOurs, shellFor, slideHeight } from "./kinds.ts";

/*
 * There used to be two board formats here, told apart by a word on the body's class. They are
 * one, so most of what is left is the *name*: a deck says what it is in its filename, and
 * everything else is a board. What the source still decides is how a file has to be delivered
 * — as it stands, or wrapped in a document of our making.
 */

const board = '<!doctype html><html><head><title>x</title></head><body class="board"><section data-id="a"></section></body></html>';
const document_ = "<!doctype html><html><head><title>x</title></head><body><h1>A report</h1><p>Words.</p></body></html>";

test("a board and a plain document are the same format", () => {
	assert.equal(formatOf("boards/plan.html"), "board");
	assert.equal(formatOf("boards/report.html"), "board");
	assert.equal(formatOf("boards/notes.md"), "board", "markdown is read, and it is a board too");
});

test("the double extension is the one declaration left", () => {
	assert.equal(formatOf("boards/talk.slides.md"), "slides", "checked before the plain markdown rule");
	assert.equal(formatOf("boards/talk.slides.html"), "slides");
	assert.equal(formatOf("boards/talk.slides.htm"), "slides", "and `.htm`, like every other HTML rule here");
	assert.equal(formatOf("boards/slides.md"), "board", "…and `slides.md` on its own is just a file called slides");
	assert.equal(formatOf("boards/slides.html"), "board", "likewise");
});

/*
 * Whether a file is one of *ours* is still a question about the body's class, because it is
 * what decides whether a document gets wrapped and sandboxed. `flow` counts: it is the word
 * the second format used to be declared with, and every document board written before the two
 * became one carries it.
 */
test("the class is matched as a word, in any position, however quoted", () => {
	assert.equal(isOurs('<body class="board">'), true);
	assert.equal(isOurs("<body class='board dark'>"), true);
	assert.equal(isOurs('<body id="x" class="dark board" data-y="1">'), true);
	assert.equal(isOurs("<body class=board>"), true, "unquoted, which is legal HTML");
	assert.equal(isOurs('<body class="board flow">'), true, "what a document board used to say");
	assert.equal(isOurs('<BODY CLASS="BOARD">'), false, "class names are case-sensitive, unlike the tag");
});

/*
 * The near-misses. `boardish` would have matched a substring test, and a `class="board"` in
 * the *content* of a document is not a statement about the document.
 */
test("something that merely contains the word is not a board", () => {
	assert.equal(isOurs('<body class="boardish">'), false);
	assert.equal(isOurs('<body class="dashboard">'), false);
	assert.equal(isOurs('<body><div class="board"></div></body>'), false, "a div is not the body");
	assert.equal(isOurs("<p>no body at all</p>"), false);
});

/*
 * Which boards are documents already, and which are content that has to be wrapped.
 *
 * This is the whole reason `shellFor` exists apart from `formatOf`: three files that are all
 * boards, and one of them — a page from somewhere else — has to end up sandboxed, while the
 * ones this app wrote must not be wrapped at all.
 */
test("only raw content needs a shell", () => {
	assert.equal(shellFor("boards/notes.html", '<body class="board flow"></body>'), undefined, "ours: already a document");
	assert.equal(shellFor("boards/plan.html", board), undefined, "a board of placed boxes, likewise");
	// A deck is content in either dialect: the shell is what gives it the slide view.
	assert.equal(shellFor("boards/talk.slides.html", '<body class="reveal"></body>'), "content", "a deck is rendered into a document");
	assert.equal(shellFor("boards/notes.md"), "content", "rendered into a document rather than being one");
	assert.equal(shellFor("boards/talk.slides.md"), "content");
	assert.equal(shellFor("boards/report.html", document_), "foreign", "a saved page: wrapped, and sandboxed, because it may carry scripts");
	// With no source read yet, an HTML file is assumed to be one of ours: guessing foreign for
	// a real board would sandbox a correct file and take its scripts away.
	assert.equal(shellFor("boards/plan.html"), undefined);
});

test("the glob, as a predicate", () => {
	for (const yes of ["boards/a.html", "boards/a.htm", "boards/a.md", "boards/a.slides.md", "boards/a.slides.html", "boards/nested/b.md"]) {
		assert.equal(isBoardFile(yes), true, yes);
	}
	for (const no of ["boards/a.txt", "boards/a.drawio.svg", "assets/a.png", "deck.json", "boards/a.md.bak"]) {
		assert.equal(isBoardFile(no), false, no);
	}
});

test("the defaults, and a slide's aspect", () => {
	assert.equal(defaultWidth("board"), 1000, "about as wide as a board is read at");
	assert.equal(defaultWidth("slides"), 960, "so a deck opens at 1:1 with its own layout");

	assert.equal(slideHeight(960), 540, "16:9");
	assert.equal(slideHeight(960, "4:3"), 720);
	assert.equal(slideHeight(1280, "16:9"), 720);
	// A deck that says something absurd gets 16:9 rather than a division by zero.
	assert.equal(slideHeight(960, "0:0"), 540);
	assert.equal(slideHeight(960, "wide"), 540);
});
