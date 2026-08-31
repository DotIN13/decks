import assert from "node:assert/strict";
import { test } from "node:test";
import { redent, snap, undent } from "./Editor.ts";

/**
 * The round trip a markdown component's source makes, which is the whole reason
 * editing one produces a small diff rather than a reflowed file (DESIGN §6.5).
 *
 * The source is written in the board indented to match the HTML around it; the editor
 * shows it dedented, because that is what the parser sees and what its author meant;
 * and the commit puts the indentation back. Miss the second half and the panel still
 * renders — `board.js` dedents anyway — while every line of the block turns up in the
 * diff, which is exactly the failure the splicing design exists to avoid.
 */
const BLOCK = `
			## The sequence

			1. Tab A and tab B both see a 401.
			2. Both ask to refresh with \`t0\`.

			Cost per refresh stays $O(1)$.
		`;

test("a source block is shown without the indentation the file gave it", () => {
	const { text, indent } = undent(BLOCK);
	assert.equal(indent, "\t\t\t");
	assert.equal(
		text,
		"## The sequence\n\n1. Tab A and tab B both see a 401.\n2. Both ask to refresh with `t0`.\n\nCost per refresh stays $O(1)$.",
	);
});

test("and put back exactly where it was, so an untouched line is untouched", () => {
	const { text, indent } = undent(BLOCK);
	// The leading and trailing newlines are the file's own whitespace around the run,
	// which the server keeps and this never sees — everything between is byte-identical.
	assert.equal(redent(text, indent), BLOCK.replace(/^\n/, "").replace(/\n\t\t$/, ""));
});

test("a blank line stays blank rather than becoming trailing whitespace", () => {
	const { text, indent } = undent(BLOCK);
	assert.ok(
		redent(text, indent)
			.split("\n")
			.some((line) => line === ""),
		"the empty line between two paragraphs must not be re-indented",
	);
});

test("a line indented deeper than its neighbours keeps the difference", () => {
	// A nested list is the case: only the shared prefix comes off, so the two levels are
	// still two levels in the editor and still two levels in the file.
	const nested = "\n\t\t- one\n\t\t\t- under it\n\t";
	const { text, indent } = undent(nested);
	assert.equal(indent, "\t\t");
	assert.equal(text, "- one\n\t- under it");
	assert.equal(redent(text, indent), "\t\t- one\n\t\t\t- under it");
});

test("indentation is compared as characters, not counted", () => {
	// A board indented with spaces and one indented with tabs are both normal; counting
	// would let a commit write one on top of the other.
	const spaced = "\n    ## Hi\n    text\n  ";
	const { text, indent } = undent(spaced);
	assert.equal(indent, "    ");
	assert.equal(redent(text, indent), "    ## Hi\n    text");
});

test("a source written on one line has no indentation to keep", () => {
	// `<div data-md>## Hi</div>`, which is how a short panel is often written. The
	// server writes the text exactly as it comes in that case.
	const { text, indent } = undent("## Hi");
	assert.equal(indent, "");
	assert.equal(text, "## Hi");
	assert.equal(redent(text, indent), "## Hi");
});

test("an empty source is not a crash", () => {
	const { text, indent } = undent("\n\t\t");
	assert.equal(text, "");
	assert.equal(indent, "");
});

test("placements snap to the grid the drop path shares", () => {
	assert.equal(snap(3), 0);
	assert.equal(snap(5), 8);
	assert.equal(snap(-5), -8);
});
