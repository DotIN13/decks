/**
 * The gestures' pure half: what a dragged value becomes, and what a new component is made of.
 *
 * The gestures themselves are checked in a browser (`e2e/checks/gestures.mjs`), because a gesture is only
 * right if a real mouse makes it happen. What is here is the arithmetic and the markup — a grid, a snapped
 * value, a name nothing is using, and the op a palette press produces.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { GRID, insertAt, markupFor, snap } from "./gestures.ts";
import { bodyOf, type Part, type TreeNode } from "./node.ts";
import type { EditorOp } from "@decks/protocol";

function el(tag: string, attrs: Array<[string, string]> = [], parts: Part[] = [], leaf = false, content?: string): TreeNode {
	const node: TreeNode = { tag, attrs, parts, leaf, content };
	for (const part of parts) if (part.kind === "element") part.node.parent = node;
	return node;
}
const child = (node: TreeNode): Part => ({ kind: "element", node });

test("a drag lands on the grid, and the grid is the eight the app has always used", () => {
	assert.equal(GRID, 8);
	assert.equal(snap(0), 0);
	assert.equal(snap(3), 0);
	assert.equal(snap(5), 8, "five is nearer eight than nothing");
	assert.equal(snap(-3), 0);
	assert.equal(snap(99), 96);
	assert.equal(snap(100), 104);
});

test("a new component's markup is placed, named, and made of the catalogue's own words", () => {
	const root = el("html", [], [child(el("head")), child(el("body", [["class", "board"]]))]);
	const markup = markupFor(root, "sticky", { x: 121, y: 703 });
	assert.match(markup, /^<div class="sticky" data-id="sticky" style="left: 120px; top: 704px; width: 220px">…<\/div>$/);
});

test("and a name nothing else is using, because a second component with one name means two things", () => {
	const taken = el("div", [["class", "sticky"], ["data-id", "sticky"]]);
	const alsoTaken = el("div", [["class", "sticky"], ["data-id", "sticky-2"]]);
	const root = el("html", [], [child(el("head")), child(el("body", [["class", "board"]], [child(taken), child(alsoTaken)]))]);
	const markup = markupFor(root, "sticky", { x: 0, y: 0 });
	assert.match(markup, /data-id="sticky-3"/, markup);
});

test("a palette press names the end of the body, because a new component is a new child of the board", () => {
	const existing = el("section", [["class", "card"], ["data-id", "goal"]]);
	const root = el("html", [], [child(el("head")), child(el("body", [["class", "board"]], [child(existing)]))]);
	assert.ok(bodyOf(root));

	const emitted: EditorOp[] = [];
	const op = insertAt({ root: () => root, emit: (patch) => emitted.push(patch) }, "card", { x: 48, y: 96 });
	assert.ok(op);
	assert.equal(op!.op, "insert");
	assert.deepEqual(op!.path, [1], "past the one component already there");
	assert.match(op!.html, /class="card"/);
	assert.deepEqual(emitted, [op], "and it is handed out immediately — the frame draws it when the write returns");
});
