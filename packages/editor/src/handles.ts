/**
 * Handles: how a press finds a node, and nothing else.
 *
 * A handle is an ordinary attribute in our own namespace, stamped on every element that is not
 * inside a leaf. It exists so that a press can be answered — `closest("[data-node]")` and a map
 * lookup — instead of counting siblings in a DOM that the board's own scripts have been changing.
 * The counting happens once, in the tree, when the path is built.
 *
 * Three properties, and each is the reason for a decision:
 *
 * - **It is never written back.** It exists in the frame and nowhere else; the file never contains
 *   one, and an edit leaves here as a path, not as a handle.
 * - **It changes no layout** and no board's stylesheet knows the name. `data-node` is ours.
 * - **A node that cannot be addressed still may not get one** — a leaf's marks, and text — but an
 *   element the *parser* implied (a `<tbody>` for a table that has none) does get one, because the
 *   client cannot tell an implied element from a spelled one: both look the same in a DOM. That is
 *   the server's business, and the server already refuses to write to a node with no start tag
 *   (*“cannot locate the tag”*).
 */
import type { TreeNode } from "./node.ts";
import { walk } from "./parse.ts";
import { STRUCTURAL } from "./select.ts";

export const HANDLE_ATTRIBUTE = "data-node";

/**
 * Give every addressable node a handle, in document order.
 *
 * Document order rather than a fresh id per render, so the same board produces the same handles
 * twice running: a diff of two renders is then about the document rather than about the counter.
 * Nodes inside a leaf have no handle, because a leaf is one address — its marks are its content.
 */
export function assignHandles(root: TreeNode): void {
	let next = 0;
	walk(root, (node) => {
		/*
		 * A structural tag is skipped: no handle, so nothing can press it.
		 *
		 * The handle *is* the editor's answer to "can this be edited", which is why the exclusion lives
		 * here rather than in a rule somewhere down the line. A `<tbody>` keeps its place in every path —
		 * it is an element child like any other — and never becomes a thing a press can land on.
		 */
		if (STRUCTURAL.has(node.tag)) return;
		node.handle = `n${next++}`;
	});
}

/**
 * After the browser has parsed our serialisation, pair every node with the element it became.
 *
 * One pass over the rendered document collecting handles, then one assignment per node — no
 * `querySelector` per node, and no dependence on the order the two walks happen to take. A node
 * whose handle is missing from the document keeps `element` undefined, which is what makes it
 * unpressable rather than wrong.
 */
export function collectHandles(root: TreeNode, document: Document): Map<string, Element> {
	const found = new Map<string, Element>();
	for (const element of document.querySelectorAll(`[${HANDLE_ATTRIBUTE}]`)) {
		const handle = element.getAttribute(HANDLE_ATTRIBUTE);
		if (handle) found.set(handle, element);
	}
	walk(root, (node) => {
		node.element = node.handle === undefined ? undefined : found.get(node.handle);
	});
	return found;
}
