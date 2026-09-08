import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultWidth, formatOf, isBoardFile, isComponentBoard, slideHeight } from "./kinds.ts";

/*
 * The rule that made this cheap: an HTML board says what it is by the class on its body,
 * and every board that already exists says it. So these tests are mostly about *not*
 * breaking that — a file that would have rendered as a component board yesterday has to
 * still be one today.
 */

const board = '<!doctype html><html><head><title>x</title></head><body class="board"><section data-id="a"></section></body></html>';
const document_ = "<!doctype html><html><head><title>x</title></head><body><h1>A report</h1><p>Words.</p></body></html>";

test("a Decks board is component, and a plain document is flow", () => {
	assert.equal(formatOf("boards/plan.html", board), "component");
	assert.equal(formatOf("boards/report.html", document_), "flow");
});

test("the class is matched as a word, in any position, however quoted", () => {
	assert.equal(isComponentBoard('<body class="board">'), true);
	assert.equal(isComponentBoard("<body class='board dark'>"), true);
	assert.equal(isComponentBoard('<body id="x" class="dark board" data-y="1">'), true);
	assert.equal(isComponentBoard("<body class=board>"), true, "unquoted, which is legal HTML");
	assert.equal(isComponentBoard('<BODY CLASS="BOARD">'), false, "class names are case-sensitive, unlike the tag");
});

/*
 * The near-misses. `boardish` would have matched a substring test, and a `class="board"` in
 * the *content* of a document is not a statement about the document.
 */
test("something that merely contains the word is not a board", () => {
	assert.equal(isComponentBoard('<body class="boardish">'), false);
	assert.equal(isComponentBoard('<body class="dashboard">'), false);
	assert.equal(isComponentBoard('<body><div class="board"></div></body>'), false, "a div is not the body");
	assert.equal(isComponentBoard("<p>no body at all</p>"), false);
});

test("markdown is flow, and the double extension is a deck", () => {
	assert.equal(formatOf("boards/notes.md"), "flow");
	assert.equal(formatOf("boards/talk.slides.md"), "slides", "checked before the plain markdown rule");
	assert.equal(formatOf("boards/slides.md"), "flow", "…and `slides.md` on its own is just a file called slides");
});

/*
 * `.slides.html` is reveal's native format — `<section>` elements — and the name has to
 * outrank the body's class, because a deck this app writes carries `class="reveal"` and one
 * served through the shell is wrapped in a document that says `class="board"`. Reading the
 * body first would make a deck a component board and hand it to the wrong editor.
 */
test("an HTML deck is a deck, whatever its body says", () => {
	assert.equal(formatOf("boards/talk.slides.html"), "slides", "with no source at all");
	assert.equal(formatOf("boards/talk.slides.html", '<body class="reveal"><div class="slides"><section>One</section></div></body>'), "slides");
	assert.equal(
		formatOf("boards/talk.slides.html", '<body class="board"><div class="slides"><section>One</section></div></body>'),
		"slides",
		"the name is the declaration; the class cannot overrule it",
	);
	assert.equal(formatOf("boards/talk.slides.htm"), "slides", "and `.htm`, like every other HTML rule here");
	assert.equal(formatOf("boards/slides.html", "<body><p>hi</p></body>"), "flow", "`slides.html` on its own is a file called slides");
});

/*
 * An HTML path with no source is `component`, and the asymmetry is deliberate: guessing
 * flow for a real board makes one unreadable frame out of a correct file, where guessing
 * component for a document at worst renders it unstyled.
 */
test("an HTML path with no source read yet is assumed to be a board", () => {
	assert.equal(formatOf("boards/plan.html"), "component");
	assert.equal(formatOf("boards/notes.md"), "flow", "markdown needs no source to be sure");
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
	assert.equal(defaultWidth("flow"), 720, "a readable measure for prose");
	assert.equal(defaultWidth("component"), 720);
	assert.equal(defaultWidth("slides"), 960, "so a deck opens at 1:1 with its own layout");

	assert.equal(slideHeight(960), 540, "16:9");
	assert.equal(slideHeight(960, "4:3"), 720);
	assert.equal(slideHeight(1280, "16:9"), 720);
	// A deck that says something absurd gets 16:9 rather than a division by zero.
	assert.equal(slideHeight(960, "0:0"), 540);
	assert.equal(slideHeight(960, "wide"), 540);
});
