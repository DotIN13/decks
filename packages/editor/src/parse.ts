/**
 * Source text in, tree out — and the parse is the browser's.
 *
 * There is deliberately no HTML parser in this package. `DOMParser` is the same engine, running
 * the same rules, that built the board's own frame from the same bytes; using it means our tree
 * and the browser's document have the same shape *by construction*, above the point where the
 * board's scripts start changing things. Writing a second parser would be authoring a second
 * answer to what HTML means, and then hoping two answers agree.
 *
 * What `DOMParser` does not give us is **byte offsets** — where each tag begins in the file — and
 * it does not need to: the server re-parses with `parse5` for those, and resolves the path we send.
 *
 * What it does give us, and we keep:
 *
 * - the document's own `<head>`, so the board's stylesheets and scripts come with it;
 * - the body's attributes, so `class="board"` and `data-bg` land where they were;
 * - comments, which are carried but are not element children and so never take a step in a path;
 * - the doctype, as a string, so the document we render is a document.
 */
import { isLeaf, type Part, type TreeNode } from "./node.ts";

export interface Tree {
	/** The whole document: `<html>`, with `<head>` and `<body>` inside it. */
	root: TreeNode;
	/** `<!doctype html>` as the file had it, if it had one. */
	doctype?: string;
}

/** Parse a board's source into a tree. Uses the browser's parser, or one that behaves like it. */
export function parseBoard(source: string): Tree {
	const parsed = new DOMParser().parseFromString(source, "text/html");
	const html = parsed.documentElement;
	return {
		root: nodeOf(html),
		doctype: parsed.doctype ? `<!doctype ${parsed.doctype.name}>` : undefined,
	};
}

/** One element, and everything under it, as a node. */
function nodeOf(element: Element): TreeNode {
	const node: TreeNode = {
		tag: element.tagName.toLowerCase(),
		attrs: [...element.attributes].map((attribute) => [attribute.name, attribute.value] as [string, string]),
		parts: [],
		leaf: isLeaf(element),
	};

	/*
	 * A leaf keeps its content as markup and stops here.
	 *
	 * The markup is the browser's spelling of it — attribute order, entities, quote style all as it
	 * re-serialised them — and that is harmless *because nothing here is ever written to a file*: the
	 * file is spliced on the server, inside ranges its own parse found. The only job of this string
	 * is to be handed back to the browser when the frame is rendered, which is the one place a
	 * re-parse costs nothing.
	 */
	if (node.leaf) {
		node.content = element.innerHTML;
		return node;
	}

	for (const child of element.childNodes) {
		const part = partOf(child);
		if (!part) continue;
		if (part.kind === "element") part.node.parent = node;
		node.parts.push(part);
	}
	return node;
}

/** A child node, when it is one this tree carries. */
function partOf(child: ChildNode): Part | undefined {
	if (child.nodeType === 1) return { kind: "element", node: nodeOf(child as Element) };
	if (child.nodeType === 3) return { kind: "text", value: (child as Text).data };
	if (child.nodeType === 8) return { kind: "comment", value: (child as Comment).data };
	// Anything else — a processing instruction, a CDATA section — is not something a board holds.
	return undefined;
}

/** Every node in the tree, in document order: parents before their children. */
export function walk(root: TreeNode, visit: (node: TreeNode) => void): void {
	visit(root);
	for (const part of root.parts) if (part.kind === "element") walk(part.node, visit);
}
