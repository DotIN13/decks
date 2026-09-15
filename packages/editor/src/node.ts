/**
 * The tree: one node per element, and the two kinds of node.
 *
 * This is the whole data model of the editor, and it is deliberately thin. A node holds **no
 * markup of its own** — not a serialised element, not a copy of its source — because the file's
 * bytes are the artifact and are never produced from here. What it holds is what the editor needs
 * to address the element and to draw it again:
 *
 * - **the tag and its attributes**, as the browser parsed them;
 * - **its parts**, in order — child elements, text runs, comments — which is what makes the
 *   *path* countable: `elementParts` is the one function every address goes through, and it counts
 *   elements only, exactly as `parse5`'s `elementChildren` does on the server;
 * - **a handle**, once one has been assigned, and **the element** it became once the tree has been
 *   rendered and collected;
 * - for a leaf, **its content as the browser's own markup** — see below.
 *
 * ### Two kinds of node, and why the second has no children
 *
 * A node is a **leaf** when everything inside it is inline: a heading, a paragraph, a table cell, a
 * panel. Its content is a run of words and marks, and the editor treats it as one thing — a caret
 * goes in it, and an edit replaces the whole run. So a leaf keeps `content` as a string and has no
 * parts at all. That is not a shortcut: it is the rule that makes the caret honest (a link inside a
 * paragraph is text the cursor walks through, not a thing to select) *and* the rule that makes the
 * renderer small (a leaf is handed back to the browser as markup, so the one place the browser
 * re-parses is a place nothing needs an address in).
 *
 * A **container** is everything else, and its content is its parts.
 *
 * `INLINE_TAGS` — shared with the server, which decides from the same list what a patch may write
 * into a file — is the definition of "inline". One list, two readers: an affordance can never
 * promise a refusal.
 */
import { INLINE_TAGS } from "@decks/protocol";

export type Part =
	| { kind: "element"; node: TreeNode }
	| { kind: "text"; value: string }
	| { kind: "comment"; value: string };

export interface TreeNode {
	/** Lower-case tag name, as the parser reported it. */
	tag: string;
	/** Attributes in document order — order matters, because it is what the file has. */
	attrs: Array<[string, string]>;
	/** Child nodes in order, for a container. A leaf has none. */
	parts: Part[];
	/** A leaf's content: the browser's own markup for what is inside it. */
	content?: string;
	/** True when everything inside is inline. */
	leaf: boolean;
	/** Assigned by `assignHandles`, in document order, and never written back to a file. */
	handle?: string;
	/** The rendered element, once `collectHandles` has paired this node with the frame's DOM. */
	element?: Element;
	/** The parent, so a path can be walked without searching the tree. */
	parent?: TreeNode;
}

const INLINE = new Set<string>(INLINE_TAGS);

/** The child *elements* of a node, in order — the sequence every path counts. */
export function elementParts(node: TreeNode): TreeNode[] {
	const out: TreeNode[] = [];
	for (const part of node.parts) if (part.kind === "element") out.push(part.node);
	return out;
}

/** The index of a child among its parent's element children, or -1. */
export function indexOfElement(parent: TreeNode, child: TreeNode): number {
	return elementParts(parent).indexOf(child);
}

/** Whether every element inside this one is inline. The leaf rule, over the tree. */
export function isLeaf(element: Element): boolean {
	for (const node of element.querySelectorAll("*")) {
		const tag = node.tagName.toLowerCase();
		if (!INLINE.has(tag)) return false;
	}
	return true;
}

/** The root of the tree the body sits in — what `pathOf` walks up to. */
export function bodyOf(root: TreeNode): TreeNode | undefined {
	if (root.tag === "body") return root;
	for (const part of root.parts) {
		if (part.kind !== "element") continue;
		const found = bodyOf(part.node);
		if (found) return found;
	}
	return undefined;
}
