import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardPatch } from "@decks/protocol";
import { diffBlocks, type EditBlock, type EditNode } from "./block-edits.ts";

/**
 * The mapper, tested as arithmetic rather than through an editor.
 *
 * Both bugs the design's first run produced were in here — an index shift read as a move, and
 * inline churn emitted as ops of its own — and neither is visible in a screenshot. Split out of
 * GrapesJS, they are visible in an assertion.
 */

/**
 * An element of a document, as the editor's snapshot holds it.
 *
 * The text is what the server compares against; here it is whatever the markup says, since these
 * tests are about the arithmetic and not about extraction. The children are given only by the
 * tests that are about descending into them.
 */
const node = (tag: string, html: string, children: EditNode[] = []): EditNode => ({
	tag,
	html,
	outer: `<${tag}>${html}</${tag}>`,
	text: html.replace(/<[^>]*>/g, ""),
	children,
});

/**
 * A block, from the markup of the block itself.
 *
 * The tag and the inner HTML are pulled out of one string so the fixtures read the way the file
 * does — `block("b", "<p>The first paragraph.</p>")` is the element and its bytes, and the
 * payload a content op carries is everything between its tags.
 */
const block = (id: string, markup: string, children: EditNode[] = []): EditBlock => {
	const found = /^<([a-z0-9]+)[^>]*>([\s\S]*)<\/\1>$/.exec(markup);
	if (!found) throw new Error(`a block has to be one element: ${markup}`);
	return { id, node: node(found[1]!, found[2]!, children) };
};

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
	const edited = block("b", "<p>Rewritten, <b>with a mark</b>.</p>");
	const { patches, refusals } = diffBlocks([HEADING, FIRST, SECOND], [HEADING, edited, SECOND], "body");

	assert.deepEqual(refusals, []);
	assert.deepEqual(patches, [
		{ op: "html", id: "body", path: [1], before: "The first paragraph.", html: "Rewritten, <b>with a mark</b>." },
	]);
});

test("adding a mark without changing a word is still an edit", () => {
	const marked = block("b", "<p>The <b>first</b> paragraph.</p>");
	const { patches } = diffBlocks([FIRST], [marked], "body");
	assert.equal(patches.length, 1, "compared as markup, so a new mark is a change even when the words are the same");
});

