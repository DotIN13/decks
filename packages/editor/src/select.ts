/**
 * What a press means: a node, its kind, and — for a projection — its source.
 *
 * The handle answers *which* node; this file answers *what kind*, and the difference is the whole of
 * the editor's policy. There are three kinds of selection, and one non-selection:
 *
 * - **a container** — a card, a document's body, a list. It can be moved, resized, deleted, reordered.
 * - **a leaf** — a heading, a paragraph, a table cell: one run of words, marks and all. It is where a
 *   caret goes, and its whole content is what an edit replaces.
 * - **a projection** — an element whose content the board's own script draws: `[data-md]` holds
 *   markdown, `[data-mermaid]` a diagram's source, `[data-embed]` a file, `[data-live]` a
 *   conversation. What the script drew inside it has **no handle**, so a press in there resolves to
 *   the element itself — mechanically, without a rule — and the only thing the editor has to decide is
 *   what to offer: **its source**, which is the text the file actually holds.
 * - **nothing** — the root and the head. A press on empty space clears the selection rather than
 *   selecting the body: the board's own chrome is not a component, and a person pressing the padding
 *   of a card means "not that one".
 *
 * One list, shared with the renderer and with the server, exactly as `INLINE_TAGS` is: the renderer
 * mounts these elements, the editor refuses to descend into them, and a patch that would write inside
 * one has nowhere to land. It is also the shorter half of the answer to "many uneditable elements":
 * the content is not editable as *elements* because it is not in the file, and it is editable as
 * *source*, which is what it is.
 */
import { STRUCTURAL_TAGS } from "@decks/protocol";
import type { TreeNode } from "./node.ts";
import { bodyOf } from "./node.ts";
import { pathOf } from "./address.ts";

/** The tags a press can never resolve to: a step in a path, never a target. Shared, like `INLINE_TAGS`. */
export const STRUCTURAL = new Set<string>(STRUCTURAL_TAGS);

/** The attributes whose content belongs to a renderer rather than to the file. */
export const PROJECTION_ATTRIBUTES = ["data-md", "data-mermaid", "data-embed", "data-live", "data-slides"] as const;

export type SelectionKind = "container" | "leaf" | "projection";

export interface Selection {
	node: TreeNode;
	/** The path from the body — the address an edit would be sent as. */
	path: number[];
	kind: SelectionKind;
	/** The element's own name, when the file gives it one. A name, not an address. */
	id?: string;
	/** For a projection whose source is text: what the file holds there. */
	source?: string;
}

/** Which of the three kinds this node is. A projection wins over the leaf rule. */
export function kindOf(node: TreeNode): SelectionKind {
	if (isProjection(node)) return "projection";
	return node.leaf ? "leaf" : "container";
}

/** Whether the board's script owns this element's content. */
export function isProjection(node: TreeNode): boolean {
	return node.attrs.some(([name]) => (PROJECTION_ATTRIBUTES as readonly string[]).includes(name));
}

/**
 * Whether a press on this node should select anything at all.
 *
 * The root and the head do not, and neither does anything outside the body. They carry handles like
 * everything else — a path is counted *from* the body, so the body needs one — and they are simply
 * not things a person is pointing at when they press a board.
 */
export function selectable(node: TreeNode, root: TreeNode): boolean {
	const body = bodyOf(root);
	if (!body) return false;
	/*
	 * One list, not three special cases. The body, the head and the html element are not components —
	 * a path is counted *from* the body and a press on the frame around a board means “not that one” —
	 * and a `<tbody>` is not in the file at all. Same answer, same reason, one list: a step in an
	 * address and never a target.
	 */
	if (STRUCTURAL.has(node.tag)) return false;
	return pathOf(root, node) !== undefined;
}

/**
 * The source a projection is edited as.
 *
 * Text for the ones whose source *is* text: markdown, a diagram's description. Undefined for the
 * ones whose source is an attribute or a file — a `<div data-embed>` holds a path and a page range,
 * and there is nothing to type into it here.
 */
export function sourceOf(node: TreeNode): string | undefined {
	if (!isProjection(node)) return undefined;
	if (node.content !== undefined) return node.content;
	// A projection that is a container — `[data-slides]` — presents its children rather than holding
	// text, so it has no source of its own to offer.
	return node.leaf ? (node.element?.textContent ?? "") : undefined;
}

/** A node, described the way a selection is: what it is, where it is, what it holds. */
export function describe(node: TreeNode, root: TreeNode): Selection | undefined {
	if (!selectable(node, root)) return undefined;
	const path = pathOf(root, node);
	if (!path) return undefined;
	const id = node.attrs.find(([name]) => name === "data-id")?.[1];
	return { node, path, kind: kindOf(node), ...(id === undefined ? {} : { id }), ...(sourceOf(node) === undefined ? {} : { source: sourceOf(node) }) };
}
