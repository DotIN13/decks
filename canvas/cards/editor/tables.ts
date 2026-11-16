// The editor's tables: what typing turns into a style or a block, and each style the bar
// puts on or takes off, with the element that holds it.
import { fontSpan, h } from "./model.ts";

/** What typing turns into a style as the closing mark is typed: `**bold**`, `==marked==`, `~~struck~~`, `` `code` ``, `*em*`. */
export const INLINE: Array<[RegExp, string]> = [
	[/\*\*([^*​]+)\*\*$/, "strong"],
	[/==([^=​]+)==$/, "mark"],
	[/~~([^~​]+)~~$/, "s"],
	[/`([^`​]+)`$/, "code"],
	[/(?:^|[^*])\*([^*​]+)\*$/, "em"],
	[/(?:^|[^_\w])_([^_​]+)_$/, "em"],
];

/** What typing at a block's start turns it into: a heading, a quote, a list or a checklist. */
export const BLOCKS: Record<string, string> = { "# ": "h1", "## ": "h2", "### ": "h3", "> ": "blockquote", "- ": "ul", "* ": "ul", "1. ": "ol", "[] ": "check", "[ ] ": "check" };

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
