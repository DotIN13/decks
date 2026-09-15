/**
 * The tree, the paths and the serialiser — everything that does not need a browser.
 *
 * The parser is deliberately *not* here: `parseBoard` uses `DOMParser`, and the point of that choice
 * is that its behaviour is the browser's, so testing it against anything but a browser would be
 * testing a stand-in for the thing that matters. It is tested by the differential in
 * `e2e/checks/render-fidelity.mjs`, over the whole deck. The pure half — what a path counts, what a
 * handle is, what a serialisation looks like — is here, with hand-built trees and no DOM at all.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { nodeAt, pathOf } from "./address.ts";
import { assignHandles } from "./handles.ts";
import { bodyOf, elementParts, type Part, type TreeNode } from "./node.ts";
import { serialize } from "./serialize.ts";

/** A node, with the defaults spelled out so a test reads as a tree. */
function el(tag: string, attrs: Array<[string, string]> = [], parts: Part[] = [], leaf = false, content?: string): TreeNode {
	const node: TreeNode = { tag, attrs, parts, leaf, content };
	for (const part of parts) if (part.kind === "element") part.node.parent = node;
	return node;
}
const text = (value: string): Part => ({ kind: "text", value });
const comment = (value: string): Part => ({ kind: "comment", value });
const child = (node: TreeNode): Part => ({ kind: "element", node });

/** `<html><head></head><body>…</body></html>`, which is what a board's tree always is. */
function treeWith(bodyParts: Part[], bodyAttrs: Array<[string, string]> = [["class", "board"]]): TreeNode {
	const body = el("body", bodyAttrs, bodyParts);
	const head = el("head");
	return el("html", [], [child(head), child(body)]);
}

test("a path counts element children only — text and comments are not steps", () => {
	const goal = el("section", [["data-id", "goal"]], [text("\n\t"), child(el("h3", [], [], true, "Goal")), text("\n\t"), comment("a note"), child(el("p", [], [], true, "One refresh."))]);
	const root = treeWith([text("\n"), child(el("h1", [], [], true, "Plan")), text("\n"), comment("between"), child(goal), text("\n")]);
	const body = bodyOf(root);
	assert.ok(body);
	// The h1 is the first element child; the goal section is the second — the whitespace and the
	// comment between them take no steps.
	assert.deepEqual(pathOf(root, goal), [1]);
	assert.deepEqual(pathOf(root, elementParts(goal)[1]!), [1, 1]);
	assert.deepEqual(pathOf(root, body!), []);
	assert.equal(pathOf(root, el("div")), undefined, "a node outside the body has no path");
});

test("a leaf is one step, whatever inline marks it holds inside", () => {
	// `content` is the whole run: three links, and the path to the paragraph does not see them.
	const paragraph = el("p", [], [], true, 'One session, <a href="#x">one</a> refresh.');
	const root = treeWith([child(el("section", [["data-id", "goal"]], [child(paragraph)]))]);
	assert.deepEqual(pathOf(root, paragraph), [0, 0]);
	assert.equal(elementParts(paragraph).length, 0, "a leaf has no element children to count");
});

test("nodeAt walks the same rule back, so a path round-trips", () => {
	const inner = el("p", [], [], true, "One refresh.");
	const section = el("section", [["data-id", "goal"]], [child(el("h3", [], [], true, "Goal")), child(inner)]);
	const root = treeWith([child(section)]);
	for (const path of [[0], [0, 0], [0, 1]]) {
		const found = nodeAt(root, path);
		assert.ok(found, `nothing at ${path.join(".")}`);
		assert.deepEqual(pathOf(root, found!), path);
	}
	assert.equal(nodeAt(root, [9]), undefined);
	assert.equal(nodeAt(root, [0, 9]), undefined);
});

test("a handle per node, in document order, and the same handles twice running", () => {
	const goal = el("section", [["data-id", "goal"]], [child(el("h3", [], [], true, "Goal"))]);
	const root = treeWith([child(goal), child(el("p", [], [], true, "One refresh."))]);
	assignHandles(root);
	const order: string[] = [];
	const walk = (node: TreeNode) => {
		order.push(`${node.tag}=${node.handle}`);
		for (const part of node.parts) if (part.kind === "element") walk(part.node);
	};
	walk(root);
	/*
	 * Structural tags are skipped, so the numbering starts at the first thing that can be edited —
	 * `html`, `head` and `body` take a step in a path and never get a handle (`STRUCTURAL_TAGS`).
	 */
	assert.deepEqual(order, ["html=undefined", "head=undefined", "body=undefined", "section=n0", "h3=n1", "p=n2"]);
	const first = order.join(" ");
	assignHandles(root);
	order.length = 0;
	walk(root);
	assert.equal(order.join(" "), first, "a second assignment gives the same handles");
});

test("a serialisation is a document: the leaf's own markup, and a handle on everything else", () => {
	const paragraph = el("p", [["class", "lead"]], [], true, 'One session, <a href="#x">one</a> refresh.');
	const root = treeWith([child(el("section", [["data-id", "goal"]], [child(paragraph)])), child(el("br"))]);
	const html = serialize({ root, doctype: "<!doctype html>" });
	assert.match(html, /^<!doctype html>\n<html[^>]*>/);
	assert.match(html, /<section data-id="goal" data-node="n0">/, "attributes keep their order, the handle is last");
	assert.match(html, /<p class="lead" data-node="n1">One session, <a href="#x">one<\/a> refresh.<\/p>/, "a leaf is rendered from its own markup");
	assert.match(html, /<br [^>]*\/>/, "a void element does not get an end tag");
	assert.match(html, /<body class="board">/, "and the body carries no handle at all");
	assert.equal(html.includes("</br>"), false);
});

test("the base goes first in the head, because it governs what is resolved after it", () => {
	const root = treeWith([child(el("link", [["rel", "stylesheet"], ["href", "../lib/board.css"]]))]);
	const html = serialize({ root }, { base: "/api/board/boards/" });
	assert.match(html, /<head[^>]*><base href="\/api\/board\/boards\/">/, html.slice(0, 120));
});

test("a container's text and every attribute value are escaped; a leaf's content is passed through", () => {
	/*
	 * Two different jobs, and getting them the same way round matters.
	 *
	 * A container's parts are *text*, so they are escaped on the way out. A leaf's `content` is
	 * already markup — it is the browser's own `innerHTML`, which is escaped where it needed to be —
	 * so escaping it again would turn `&amp;` into `&amp;amp;` and change the document. That is not a
	 * theoretical difference: the first version of this test asserted the wrong one and the assertion
	 * caught it.
	 */
	const root = treeWith(
		[
			text("a & b < c"),
			child(el("p", [["title", 'a "quoted" & dangerous']], [], true, "already &amp; escaped &lt;here&gt;")),
		],
		[["class", "board"]],
	);
	const html = serialize({ root });
	assert.match(html, /title="a &quot;quoted&quot; &amp; dangerous"/);
	assert.match(html, />a &amp; b &lt; c</, "a container's text is escaped");
	assert.match(html, /already &amp; escaped &lt;here&gt;/, "a leaf's markup goes out as it came in");
	assert.equal(html.includes("&amp;amp;"), false, "and is not escaped twice");
});
