import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error -- the vendored runtime is plain JS, deliberately untyped: it is shipped
// into every deck as-is and a `.d.ts` beside it would be a second thing to keep true.
import { isHtmlDeck, logicalSize, sheetColumns, splitDeck, splitNote } from "../../../../runtime/lib/slides.js";

/**
 * The deck parser, tested here because `runtime/lib` ships as plain JS with no build step.
 *
 * These are the functions with real edge cases in them — the fence that is also a
 * separator, the trailing `---` that is a habit rather than a slide — and they are the ones
 * a broken deck would be blamed on.
 *
 * `splitHtmlDeck` is **not** here, and that is a limit rather than an oversight: it uses
 * `DOMParser`, which Node has none of, and a stub would be testing the stub. The HTML
 * format's splitting is asserted in `e2e/checks/board-kinds.mjs`, in a real browser, against
 * the rendered slides — which is where the rest of the DOM half already lives.
 */

test("front-matter is consumed, not shown as the first slide", () => {
	const { meta, slides } = splitDeck("---\ntitle: Talk\naspect: 4:3\n---\n\n# One\n\n---\n\n# Two\n");
	assert.deepEqual(meta, { title: "Talk", aspect: "4:3" });
	assert.deepEqual(slides, ["# One", "# Two"]);
});

/*
 * The trap this format has: `---` is both YAML's fence and reveal's separator. Consume the
 * fence first or a deck opens on a slide made of its own metadata — and a deck with no
 * front-matter must not lose its first slide to the same rule.
 */
test("a deck with no front-matter keeps its first slide", () => {
	const { meta, slides } = splitDeck("# One\n\n---\n\n# Two\n\n---\n\n# Three\n");
	assert.deepEqual(meta, {});
	assert.deepEqual(slides, ["# One", "# Two", "# Three"]);
});

test("a stray separator is a habit, not an empty slide", () => {
	assert.deepEqual(splitDeck("# One\n\n---\n").slides, ["# One"]);
	assert.deepEqual(splitDeck("---\n\n# One\n").slides, ["# One"], "a leading one too");
	assert.deepEqual(splitDeck("# One\n\n---\n\n---\n\n# Two\n").slides, ["# One", "# Two"], "and a doubled one");
});

test("an empty file is one empty slide, not zero slides", () => {
	// Zero would mean `slides[0]` is undefined and the view has nothing to draw or count.
	assert.deepEqual(splitDeck("").slides, [""]);
	assert.deepEqual(splitDeck("---\ntitle: T\n---\n").slides, [""]);
});

/*
 * `--` is reveal's vertical separator and is deliberately not one here: ← → is one
 * dimension. A deck using it gets consecutive slides rather than a branch, which is the
 * behaviour the design chose — asserted so that choice is visible rather than accidental.
 */
test("reveal's vertical separator is not a separator", () => {
	assert.deepEqual(splitDeck("# One\n\n--\n\n# Two\n").slides, ["# One\n\n--\n\n# Two"]);
});

test("CRLF is a line ending", () => {
	const { meta, slides } = splitDeck("---\r\ntitle: T\r\n---\r\n\r\n# One\r\n\r\n---\r\n\r\n# Two\r\n");
	assert.equal(meta.title, "T");
	assert.deepEqual(slides, ["# One", "# Two"]);
});

/*
 * Which splitter a deck gets, and it comes from the filename because that is the only place
 * a format is ever declared. The query string is expected: the shell asks for
 * `talk.slides.html?raw=1`, since it is served at the board's own URL.
 */
test("the format is read off the file name, query and all", () => {
	assert.equal(isHtmlDeck("talk.slides.html"), true);
	assert.equal(isHtmlDeck("talk.slides.html?raw=1"), true);
	assert.equal(isHtmlDeck("talk.slides.htm?raw=1&present=1"), true);
	assert.equal(isHtmlDeck("talk.slides.md?raw=1"), false);
	assert.equal(isHtmlDeck("notes.md"), false);
	// A file merely called slides is not a deck at all, and never reaches this.
	assert.equal(isHtmlDeck("slides.html"), false);
	assert.equal(isHtmlDeck(undefined), false);
});

test("speaker notes are separated and kept", () => {
	assert.deepEqual(splitNote("# Two\n\nNote: say the thing"), { body: "# Two", note: "say the thing" });
	assert.deepEqual(splitNote("# Two"), { body: "# Two", note: "" });
	// Only at the start of a line — otherwise a slide about musical notes loses its text.
	assert.deepEqual(splitNote("A whole Note: is four beats"), { body: "A whole Note: is four beats", note: "" });
});

/*
 * Reveal's own default for `data-separator-notes` is `notes?:`, matched case-insensitively —
 * so `Note:`, `Notes:` and `note:` are all notes to it. This matched `^Note:` exactly, and a
 * deck written with the plural had its speaker notes rendered as body text on the slide,
 * which is the one failure mode a presenter finds out about in front of an audience.
 */
test("the plural and the lower case are notes too, as they are in reveal", () => {
	assert.deepEqual(splitNote("# Two\n\nNotes: say the thing"), { body: "# Two", note: "say the thing" });
	assert.deepEqual(splitNote("# Two\n\nnote: say the thing"), { body: "# Two", note: "say the thing" });
	assert.deepEqual(splitNote("# Two\n\nNOTES: say the thing"), { body: "# Two", note: "say the thing" });
	// And still only at the start of a line.
	assert.deepEqual(splitNote("Two notes: C and E"), { body: "Two notes: C and E", note: "" });
});

test("the logical size is the aspect, and nonsense is 16:9", () => {
	assert.deepEqual(logicalSize("16:9"), { w: 960, h: 540 });
	assert.deepEqual(logicalSize("4:3"), { w: 960, h: 720 });
	assert.deepEqual(logicalSize(), { w: 960, h: 540 });
	assert.deepEqual(logicalSize("0:0"), { w: 960, h: 540 });
	assert.deepEqual(logicalSize("widescreen"), { w: 960, h: 540 });
});

/*
 * The contact sheet fills the box rather than using a fixed column count, because a deck
 * board can be dragged to any shape. The property is: every slide fits, at the largest
 * thumbnail that allows it.
 */
test("the contact sheet picks the columns that fit", () => {
	const slide = { w: 960, h: 540 };
	assert.equal(sheetColumns(1, { w: 960, h: 540 }, slide), 1);
	// A square-ish box of twelve 16:9 thumbnails wants four across: three rows of four is
	// the first column count whose rows also fit.
	assert.equal(sheetColumns(12, { w: 960, h: 540 }, slide), 4);
	// A wide, short box has to go wider before the rows fit.
	assert.ok(sheetColumns(12, { w: 1600, h: 200 }, slide) >= 6);
	// And an absurd box returns something drawable rather than looping or returning zero.
	const absurd = sheetColumns(40, { w: 10, h: 10 }, slide);
	assert.ok(absurd >= 1 && absurd <= 40, String(absurd));
});
