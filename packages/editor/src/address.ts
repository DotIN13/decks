/**
 * The address of a node: a path from the body, always.
 *
 *     [0]        the body's first element child
 *     [2, 1]     the second element child of its third
 *
 * One rule for every kind of document — a component board, a flow document, a deck of slides — and
 * no second addressing mode. `data-id` stays in the file as a *name* (for a person, for an agent,
 * for a patch summary), and no longer as a way to point at anything.
 *
 * The counting is here, in the tree, and never in the DOM:
 *
 * - the tree came from the file, so a path counted in it is the file's path — the board's own script
 *   cannot shift it, and neither can the editor's own furniture;
 * - **element children only**, exactly as `parse5`'s `elementChildren` counts them on the server, so
 *   the same path means the same element on both sides. Text and comments are parts, not steps;
 * - a leaf is **one** step whatever marks are inside it, and a path never passes through one: every
 *   target is a container or a leaf, so a `<b>` inside a paragraph appears in no path in the system.
 */
import { bodyOf, indexOfElement, type TreeNode } from "./node.ts";

/** The path from the body to this node: element-child indices, outermost first. */
export function pathOf(root: TreeNode, node: TreeNode): number[] | undefined {
	const body = bodyOf(root);
	if (!body) return undefined;
	if (node === body) return [];
	const path: number[] = [];
	let cursor: TreeNode | undefined = node;
	while (cursor && cursor !== body) {
		const parent: TreeNode | undefined = cursor.parent;
		if (!parent) return undefined;
		const index = indexOfElement(parent, cursor);
		if (index === -1) return undefined;
		path.unshift(index);
		cursor = parent;
	}
	return cursor === body ? path : undefined;
}

/** The node a path names, walked over element children only. */
export function nodeAt(root: TreeNode, path: readonly number[]): TreeNode | undefined {
	const body = bodyOf(root);
	if (!body) return undefined;
	let cursor: TreeNode = body;
	for (const index of path) {
		const children = cursor.parts.filter((part) => part.kind === "element");
		const found = children[index];
		if (!found || found.kind !== "element") return undefined;
		cursor = found.node;
	}
	return cursor;
}
