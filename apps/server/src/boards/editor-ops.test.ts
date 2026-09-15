/**
 * The eight ops, against a real file.
 *
 * This is the other half of phase 4's proof. `patch.test.ts` holds the twelve to their behaviour
 * through the translation, so the twelve still work; this file holds the eight to theirs directly —
 * and one of these tests is the reason the whole change exists:
 *
 *     a path can name an element **inside** a component
 *
 * The twelve could not say that. Their component ops addressed a whole named element, and their block
 * ops addressed a path *within* one — so "the paragraph inside that card" was either a name that did
 * not exist or a path that had nowhere to start. With a path counted from the body, it is just a path.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPatches, PatchRefused } from "./patch.ts";

const BOARD = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Plan</title>
	</head>
	<body class="board">
		<section class="card" data-id="goal" style="left: 48px; top: 48px">
			<h3>Goal</h3>
			<p>One session, one refresh.</p>
		</section>
		<div class="sticky" data-id="risk" style="left: 48px; top: 240px">Refresh races</div>
	</body>
</html>
`;

/** The paths of this fixture from the body: `[0]` the card, `[0,1]` its paragraph, `[1]` the sticky. */
test("set writes a style on an element inside a component — a path the twelve could not name", () => {
	const { html } = applyPatches(BOARD, [{ op: "set", path: [0, 1], style: { margin: "0" } }]);
	assert.match(html, /<p style="margin:0">One session, one refresh\.<\/p>/, html);
	// And nothing else about the element moved: the card's own style is where it was.
	assert.match(html, /<section class="card" data-id="goal" style="left: 48px; top: 48px">/);
});

test("set renames through the same op, with the same validation the rename case had", () => {
	const renamed = applyPatches(BOARD, [{ op: "set", path: [0], attrs: { "data-id": "objective" } }]);
	assert.match(renamed.html, /data-id="objective"/);
	assert.match(renamed.summary.join(" "), /renamed/, renamed.summary.join(" "));
	assert.throws(
		() => applyPatches(BOARD, [{ op: "set", path: [0], attrs: { "data-id": "2 bad name" } }]),
		/is not a name a board can use/,
	);
	assert.throws(
		() => applyPatches(BOARD, [{ op: "set", path: [0], attrs: { "data-id": "risk" } }]),
		/is already a component called risk/,
	);
});

test("set removes an attribute with null, and clears the whitespace with it", () => {
	const { html } = applyPatches(BOARD, [{ op: "set", path: [1], attrs: { class: null } }]);
	assert.match(html, /<div data-id="risk" style="left: 48px; top: 240px">Refresh races<\/div>/, html);
});

test("text replaces a run inside a component, keeping its own tags", () => {
	const { html, summary } = applyPatches(BOARD, [
		{ op: "text", path: [0, 1], before: "One session, one refresh.", html: "One session, <b>one</b> tab." },
	]);
	assert.match(html, /<p>One session, <b>one<\/b> tab\.<\/p>/, html);
	assert.match(html, /<h3>Goal<\/h3>/, "the sibling is untouched");
	assert.match(summary.join(" "), /#goal/, "and the summary still speaks in names an agent recognises");
});

test("text refuses a run whose words are not what the editor was showing", () => {
	assert.throws(
		() => applyPatches(BOARD, [{ op: "text", path: [0, 1], before: "Something else entirely.", html: "x" }]),
		(error: Error) => error instanceof PatchRefused && /not what it was/.test(error.message),
	);
});

test("insert takes a path, and works at the body — the address the twelve had no way to name", () => {
	const added = applyPatches(BOARD, [{ op: "insert", path: [2], html: '<div class="sticky" data-id="note">A note</div>' }]);
	assert.match(added.html, /<div class="sticky" data-id="note">A note<\/div>\n\t<\/body>/, added.html);

	const nested = applyPatches(BOARD, [{ op: "insert", path: [0, 2], html: "<p>A second paragraph.</p>" }]);
	assert.match(nested.html, /<p>One session, one refresh\.<\/p>\n\t\t\t<p>A second paragraph\.<\/p>/, nested.html);
});

test("remove by path takes a paragraph out of a card, which the legacy remove could not", () => {
	const { html } = applyPatches(BOARD, [{ op: "remove", path: [0, 1], before: "One session, one refresh." }]);
	assert.equal(html.includes("One session"), false, html);
	assert.match(html, /<h3>Goal<\/h3>/, "its sibling stays");
	assert.throws(
		() => applyPatches(BOARD, [{ op: "remove", path: [0, 1], before: "not the words there" }]),
		/not what it was/,
	);
});

test("move reorders within a parent, addressed by path", () => {
	const { html } = applyPatches(BOARD, [{ op: "move", path: [0, 0], to: 1 }]);
	assert.match(html, /<p>One session, one refresh\.<\/p>\n\t\t\t<h3>Goal<\/h3>/, html);
});

test("replace writes one element whole, and refuses a file that moved underneath it", () => {
	const { html } = applyPatches(BOARD, [
		{ op: "replace", path: [1], before: "Refresh races", html: '<div class="sticky" data-id="risk">Two tabs, one refresh</div>' },
	]);
	assert.match(html, /<div class="sticky" data-id="risk">Two tabs, one refresh<\/div>/, html);
	assert.throws(
		() => applyPatches(BOARD, [{ op: "replace", path: [1], before: "something else", html: "<div>x</div>" }]),
		/not what it was when you started editing/,
	);
});

test("duplicate copies the server's own bytes, offset for a placed one", () => {
	const { html } = applyPatches(BOARD, [{ op: "duplicate", path: [1], offset: { x: 0, y: 64 } }]);
	const copies = html.match(/class="sticky"/g) ?? [];
	assert.equal(copies.length, 2, html);
	assert.equal(html.includes('data-id="risk-2"'), true, "and the copy has a name of its own");
});