test("the three edits of the design's own run map to exactly three ops, in order", () => {
	// Retype the first paragraph, delete the second, append a new one — the case the design
	// reports, and the case whose *order* is the contract with the server.
	const edited = block("b", "<p>Rewritten, <b>with a mark</b>.</p>");
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

test("a block dragged up becomes one move, naming the block that moved", () => {
	/*
	 * The gesture the editor was missing. `move-child` was built and tested on the server all
	 * along; what refused it was this mapper, which read a reorder as something it could not
	 * describe and offered the source textarea instead. Which block to move is the whole
	 * question — and it is the one the person dragged, not the two it passed.
	 */
	const { patches, refusals } = diffBlocks([HEADING, FIRST, SECOND], [SECOND, HEADING, FIRST], "body");
	assert.deepEqual(refusals, []);
	assert.deepEqual(patches, [{ op: "move-child", id: "body", path: [2], to: 0 }]);
});

test("a block dragged down is one move too — the moved block, not the ones above it", () => {
	// The other direction, and the one a left-to-right pass gets wrong: pulling each block into
	// place would move the first and second forward and leave the one that was dragged where it
	// was, which is the same file and a sentence about the wrong block.
	const { patches } = diffBlocks([HEADING, FIRST, SECOND], [FIRST, SECOND, HEADING], "body");
	assert.deepEqual(patches, [{ op: "move-child", id: "body", path: [0], to: 2 }]);
});

test("a move's index is read against the list the removals left, not the file as it loaded", () => {
	/*
	 * Two blocks deleted and the last one moved to the front. `path: [1]` is the moved block's
	 * index *after* the removals — at load it was 3 — and the two `remove-child` ops come first,
	 * bottom-up, exactly as they did before moves existed.
	 */
	const { patches, refusals } = diffBlocks([HEADING, FIRST, SECOND, THIRD], [THIRD, HEADING], "body");
	assert.deepEqual(refusals, []);
	assert.deepEqual(patches, [
		{ op: "remove-child", id: "body", path: [2], before: "<p>A second one.</p>" },
		{ op: "remove-child", id: "body", path: [1], before: "<p>The first paragraph.</p>" },
		{ op: "move-child", id: "body", path: [1], to: 0 },
	]);
});

test("a retype beside a move: the content first, and the move at its loaded index", () => {
	const edited = block("b", "<p>Rewritten.</p>");
	const { patches, refusals } = diffBlocks([HEADING, FIRST, SECOND], [SECOND, HEADING, edited], "body");
	assert.deepEqual(refusals, []);
	assert.deepEqual(patches, [
		{ op: "html", id: "body", path: [1], before: "The first paragraph.", html: "Rewritten." },
		{ op: "move-child", id: "body", path: [2], to: 0 },
	]);
});

test("an inserted block lands after the move, at the index it holds in the new document", () => {
	const added = block("e", "<p>A brand new one.</p>");
	const { patches } = diffBlocks([HEADING, FIRST], [FIRST, HEADING, added], "body");
	assert.deepEqual(patches, [
		{ op: "move-child", id: "body", path: [1], to: 0 },
		{ op: "insert-child", id: "body", path: [2], html: "<p>A brand new one.</p>" },
	]);
});

/**
 * The ops read the way the server reads them: in order, each against the list the one before
 * left. Here rather than imported from `boards/patch.ts` because that applier works on the
 * file's bytes and this is about the order of identities — the question being asked is what
 * document the mapper's own output produces, not whether it looks plausible.
 */
const applied = (ids: string[], patches: BoardPatch[]): string[] => {
	const list = [...ids];
	for (const patch of patches) {
		if (patch.op === "remove-child") list.splice(patch.path[patch.path.length - 1]!, 1);
		else if (patch.op === "insert-child") list.splice(patch.path[patch.path.length - 1]!, 0, patch.html);
		else if (patch.op === "move-child") {
			// Remove first, then insert at `to` in the list the removal left — the server's own
			// composition of the two, which is why `to` is an index in the *moved* structure.
			const [moved] = list.splice(patch.path[patch.path.length - 1]!, 1);
			list.splice(patch.to, 0, moved!);
		}
	}
	return list;
};

test("every permutation comes out as the document it was given, whatever it takes", () => {
	/*
	 * The property rather than a case: for a handful of orders, the ops the mapper emits — read
	 * in sequence the way the server reads them — reconstruct the order the editor was left in.
	 * This is what says the fallback pass is right for the reorders a single move cannot
	 * describe, which is the part of this arithmetic that is easy to get subtly wrong.
	 */
	const all = [HEADING, FIRST, SECOND, THIRD];
	const ids = all.map((b) => b.id);
	const orders = [
		[3, 0, 1, 2],
		[3, 2, 1, 0],
		[1, 0, 3, 2],
		[2, 3, 1, 0],
		[0, 2, 3, 1],
		[1, 2, 3, 0],
	];
	for (const order of orders) {
		const after = order.map((index) => all[index]!);
		const { patches, refusals } = diffBlocks(all, after, "body");
		assert.deepEqual(refusals, [], `order ${order.join("")} was refused`);
		assert.deepEqual(applied(ids, patches), after.map((b) => b.id), `order ${order.join("")} came out wrong`);
	}
});

/*
 * ── A block that holds blocks ────────────────────────────────────────────────────────
 *
 * The shape a single payload cannot describe, and the one a real document is full of: a table,
 * a list, a `<blockquote>` of paragraphs. Sending the block's own inner HTML asks the server to
 * replace a range that is a *layout*, and it refuses — `holds blocks rather than words` — so
 * typing a date into one cell of a table used to be refused at the commit and nowhere else.
 */

/** The inside of a one-row table whose cells are the given words — the block's child, one level at a time. */
const tbody = (cells: string[]): EditNode => {
	const row = `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
	return node("tbody", row, [node("tr", cells.map((cell) => `<td>${cell}</td>`).join(""), cells.map((cell) => node("td", cell)))]);
};

const TABLE = block("t", "<table><tbody><tr><td>61%</td><td>50%</td></tr></tbody></table>", [tbody(["61%", "50%"])]);

test("a cell of a table is addressed where it is, not as the whole table", () => {
	const edited = block("t", "<table><tbody><tr><td>62%</td><td>50%</td></tr></tbody></table>", [tbody(["62%", "50%"])]);
	const { patches, refusals } = diffBlocks([TABLE], [edited], "body");

	assert.deepEqual(refusals, []);
	assert.deepEqual(patches, [
		// The block, the body, the row, the cell — and the payload is the cell's own words.
		{ op: "html", id: "body", path: [0, 0, 0, 0], before: "61%", html: "62%" },
	]);
});

test("the cells nobody touched are never reached, so their bytes cannot move", () => {
	// The other half of the same point: one op, not one per cell, and not a re-serialisation of
	// the table. A payload for the whole block would rewrite every cell's whitespace.
	const edited = block("t", "<table><tbody><tr><td>61%</td><td>51%</td></tr></tbody></table>", [tbody(["61%", "51%"])]);
	const { patches } = diffBlocks([TABLE], [edited], "body");
	assert.deepEqual(patches, [{ op: "html", id: "body", path: [0, 0, 0, 1], before: "50%", html: "51%" }]);
});

test("a mark inside a cell is one run inside a block", () => {
	const edited = block("t", "<table><tbody><tr><td><b>61%</b></td><td>50%</td></tr></tbody></table>", [
		tbody(["<b>61%</b>", "50%"]),
	]);
	const { patches, refusals } = diffBlocks([TABLE], [edited], "body");
	assert.deepEqual(refusals, []);
	assert.deepEqual(patches, [{ op: "html", id: "body", path: [0, 0, 0, 0], before: "61%", html: "<b>61%</b>" }]);
});

test("a change of shape inside a block is refused, not approximated", () => {
	/*
	 * A row added: the tree above the new row has one child where the file has two, and no op
	 * says "insert a `<tr>` here" — the op set is about the editable root's children. The refusal
	 * names the level that disagrees, and the caller offers the file in the same breath.
	 */
	const twoRows = node("tbody", "<tr><td>61%</td><td>50%</td></tr><tr><td>44%</td><td>48%</td></tr>", [
		node("tr", "<td>61%</td><td>50%</td>", [node("td", "61%"), node("td", "50%")]),
		node("tr", "<td>44%</td><td>48%</td>", [node("td", "44%"), node("td", "48%")]),
	]);
	const grown = block("t", "<table><tbody><tr><td>61%</td><td>50%</td></tr><tr><td>44%</td><td>48%</td></tr></tbody></table>", [
		twoRows,
	]);
	const { patches, refusals } = diffBlocks([TABLE], [grown], "body");

	assert.deepEqual(patches, []);
	assert.deepEqual(refusals, ["the <tbody> at 0.0 changed shape"]);
});
