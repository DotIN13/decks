import { fontSpan, h } from "./card-words.ts";

/**
 * The styles the card editor puts over a selection (`CardEditor.tsx`): the element each one is, and
 * the two moves on the page that putting one on or taking one off is made of.
 */

/** Take an element away and leave what it held in its place. */
export const unwrap = (n: Element) => n.replaceWith(...n.childNodes);
/*
 * A style over a selection, or taken off it: bold, italic, struck, code, a highlight, a colour.
 *
 * The browser cuts the selection into runs (`cut`): its highlight command splits a selection that
 * runs over several blocks, a heading and the paragraph under it, into one run per block, where
 * wrapping the range in one element put a heading inside a highlight. Each run is marked with a
 * colour no one would pick and then given the card's own element, so the browser's own bold, which
 * takes a heading for bold already and unbolds it, is never asked.
 */
export const STYLES = {
	bold: { selector: "strong, b", make: () => h("strong"), toggles: true },
	italic: { selector: "em, i", make: () => h("em"), toggles: true },
	strike: { selector: "s, strike, del", make: () => h("s"), toggles: true },
	code: { selector: "code", make: () => h("code"), toggles: true },
	hl: { selector: "mark", make: (v: string) => h("mark", v === "default" ? {} : { "data-c": v }), toggles: false },
	fg: { selector: "span[data-fg]", make: (v: string) => h("span", { "data-fg": v }), toggles: false },
	underline: { selector: "u", make: () => h("u"), toggles: true },
	size: { selector: "span[data-size]", make: (v: string) => h("span", { "data-size": v }), toggles: false },
	font: { selector: "span[data-font]", make: (v: string) => fontSpan(v), toggles: false },
	link: { selector: "a[data-href]", make: (v: string) => h("a", { "data-href": v }), toggles: false },
};
export type Style = keyof typeof STYLES;
const CUT = "rgb(1, 2, 3)";
/** Take `inner` out of `outer`, splitting `outer` round it: what was before and after it keeps `outer`. */
export function splitAround(inner: Node, outer: HTMLElement) {
	const before = document.createRange();
	before.setStart(outer, 0);
	before.setEndBefore(inner);
	const after = document.createRange();
	after.setStartAfter(inner);
	after.setEnd(outer, outer.childNodes.length);
	const head = before.extractContents();
	const tail = after.extractContents();
	if (head.textContent) {
		const piece = outer.cloneNode(false) as HTMLElement;
		piece.append(head);
		outer.before(piece);
	}
	if (tail.textContent) {
		const piece = outer.cloneNode(false) as HTMLElement;
		piece.append(tail);
		outer.after(piece);
	}
	unwrap(outer);
}

/** The selection as runs: plain spans, none of them across a block's edge. */
export function cut(ed: HTMLElement): HTMLElement[] {
	document.execCommand("styleWithCSS", false, "true");
	document.execCommand("hiliteColor", false, CUT);
	document.execCommand("styleWithCSS", false, "false");
	return ([...ed.querySelectorAll("*")] as HTMLElement[])
		.filter((el) => el.style.backgroundColor === CUT)
		.map((el) => {
			el.style.removeProperty("background-color");
			if (!el.getAttribute("style")) el.removeAttribute("style");
			// The colour landed on a block, or on one of the card's own elements: the run is inside it.
			if (el.tagName === "SPAN" && !el.attributes.length) return el;
			const run = document.createElement("span");
			run.append(...el.childNodes);
			el.append(run);
			return run;
		})
		.filter((run) => run.textContent);
}
