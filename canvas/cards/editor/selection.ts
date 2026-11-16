// The page's selection: reading it, the block the caret is in, and putting the caret
// into an element or just after a node.
import { ZW } from "./model.ts";
import type { EditorCtx } from "./ctx.ts";

/** The page's selection: the caret, or the words selected. */
export const sel = () => getSelection()!;

/** The caret at the start of `el`, or all of it selected. */
export function caretInto(el: Element, all: boolean) {
	const r = document.createRange();
	r.selectNodeContents(el);
	if (!all) r.collapse(true);
	sel().removeAllRanges();
	sel().addRange(r);
}

/** The block of the page a node is in: the child of the editor holding it. */
export const topOf = (cx: EditorCtx, n: Node | null): HTMLElement | undefined => {
	while (n && n.parentNode !== cx.ed) n = n.parentNode;
	return n instanceof HTMLElement ? n : undefined;
};

/** The caret just after `node`, on a zero-width space put there so it has a place to sit. */
export function placeAfter(node: Node) {
	const z = document.createTextNode(ZW);
	node.parentNode!.insertBefore(z, node.nextSibling);
	const r = document.createRange();
	r.setStart(z, 1);
	r.collapse(true);
	sel().removeAllRanges();
	sel().addRange(r);
}
