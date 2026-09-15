/**
 * The ops, as pure functions of a tree and an intent.
 *
 * These are the shapes that leave the editor, so they are the contract with the server and worth
 * testing without a browser: the address of every kind of node, the words a guard is taken from, and
 * the two payloads that are *not* interchangeable — a leaf's run against an element's whole markup.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { bodyOf, type Part, type TreeNode } from "./node.ts";
import { ops, rectOf, wordsOf } from "./ops.ts";

function el(tag: string, attrs: Array<[string, string]> = [], parts: Part[] = [], leaf = false, content?: string): TreeNode {
	const node: TreeNode = { tag, attrs, parts, leaf, content };
	for (const part of parts) if (part.kind === "element") part.node.parent = node;
	return node;
}
const text = (value: string): Part => ({ kind: "text", value });
const child = (node: TreeNode): Part => ({ kind: "element", node });

/** `<html><head></head><body>…</body></html>` — a board, as a tree. */
function board(parts: Part[]): TreeNode {
	return el("html", [], [child(el("head")), child(el("body", [["class", "board"]], parts))]);
}

/** The board every test in this file uses: a card with a heading and a paragraph, and a panel. */
function plan() {
	const heading = el("h3", [], [], true, "Goal");
	const paragraph = el("p", [], [], true, "One session, <b>one refresh</b>.");
	const panel = el("div", [["data-md", ""]], [], true, "## The sequence\n\n1. Tab A and tab B both see a 401.");
	const card = el("section", [["class", "card"], ["data-id", "goal"], ["style", "left: 48px; top: 168px"]], [text("\n\t"), child(heading), text("\n\t"), child(paragraph)]);
	const root = board([text("\n"), child(card), text("\n"), child(panel), text("\n")]);
	return { root, card, heading, paragraph, panel };
}

test("every address is a path from the body, element children only", () => {
	const { root, card, heading, panel } = plan();
	assert.deepEqual(ops.move(root, card, 1)?.path, [0], "the card is the body's first element child");
	assert.deepEqual(ops.move(root, heading, 0)?.path, [0, 0], "the heading is inside it");
	assert.deepEqual(ops.move(root, panel, 0)?.path, [1], "the panel is the second, past the card's text and its own");
	const body = bodyOf(root)!;
	assert.deepEqual(ops.set(root, body, { attrs: { "data-bg": "grid" } })?.path, [], "the body's address is empty — the root every path is counted from");
	assert.equal(ops.set(root, root, { attrs: {} }), undefined, "the html element is outside the body and cannot be addressed");
});

test("set carries only what changes, and a rect is the style it is in the file", () => {
	const { root, card } = plan();
	assert.deepEqual(ops.set(root, card, { style: { left: "96px" } }), { op: "set", path: [0], style: { left: "96px" } });
	assert.deepEqual(ops.set(root, card, { attrs: { "data-tone": null } }), { op: "set", path: [0], attrs: { "data-tone": null } });
	assert.deepEqual(rectOf(card), { left: "48px", top: "168px" }, "the rect is read back out of the element's own style");
	assert.deepEqual(rectOf(plan().heading), {}, "and an element without one has no rect");
});

test("text is a run, and its guard is the words — taken from the tree, not from a rendering", () => {
	const { root, card, paragraph, panel } = plan();
	assert.deepEqual(ops.text(root, paragraph, "One session, one refresh."), {
		op: "text",
		path: [0, 1],
		before: "One session, one refresh.",
		html: "One session, one refresh.",
	});
	// Markup in the file is stripped for the guard, and entities are put back: the server compares words.
	assert.equal(wordsOf(paragraph), "One session, one refresh.");
	assert.equal(wordsOf(panel), "## The sequence\n\n1. Tab A and tab B both see a 401.");
	/*
	 * A container's words are everything below it, in order — **including the file's own whitespace**,
	 * which is the indentation between its children. Kept rather than trimmed, because it is what the
	 * file has there: the guard's two sides are this and the server's own text walk over the same bytes,
	 * and the comparison strips whitespace on both sides anyway. Throwing it away here would be the
	 * editor inventing a difference it then has to be excused for.
	 */
	assert.equal(wordsOf(card), "\n\tGoal\n\tOne session, one refresh.");

	/*
	 * And a panel's words are its **source**, not the drawing — the property the guard depends on.
	 *
	 * A rendered panel's text is the rendering; the file holds the markdown. A `before` taken from the
	 * DOM would compare the wrong thing, and every edit inside a board with a panel on it would be
	 * refused. So a container holding a panel reads its markdown, which is exactly what the server's own
	 * text walk sees on its side.
	 */
	const withPanel = el("section", [["data-id", "notes"]], [child(panel)]);
	const around = board([child(withPanel)]);
	assert.match(wordsOf(withPanel), /## The sequence/, "the source, not the drawing");
	assert.match(wordsOf(around), /Tab A and tab B both see a 401/, "and it survives being nested");
});

test("insert's last index is where the block goes; remove and move name the node itself", () => {
	const { root, card, heading } = plan();
	assert.deepEqual(ops.insert(root, card, 2, "<p>new</p>"), { op: "insert", path: [0, 2], html: "<p>new</p>" });
	assert.deepEqual(ops.insert(root, bodyOf(root)!, 2, "<div class=\"sticky\"></div>"), {
		op: "insert",
		path: [2],
		html: '<div class="sticky"></div>',
	});
	assert.deepEqual(ops.remove(root, heading), { op: "remove", path: [0, 0], before: "Goal" });
	assert.deepEqual(ops.move(root, heading, 1), { op: "move", path: [0, 0], to: 1 });
});

test("replace carries the element; duplicate carries where rather than what", () => {
	const { root, paragraph } = plan();
	assert.deepEqual(ops.replace(root, paragraph, "<p>One session, two tabs.</p>"), {
		op: "replace",
		path: [0, 1],
		before: "One session, one refresh.",
		html: "<p>One session, two tabs.</p>",
	});
	assert.deepEqual(ops.duplicate(root, paragraph, { to: 2 }), { op: "duplicate", path: [0, 1], to: 2 });
	assert.deepEqual(ops.duplicate(root, paragraph, { offset: { x: 16, y: 170 } }), {
		op: "duplicate",
		path: [0, 1],
		offset: { x: 16, y: 170 },
	});
});

test("source is the whole file, and the only op for a board with no tree", () => {
	assert.deepEqual(ops.source("## Notes\n"), { op: "source", text: "## Notes\n" });
});
