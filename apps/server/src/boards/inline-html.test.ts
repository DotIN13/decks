import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { isRichRun, normalizeInline } from "./inline-html.ts";

type Element = DefaultTreeAdapterMap["element"];
type Node = DefaultTreeAdapterMap["node"];

/** A non-breaking space, which is what an engine inserts at an inline edge. */
const NBSP = "\u00A0";

/*
 * Each of these is a real thing a `contenteditable` hands back, so they are named after the
 * gesture that produces the mess rather than after the function that cleans it up.
 */

test("markup the author wrote comes through untouched", () => {
	const html = 'See <a href="../docs/notes.md" title="the notes">the doc</a>, then <b>ship it</b>.';
	assert.equal(normalizeInline(html), html);
});

test("normalising twice changes nothing, so a caret that only moved writes no diff", () => {
	const once = normalizeInline('a <b>b</b><b>c</b> <span style="color: red">d</span>');
	assert.equal(normalizeInline(once), once);
});

test("typing across the end of a mark, which splits it in two", () => {
	assert.equal(normalizeInline("<b>ship</b><b> it</b>"), "<b>ship it</b>");
	// Only where the mark means the same thing twice: two links are two links.
	assert.equal(normalizeInline('<a href="/a">one</a><a href="/b">two</a>'), '<a href="/a">one</a><a href="/b">two</a>');
	// And one link split by a caret is one link again.
	assert.equal(normalizeInline('<a href="/a">on</a><a href="/a">e</a>'), '<a href="/a">one</a>');
});

test("a caret crossing a boundary twice, which nests a mark inside itself", () => {
	assert.equal(normalizeInline("<b><b>x</b></b>"), "<b>x</b>");
	assert.equal(normalizeInline("<em><em><em>x</em></em></em>"), "<em>x</em>");
	// Different marks nested is meaningful and stays.
	assert.equal(normalizeInline("<b><i>x</i></b>"), "<b><i>x</i></b>");
});

test("deleting the last character inside a mark, which leaves the mark behind", () => {
	assert.equal(normalizeInline("a<b></b>b"), "ab");
	assert.equal(normalizeInline("a<b><i></i></b>b"), "ab");
	// A `<br>` is empty by definition: it is the mark, not a wrapper.
	assert.equal(normalizeInline("a<br>b"), "a<br>b");
});

test("a space typed at an inline edge, which every engine makes non-breaking", () => {
	assert.equal(normalizeInline(`ship${NBSP}it`), "ship it");
	assert.equal(normalizeInline(`<b>ship${NBSP}</b>it`), "<b>ship </b>it");
});

test("a paste, which brings styles and classes and tags of its own", () => {
	// The words are what the user meant; the markup is what the clipboard brought.
	assert.equal(normalizeInline('<span style="font-weight: 700">bold-ish</span>'), "<span>bold-ish</span>");
	assert.equal(normalizeInline("<p>a</p><p>b</p>"), "ab");
	assert.equal(normalizeInline("<div><b>keep this</b></div>"), "<b>keep this</b>");
	assert.equal(normalizeInline('<meta charset="utf-8"><b>x</b>'), "<b>x</b>");
});

test("a script is unwrapped like anything else, so nothing that runs can arrive", () => {
	/*
	 * Not a sanitiser for a browser's benefit — the app never sets `innerHTML` from a board,
	 * and a board is the user's own document. This is about what a *file* may contain: a
	 * `<script>` inside a paragraph is not a run of words, and a board's own scripts live in
	 * the document's `<script>` tags where its author put them.
	 */
	assert.equal(normalizeInline("a<script>alert(1)</script>b"), "aalert(1)b");
	assert.equal(normalizeInline('<img src="x" onerror="alert(1)">'), "");
	assert.equal(normalizeInline('<b onclick="alert(1)">x</b>'), "<b>x</b>");
});

test("class and data attributes survive, because a board's own CSS is keyed on them", () => {
	assert.equal(normalizeInline('<span class="when">week 1</span>'), '<span class="when">week 1</span>');
	assert.equal(normalizeInline('<span data-kind="figure">2,455</span>'), '<span data-kind="figure">2,455</span>');
	// `style` and `id` do not: one is a hex nobody chose, the other a paste can duplicate.
	assert.equal(normalizeInline('<span id="x" style="color: #f0c">a</span>'), "<span>a</span>");
});

test("the text is escaped the way the file escapes it", () => {
	// `&` and `<` are the two that start something; `>` is left alone, which is what keeps a
	// Mermaid `-->` readable in the file (see `escapeText` in patch.ts).
	assert.equal(normalizeInline("a &amp; b &lt; c > d"), "a &amp; b &lt; c > d");
});

// --- what may be typed into at all -------------------------------------------------

/** `isRichRun` asked of the element named `<x>` in a scrap of markup. */
function richRun(html: string): boolean {
	const find = (node: Node): Element | undefined => {
		for (const child of (node as { childNodes?: Node[] }).childNodes ?? []) {
			if ((child as Element).tagName === "x") return child as Element;
			const nested = find(child);
			if (nested) return nested;
		}
		return undefined;
	};
	const found = find(parse(`<body>${html}</body>`));
	assert.ok(found, "the fixture has no <x>");
	return isRichRun(found);
}

test("a run of words with marks in it is one field; a box of blocks is not", () => {
	assert.equal(richRun('<x>See <a href="/a">the doc</a>, then <b>ship it</b></x>'), true);
	assert.equal(richRun("<x>plain words</x>"), true);
	assert.equal(richRun("<x></x>"), true);
	assert.equal(richRun('<x><span class="when">week 1</span><span>Lock it</span></x>'), true);
	/*
	 * A heading and a paragraph are two runs with a box around them, and editing that as one
	 * field would replace both with a line. This is the rule that keeps double-clicking a
	 * card from swallowing everything inside it.
	 */
	assert.equal(richRun("<x><h3>Goal</h3><p>Keep it short.</p></x>"), false);
	assert.equal(richRun("<x>words <div>and a block</div></x>"), false);
	assert.equal(richRun("<x><ul><li>one</li></ul></x>"), false);
});
