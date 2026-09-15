/**
 * The ops: what an edit leaves the editor as.
 *
 * Eight, all addressed the same way — **a path from the body** — which is what lets one family of ops
 * edit a component board, a flow document and a deck of slides. No op here mentions a component, a
 * block, or the kind of board: those were two vocabularies, and one addressing mode makes them one.
 *
 *     set        path, attrs?, style?        update · rename · order
 *     text       path, before, html          text · html
 *     insert     path (last index = where), html
 *     remove     path, before                remove · remove-child
 *     move       path, to (where it lands)   move-child · order
 *     replace    path, before, html          the escape hatch that closes the set
 *     duplicate  path, to?, offset?          the server's own bytes
 *     source     text                        the whole file, for markdown
 *
 * Three things every builder here has to get right, and none of them is about markup:
 *
 * - **the address is a path counted in the tree**, from the body. Not in the DOM, where the board's own
 *   script has been adding elements, and not from `data-id`, which is a name and not an address.
 * - **`before` is the words**, taken from the *tree* rather than from the rendered element. A drawn
 *   panel's text is the drawing, not the file; the tree holds the source, and the source is what the
 *   server will compare against.
 * - **nothing is serialised for the file.** An op carries markup only where markup is what changes —
 *   a leaf's run, an inserted block, a replaced element — and the untouched bytes around it are the
 *   server's business.
 */
import type { EditorOp } from "@decks/protocol";
import { bodyOf, type TreeNode } from "./node.ts";
import { pathOf } from "./address.ts";

/**
 * One of the eight — and **the same eight the protocol carries**.
 *
 * Not a copy of the union but the union itself, extracted per op: the editor builds these, the server
 * dispatches on them, and the two agreeing about the wire should be a fact of the types rather than
 * something a test has to check. Each op is named *and* kept in the union, because a builder returning
 * the union would make every caller narrow it again — `ops.move` produces a move, and the type says so.
 */
export type Op = EditorOp;
export type SetOp = Extract<EditorOp, { op: "set" }>;
export type TextOp = Extract<EditorOp, { op: "text" }>;
export type InsertOp = Extract<EditorOp, { op: "insert" }>;
export type RemoveOp = Extract<EditorOp, { op: "remove" }>;
export type MoveOp = Extract<EditorOp, { op: "move" }>;
export type ReplaceOp = Extract<EditorOp, { op: "replace" }>;
export type DuplicateOp = Extract<EditorOp, { op: "duplicate" }>;
export type SourceOp = Extract<EditorOp, { op: "source" }>;

/** Nothing can be edited that has no path: the body's children and below, and not the head. */
export function addressOf(root: TreeNode, node: TreeNode): number[] | undefined {
	return pathOf(root, node);
}

/**
 * The words at a node, as the file would read them.
 *
 * Walked over the **tree**, never the rendered element: `innerText` of a drawn panel is the drawing,
 * and the guard compares against the file. Text parts contribute their own value, a leaf contributes
 * its content with the tags taken off, and a container contributes everything below it in order — which
 * is exactly what the server's own text walk does on its side.
 */
export function wordsOf(node: TreeNode): string {
	if (node.leaf) return plain(node.content ?? "");
	let out = "";
	for (const part of node.parts) {
		if (part.kind === "text") out += part.value;
		else if (part.kind === "element") out += wordsOf(part.node);
	}
	return out;
}

/** Markup reduced to its words, entities put back. Enough for a guard that ignores whitespace. */
function plain(markup: string): string {
	return markup
		.replace(/<[^>]*>/g, "")
		.replaceAll("&nbsp;", " ")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&amp;", "&");
}

/** The size and place an element's style gives it, as strings — the file's own spelling is the server's. */
export function rectOf(node: TreeNode): Record<string, string> {
	const style = node.attrs.find(([name]) => name === "style")?.[1] ?? "";
	const rect: Record<string, string> = {};
	for (const part of style.split(";")) {
		const [name, value] = part.split(":").map((piece) => piece.trim());
		if (!name || !value) continue;
		if (["left", "top", "width", "height"].includes(name)) rect[name] = value;
	}
	return rect;
}

export const ops = {
	/** An attribute, a style, or a rect — one op, wherever the element is and whatever it is. */
	set(root: TreeNode, node: TreeNode, change: { attrs?: Record<string, string | null>; style?: Record<string, string | null> }): SetOp | undefined {
		const path = addressOf(root, node);
		if (!path) return undefined;
		return { op: "set", path, ...(change.attrs ? { attrs: change.attrs } : {}), ...(change.style ? { style: change.style } : {}) };
	},

	/** A run of words. The element's own tags are not part of this — they stay as the file has them. */
	text(root: TreeNode, node: TreeNode, html: string): TextOp | undefined {
		const path = addressOf(root, node);
		if (!path) return undefined;
		return { op: "text", path, before: wordsOf(node), html };
	},

	/** A block in, at the position's own address: the last index is where among the children it goes. */
	insert(root: TreeNode, parent: TreeNode, index: number, html: string): InsertOp | undefined {
		const path = addressOf(root, parent);
		if (!path) return undefined;
		return { op: "insert", path: [...path, index], html };
	},

	remove(root: TreeNode, node: TreeNode): RemoveOp | undefined {
		const path = addressOf(root, node);
		if (!path) return undefined;
		return { op: "remove", path, before: wordsOf(node) };
	},

	/** `to` is the index the node **ends up at**, counted after the move. */
	move(root: TreeNode, node: TreeNode, to: number): MoveOp | undefined {
		const path = addressOf(root, node);
		if (!path) return undefined;
		return { op: "move", path, to };
	},

	/** The element itself, tags and all — what `text` deliberately is not. */
	replace(root: TreeNode, node: TreeNode, html: string): ReplaceOp | undefined {
		const path = addressOf(root, node);
		if (!path) return undefined;
		return { op: "replace", path, before: wordsOf(node), html };
	},

	/**
	 * A copy the server makes from the file's own bytes.
	 *
	 * `offset` moves a placed copy beside its original. Where among siblings a copy lands is not an op
	 * yet: nothing has needed it, and an op that lies about what it can do is worse than a missing one.
	 * A client cannot copy faithfully: its DOM is a rendering, and a card's markup would come back
	 * re-spelled.
	 */
	duplicate(root: TreeNode, node: TreeNode, where: { offset?: { x: number; y: number } } = {}): DuplicateOp | undefined {
		const path = addressOf(root, node);
		if (!path) return undefined;
		return { op: "duplicate", path, ...(where.offset ? { offset: where.offset } : {}) };
	},

	/** The whole file: a markdown board, or the ⌥ textarea. The only op for a document with no tree. */
	source(text: string): SourceOp {
		return { op: "source", text };
	},
};

/** The body's address is the empty path, which is where every other path is counted from. */
export function isInBody(root: TreeNode, node: TreeNode): boolean {
	const body = bodyOf(root);
	if (!body) return false;
	let found = false;
	const walk = (candidate: TreeNode) => {
		if (candidate === node) found = true;
		for (const part of candidate.parts) if (part.kind === "element") walk(part.node);
	};
	walk(body);
	return found;
}
