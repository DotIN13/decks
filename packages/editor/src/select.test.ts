/**
 * The selection policy — the three kinds, and the one non-selection — on hand-built trees.
 *
 * No DOM here for the same reason as `tree.test.ts`: the parser is the browser's and is tested by the
 * differential. What is tested here is the *rule*, which is a pure function of a tree: what a press
 * means once a handle has found its node.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { describe, isProjection, kindOf, selectable, sourceOf } from "./select.ts";
import { bodyOf, type Part, type TreeNode } from "./node.ts";

function el(tag: string, attrs: Array<[string, string]> = [], parts: Part[] = [], leaf = false, content?: string): TreeNode {
	const node: TreeNode = { tag, attrs, parts, leaf, content };
	for (const part of parts) if (part.kind === "element") part.node.parent = node;
	return node;
}
const child = (node: TreeNode): Part => ({ kind: "element", node });

/** A board: `<html><head></head><body>…</body></html>`. */
function board(parts: Part[]): TreeNode {
	return el("html", [], [child(el("head")), child(el("body", [["class", "board"]], parts))]);
}

test("a projection is a projection whatever it holds", () => {
	const panel = el("div", [["data-md", ""]], [], true, "## What the round found\n\nTwo hundred and forty people.");
	assert.equal(isProjection(panel), true);
	assert.equal(kindOf(panel), "projection", "a projection wins over the leaf rule");
	assert.equal(sourceOf(panel), "## What the round found\n\nTwo hundred and forty people.", "its source is what the file holds");
	// A container projection has no text of its own to offer — a deck presents its children.
	const slides = el("div", [["data-slides", ""]], [child(el("section", [], [], true, "One"))]);
	assert.equal(kindOf(slides), "projection");
	assert.equal(sourceOf(slides), undefined);
});

test("a leaf and a container, told apart by what is inside them", () => {
	const paragraph = el("p", [], [], true, "One session, <b>one refresh</b>.");
	const card = el("section", [["data-id", "goal"]], [child(el("h3", [], [], true, "Goal")), child(paragraph)]);
	assert.equal(kindOf(paragraph), "leaf");
	assert.equal(kindOf(card), "container");
	assert.equal(sourceOf(card), undefined, "a container is not edited as a source");
});

test("the root, the head and the body are not things a press can select", () => {
	const p = el("p", [], [], true, "One refresh.");
	const root = board([child(p)]);
	const body = bodyOf(root);
	assert.ok(body);
	const headPart = root.parts[0];
	assert.ok(headPart && headPart.kind === "element");
	const head = headPart.node;

	assert.equal(selectable(body!, root), false, "the body is the root of a path, not a target");
	assert.equal(selectable(root, root), false, "nor is the html element");
	assert.equal(selectable(head, root), false, "and the head is not in a board's body at all");
	assert.equal(selectable(p, root), true, "while a paragraph inside the body is");
});

test("a selection is the node, its path, its kind, and its name when it has one", () => {
	const paragraph = el("p", [], [], true, "One refresh.");
	const card = el("section", [["class", "card"], ["data-id", "goal"]], [child(el("h3", [], [], true, "Goal")), child(paragraph)]);
	const root = board([child(card)]);
	const chosen = describe(card, root);
	assert.ok(chosen);
	assert.deepEqual(chosen!.path, [0]);
	assert.equal(chosen!.kind, "container");
	assert.equal(chosen!.id, "goal");
	const leaf = describe(paragraph, root);
	assert.equal(leaf!.kind, "leaf");
	assert.deepEqual(leaf!.path, [0, 1]);
	assert.equal(leaf!.id, undefined, "a leaf with no name has no id");
	const nothing = describe(bodyOf(root)!, root);
	assert.equal(nothing, undefined, "a press on the body selects nothing");
});
