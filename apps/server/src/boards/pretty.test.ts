import assert from "node:assert/strict";
import { test } from "node:test";
import { formatBlock } from "./pretty.ts";

/**
 * What these tests are for.
 *
 * The printer runs on the model's markup for one element, and the two things it must never do
 * are the two failures the whole write path is built to avoid: change bytes nobody edited, and
 * change what the document *says*. So there are two kinds of assertion here — the indentation
 * it adds, and the text it is not allowed to touch.
 */

test("a block is broken into lines, one element each, indented", () => {
	const one = '<section class="card" data-id="goal" style="left: 48px"><h3>Goal</h3><p>One session.</p></section>';
	assert.equal(
		formatBlock(one, "\t\t"),
		[
			'\t\t<section class="card" data-id="goal" style="left: 48px">',
			"\t\t\t<h3>Goal</h3>",
			"\t\t\t<p>One session.</p>",
			"\t\t</section>",
		].join("\n"),
	);
});

test("attributes, their order and their quoting come out as they went in", () => {
	// Not rebuilt from the parse tree: a serialiser would re-escape and re-quote, and a write
	// that reformats a line nobody edited is the thing this area exists to prevent.
	const markup = `<div data-tone="accent" class='callout' title="a > b &amp; c" data-id="x">t</div>`;
	assert.equal(formatBlock(markup, ""), markup);
});

test("an element holding words is left on one line, whatever its length", () => {
	const markup = '<p class="lede" data-id="lede">Seven changes to the shell, drawn at the size they are.</p>';
	assert.equal(formatBlock(markup, "\t"), `\t${markup}`);
});

test("mixed content is never re-flowed, because the spaces in it render", () => {
	// `<p>Hello <b>x</b>.</p>` on one line; broken across lines it would still render the
	// same here, but `Hello<b>` and `Hello <b>` do not — so the rule is to leave it alone.
	const markup = '<p>Hello <b>bold</b> and <a href="#">a link</a>.</p>';
	assert.equal(formatBlock(markup, "\t\t"), `\t\t${markup}`);
});

test("nesting goes one tab per level", () => {
	const markup = "<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>";
	assert.equal(
		formatBlock(markup, ""),
		["<table>", "\t<tbody>", "\t\t<tr>", "\t\t\t<td>a</td>", "\t\t\t<td>b</td>", "\t\t</tr>", "\t</tbody>", "</table>"].join("\n"),
	);
});

test("formatting is idempotent, which is what line numbers rest on", () => {
	const markup = '<section class="card" data-id="goal"><h3>Goal</h3><p>One session.</p></section>';
	const once = formatBlock(markup, "\t");
	assert.equal(formatBlock(once.replace(/\n\t\t/g, ""), "\t"), once);
});

test("a multi-line paragraph keeps its own line breaks", () => {
	// The model preserves the text's own whitespace, and a paragraph written over three
	// indented lines is the ordinary shape of a board. Re-flowing it would be an edit.
	const markup = "<p>A sentence that the author\n\t\t\t\twrote across two lines.</p>";
	assert.equal(formatBlock(markup, "\t\t"), `\t\t${markup}`);
});

test("a void element is one line, with no end tag invented", () => {
	assert.equal(formatBlock('<img src="a.png" alt="x"/>', "\t"), '\t<img src="a.png" alt="x"/>');
});

test("an element with no content at all is one line", () => {
	assert.equal(formatBlock('<div class="embed" data-id="e" data-embed="x.png"></div>', ""), '<div class="embed" data-id="e" data-embed="x.png"></div>');
});
