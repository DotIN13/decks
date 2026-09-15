/**
 * The tree back out as a document, to be parsed by the browser.
 *
 * This is the renderer, and it is the smallest one that can work: containers are built element by
 * element, a leaf is handed over as its own markup, and the browser does the rest — parses it,
 * loads the stylesheets, fires `DOMContentLoaded`, runs the board's script. It has to go in as a
 * *document* rather than be assembled after load: `board.js` starts on `DOMContentLoaded`, and an
 * externally-loaded script appended once `readyState` is `complete` never sees that event, so the
 * panels would never draw.
 *
 * Two things are added that the file does not have, and both are harmless because nothing here is
 * ever written back to a file:
 *
 * - **the handles**, as `data-node`, so a press can find its node;
 * - **a `<base>`**, first thing in the head, so the board's own relative URLs — `../lib/board.css`,
 *   `../lib/board.js`, an image beside it — resolve exactly as they do in the board's own frame.
 *
 * And one thing is deliberately *not* done: there is no wrapper element between the body and its
 * children. A wrapper is what a library gave us once, and it put every board's root rule
 * (`body.board > *`, where `position: absolute` lives) one level out of reach — a page of
 * positioned boxes drew as a stack. The body is the body.
 */
import { assignHandles, HANDLE_ATTRIBUTE } from "./handles.ts";
import { isLeaf, type Part, type TreeNode } from "./node.ts";
import type { Tree } from "./parse.ts";

/** Escape text for markup. The only place this package writes characters. */
function escapeText(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Escape an attribute value. */
function escapeAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

/** A node's own markup: its start tag, its content, its end tag. */
function openTag(node: TreeNode): string {
	const attrs = node.attrs.map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join("");
	const handle = node.handle === undefined ? "" : ` ${HANDLE_ATTRIBUTE}="${node.handle}"`;
	const void_ = VOID.has(node.tag);
	return `<${node.tag}${attrs}${handle}${void_ ? " />" : ">"}`;
}

/** The tags that have no end tag, so a renderer does not invent one. */
const VOID = new Set([
	"area", "base", "br", "col", "embed", "hr", "img", "input",
	"link", "meta", "param", "source", "track", "wbr",
]);

/** One node, and everything under it. */
function render(node: TreeNode): string {
	if (VOID.has(node.tag)) return openTag(node);
	if (node.leaf) return `${openTag(node)}${node.content ?? ""}</${node.tag}>`;
	return `${openTag(node)}${node.parts.map(renderPart).join("")}</${node.tag}>`;
}

function renderPart(part: Part): string {
	if (part.kind === "element") return render(part.node);
	if (part.kind === "comment") return `<!--${part.value}-->`;
	return escapeText(part.value);
}

export interface SerializeOptions {
	/**
	 * The URL the board's relative paths resolve against — `boardDirUrl(path)`, `/api/board/<dir>/`.
	 * Injected as a `<base>` so a `<link>` written as `../lib/board.css` loads, which it does not
	 * without one: the frame's own URL is the app's, where `../lib/board.css` is a 404 in the
	 * console and a board with no stylesheet.
	 */
	base?: string;
}

/**
 * Serialise the tree as a document, assigning handles as it goes.
 *
 * Handles are assigned here rather than by the caller so that a serialisation is always a
 * *renderable* one: a document that carries the handles its tree will be collected by.
 */
export function serialize(tree: Tree, options: SerializeOptions = {}): string {
	assignHandles(tree.root);
	const body = render(tree.root);
	const base = options.base ? `<base href="${escapeAttribute(options.base)}">` : "";
	// The `<base>` goes immediately after `<head>` opens: it governs the URLs resolved after it.
	const withBase = base ? body.replace(/<head([^>]*)>/i, (match) => `${match}${base}`) : body;
	return `${tree.doctype ? `${tree.doctype}\n` : ""}${withBase}`;
}

/** Whether a node is a leaf, for callers holding only a node. */
export { isLeaf };
