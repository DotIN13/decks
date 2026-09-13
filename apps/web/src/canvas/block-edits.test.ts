import assert from "node:assert/strict";
import { test } from "node:test";
import { diffBlocks, type EditBlock } from "./block-edits.ts";

/**
 * The mapper, tested as arithmetic rather than through an editor.
 *
 * Both bugs the design's first run produced were in here — an index shift read as a move, and
 * inline churn emitted as ops of its own — and neither is visible in a screenshot. Split out of
 * GrapesJS, they are visible in an assertion.
 */

/** A block of a document, as the editor's snapshot holds it. */
const block = (id: string, html: string): EditBlock => ({
	id,
	html,
	// The text is what the server compares against; here it is whatever the markup says, since
	// these tests are about the arithmetic and not about extraction.
	text: html.replace(/<[^>]*>/g, ""),
});

const HEADING = block("a", "<h1>The round</h1>");
const FIRST = block("b", "<p>The first paragraph.</p>");
const SECOND = block("c", "<p>A second one.</p>");
const THIRD = block("d", "<p>A third.</p>");

test("an untouched document produces nothing at all", () => {
	/*
	 * The fidelity case, and not a formality: an editor that emits one op for opening and
	 * closing a board writes a revision nobody made, and the design's whole argument is that
	 * untouched bytes stay untouched.
	 */
	assert.deepEqual(diffBlocks([HEADING, FIRST, SECOND], [HEADING, FIRST, SECOND], "body"), { patches: [], refusals: [] });
});

test("a retype is one op carrying the block's inner HTML and its words", () => {
	const edited = { ...FIRST, html: "Rewritten, <b>with a mark</b>.", text: "Rewritten, with a mark." };
	const { patches, refusals } = diffBlocks([HEADING, FIRST, SECOND], [HEADING, edited, SECOND], "body");

	assert.deepEqual(refusals, []);
	assert.deepEqual(patches, [
		{ op: "html", id: "body", path: [1], before: "The first paragraph.", html: "Rewritten, <b>with a mark</b>." },
	]);
});

test("adding a mark without changing a word is still an edit", () => {
	const marked = { ...FIRST, html: "<p>The <b>first</b> paragraph.</p>", text: "The first paragraph." };
	const { patches } = diffBlocks([FIRST], [marked], "body");
	assert.equal(patches.length, 1, "compared as markup, so a new mark is a change even when the words are the same");
});

test("the three edits of the design's own run map to exactly three ops, in order", () => {
	// Retype the first paragraph, delete the second, append a new one — the case the design
	// reports, and the case whose *order* is the contract with the server.
	const edited = { ...FIRST, html: "Rewritten, <b>with a mark</b>.", text: "Rewritten, with a mark." };
	const added = block("e", "<p>A brand new paragraph.</p>");
	const { patches, refusals } = diffBlocks([HEADING, FIRST, SECOND], [HEADING, edited, added], "body");

	assert.deepEqual(refusals, []);
	assert.deepEqual(patches, [
		// Content first: its path is an index into the document as the editor loaded it, and
		// nothing has changed the structure yet.
		{ op: "html", id: "body", path: [1], before: "The first paragraph.", html: "Rewritten, <b>with a mark</b>." },
		// Then the removal, whose path is read from the same document.
		{ op: "remove-child", id: "body", path: [2], before: "<p>A second one.</p>" },
		// Then the insertion, whose path is the index it holds in the *new* document — which the
		// file has by then, because the removal took out exactly what the new document is
		// missing.
		{ op: "insert-child", id: "body", path: [2], html: "<p>A brand new paragraph.</p>" },
	]);
});

test("a deletion is not a move, however many blocks it shifts", () => {
	/*
	 * The design's first bug. Comparing absolute indices made every block below a deletion look
	 * as though it had moved, so deleting one paragraph emitted a move for each of the others.
	 * What decides it is the relative order of the blocks that survive.
	 */
	const { patches, refusals } = diffBlocks([HEADING, FIRST, SECOND, THIRD], [HEADING, SECOND, THIRD], "body");
	assert.deepEqual(refusals, []);
	assert.deepEqual(patches, [{ op: "remove-child", id: "body", path: [1], before: "<p>The first paragraph.</p>" }]);
});

test("two removals come out bottom-up, so the first index is still valid when the second runs", () => {
	const { patches } = diffBlocks([HEADING, FIRST, SECOND, THIRD], [HEADING, THIRD], "body");
	assert.deepEqual(patches, [
		{ op: "remove-child", id: "body", path: [2], before: "<p>A second one.</p>" },
		{ op: "remove-child", id: "body", path: [1], before: "<p>The first paragraph.</p>" },
	]);
});

test("two insertions come out top-down, each at the index it holds in the new document", () => {
	const added1 = block("e", "<p>New first.</p>");
	const added2 = block("f", "<p>New second.</p>");
	const { patches } = diffBlocks([HEADING], [added1, added2, HEADING], "body");
	assert.deepEqual(patches, [
		{ op: "insert-child", id: "body", path: [0], html: "<p>New first.</p>" },
		{ op: "insert-child", id: "body", path: [1], html: "<p>New second.</p>" },
	]);
});

test("a reorder is refused rather than described", () => {
	/*
	 * The blocks that survive have changed relative order, which none of the three ops
	 * expresses without churn — a move would have to be composed out of a removal and an
	 * insertion whose indices depend on each other. The design's answer is to say so and offer
	 * the source editor, so this is a refusal and not an op.
	 */
	const { patches, refusals } = diffBlocks([HEADING, FIRST, SECOND], [SECOND, HEADING, FIRST], "body");
	assert.deepEqual(patches, []);
	assert.deepEqual(refusals, ["blocks were reordered — offer the source editor"]);
});

test("a reorder beside a retype still refuses the whole commit", () => {
	// The ops beside a refusal are not half an edit to apply — they are what the mapper managed
	// to describe before it found something it could not, and a caller that sent them anyway
	// would write the part it understood into a document it did not.
	const edited = { ...FIRST, html: "<p>Changed.</p>", text: "Changed." };
	const { refusals } = diffBlocks([HEADING, FIRST, SECOND], [SECOND, edited, HEADING], "body");
	assert.equal(refusals.length, 1);
});

test("a block that is both retyped and moved is a reorder, not an edit", () => {
	// Deleting around a block is fine; moving it past another is the case with no op.
	const edited = { ...THIRD, html: "<p>Changed third.</p>", text: "Changed third." };
	const { refusals } = diffBlocks([HEADING, FIRST, SECOND, THIRD], [edited, HEADING, FIRST, SECOND], "body");
	assert.equal(refusals.length, 1, "the survivors are out of order, whatever else changed");
});
