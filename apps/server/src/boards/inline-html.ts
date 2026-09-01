import { INLINE_TAGS } from "@decks/protocol";
import { parseFragment, serialize } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

type Element = DefaultTreeAdapterMap["element"];
type Node = DefaultTreeAdapterMap["node"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];

/**
 * Cleaning up what a `contenteditable` hands back, before any of it reaches a board file.
 *
 * A run of words with `<b>` and `<a>` inside it is edited in place as rich text, and the
 * browser sends back the element's `innerHTML`. That is the only way to keep the marks —
 * `textContent` would flatten `See <a>the doc</a>` to `See the doc` and throw the link away
 * — and it is also the reason this file exists, because `innerHTML` out of a
 * `contenteditable` is not what an author would have written. Engines split and merge marks
 * as the caret crosses them, leave `<b></b>` behind after a delete, emit a non-breaking
 * space at an inline edge, wrap a line break in a `<div>`, and hand over whatever a paste
 * brought with it: `style` attributes, classes, `<meta>`, `<o:p>`.
 *
 * **Normalising on the server rather than in the browser** is the one deliberate change of
 * shape from "write the new inner HTML into the element". The rule about what a board file
 * may contain belongs with the file: one implementation, testable without a DOM, and a
 * client that is buggy or is not this app cannot write markup a board should not hold. The
 * browser sends what it has; this decides what that means.
 *
 * The output is deterministic and idempotent, because a retype splices a byte range and a
 * diff nobody can review is the failure this whole area guards against. Given the same
 * content, the same bytes come out, whatever order the browser happened to produce them in.
 */

/**
 * The tags a run of words may be made of, from the protocol's own list.
 *
 * Shared with the browser deliberately (see `INLINE_TAGS`): the underline it draws and the
 * markup this accepts have to be the same question, or the app offers an edit the file then
 * refuses. A tag not on the list is **unwrapped** rather than dropped: its words survive and
 * its markup does not, which is the right answer for both ways one arrives — a paste that
 * brought `<span style>` soup, and an engine that wrapped a line break in a `<div>`.
 */
const INLINE = new Set<string>(INLINE_TAGS);

/**
 * The attributes those tags may carry.
 *
 * `class` is here because a board's own stylesheet is keyed on it — `<span class="when">` is
 * the authoring skill's own example — and `data-*` because an agent's custom component may
 * hang meaning off one. `style` is not: a hex colour pasted in from somewhere else is
 * exactly what the inspector refuses to write (§6.5), and boards use tokens. Nor `id`, which
 * a paste can duplicate and which means something structural here.
 */
const ATTRIBUTES = new Set(["class", "href", "hreflang", "lang", "dir", "title", "datetime", "cite", "rel", "type", "value"]);

/** Marks that mean the same thing wrapped twice, so `<b><b>x</b></b>` is `<b>x</b>`. */
const IDEMPOTENT = new Set(["a", "b", "code", "em", "i", "mark", "s", "small", "strong", "sub", "sup", "u"]);

/** Whether an element is one a run of words may be made of. */
export function isInlineTag(tag: string): boolean {
	return INLINE.has(tag.toLowerCase());
}

/**
 * Whether this element's own content is a run of words rather than a layout of blocks.
 *
 * "Can this be typed into", asked of the file: a `<p>` holding `<b>` and `<a>` is one run of
 * rich text, and a `<section>` holding an `<h3>` and a `<p>` is two runs with a box around
 * them. Editing the second as one field would replace a heading and a paragraph with a
 * line, which is the shape this refuses.
 */
export function isRichRun(element: Element): boolean {
	for (const node of descendants(element)) {
		const tag = (node as Element).tagName;
		if (tag && !isInlineTag(tag)) return false;
	}
	return true;
}

/**
 * The words in a scrap of inline markup, entities decoded.
 *
 * What the race guard compares, on both sides. The browser sends the element's
 * `textContent` and the file holds its markup, so the comparison has to be of *text*: two
 * serialisations of one document differ in ways that mean nothing — `<br>` against
 * `<br />`, `&amp;` against a bare `&` in an attribute — and agree about words. Parsing is
 * also what makes the file's side honest, since a leaf holding `a &amp; b` reads back as
 * `a & b` in the browser and comparing the raw bytes would refuse every edit to it.
 */
export function textOfInline(html: string): string {
	return textOf(parseFragment(html));
}

/** A `contenteditable`'s `innerHTML`, as bytes a board file can hold. */
export function normalizeInline(html: string): string {
	const fragment = parseFragment(html);
	unwrapForeign(fragment);
	stripAttributes(fragment);
	collapseNonBreakingSpaces(fragment);
	dropEmptyMarks(fragment);
	flattenDoubledMarks(fragment);
	mergeAdjacentMarks(fragment);
	/*
	 * `>` back to itself, because the file's convention is `escapeText`'s and not a
	 * serialiser's.
	 *
	 * parse5 escapes all three of `&`, `<` and `>`. The first two have to be escaped — they
	 * start something — and the third does not: a bare `>` in a text node is not special to
	 * the tokenizer. `escapeText` in `patch.ts` carries the note about why that matters
	 * here, and it is not a stylistic preference: a Mermaid source is `A --> B` on every
	 * line, and escaping the arrows rewrote every one of them, so the diff for retyping one
	 * line was the whole component and what the agent read back no longer looked like the
	 * diagram it had written. Attribute values are covered by the same replacement, where a
	 * bare `>` is equally legal.
	 */
	return serialize(fragment).replace(/&gt;/g, ">");
}

/** Every element that is not phrasing content gives up its tag and keeps its words. */
function unwrapForeign(parent: ParentNode): void {
	for (const child of [...(parent.childNodes ?? [])]) {
		const element = child as Element;
		if (!element.tagName) continue;
		unwrapForeign(element);
		if (!isInlineTag(element.tagName)) unwrap(element);
	}
}

function stripAttributes(parent: ParentNode): void {
	for (const child of parent.childNodes ?? []) {
		const element = child as Element;
		if (!element.tagName) continue;
		element.attrs = (element.attrs ?? []).filter(
			(attribute) => ATTRIBUTES.has(attribute.name) || attribute.name.startsWith("data-"),
		);
		stripAttributes(element);
	}
}

/**
 * A non-breaking space back to an ordinary one.
 *
 * Every engine inserts U+00A0 when a space is typed at an inline edge, because a plain one
 * would collapse and the caret would appear not to move. It is a rendering device rather
 * than something the user typed, so writing it into the file would put a character in the
 * board that nobody chose and that an agent reading the file cannot tell from a space.
 */
function collapseNonBreakingSpaces(parent: ParentNode): void {
	for (const child of parent.childNodes ?? []) {
		const element = child as Element;
		if (element.tagName) {
			collapseNonBreakingSpaces(element);
			continue;
		}
		const text = child as { value?: string };
		if (typeof text.value === "string") text.value = text.value.replace(/\u00A0/g, " ");
	}
}

/** `<b></b>`, left behind by deleting the last character inside it. */
function dropEmptyMarks(parent: ParentNode): void {
	for (const child of [...(parent.childNodes ?? [])]) {
		const element = child as Element;
		if (!element.tagName) continue;
		dropEmptyMarks(element);
		// `<br>` and `<wbr>` are empty by definition: they are the mark, not a wrapper.
		if (element.tagName === "br" || element.tagName === "wbr") continue;
		if (textOf(element).length === 0 && !hasElement(element)) remove(element);
	}
}

/** `<b><b>x</b></b>`, which a caret crossing a boundary twice can produce. */
function flattenDoubledMarks(parent: ParentNode): void {
	for (const child of [...(parent.childNodes ?? [])]) {
		const element = child as Element;
		if (!element.tagName) continue;
		flattenDoubledMarks(element);
		const only = element.childNodes?.length === 1 ? (element.childNodes[0] as Element) : undefined;
		if (!only?.tagName || only.tagName !== element.tagName) continue;
		if (!IDEMPOTENT.has(element.tagName) || !sameAttributes(element, only)) continue;
		unwrap(only);
	}
}

/** `<b>a</b><b>b</b>` into `<b>ab</b>`, which typing across a mark's end produces. */
function mergeAdjacentMarks(parent: ParentNode): void {
	const children = parent.childNodes ?? [];
	for (let index = children.length - 1; index > 0; index -= 1) {
		const right = children[index] as Element;
		const left = children[index - 1] as Element;
		if (!right?.tagName || !left?.tagName) continue;
		if (right.tagName !== left.tagName || !IDEMPOTENT.has(left.tagName)) continue;
		if (!sameAttributes(left, right)) continue;
		for (const node of right.childNodes ?? []) {
			node.parentNode = left;
			left.childNodes.push(node);
		}
		children.splice(index, 1);
	}
	for (const child of children) {
		if ((child as Element).tagName) mergeAdjacentMarks(child as Element);
	}
}

// --- walking -------------------------------------------------------------------------

function* descendants(parent: ParentNode): Generator<Node> {
	for (const child of parent.childNodes ?? []) {
		yield child;
		if ((child as Element).tagName) yield* descendants(child as Element);
	}
}

function textOf(parent: ParentNode): string {
	let out = "";
	for (const child of parent.childNodes ?? []) {
		if ((child as Element).tagName) out += textOf(child as Element);
		else out += (child as { value?: string }).value ?? "";
	}
	return out;
}

function hasElement(parent: ParentNode): boolean {
	for (const child of parent.childNodes ?? []) if ((child as Element).tagName) return true;
	return false;
}

function sameAttributes(a: Element, b: Element): boolean {
	const read = (element: Element) =>
		(element.attrs ?? [])
			.map((attribute) => `${attribute.name}=${attribute.value}`)
			.sort()
			.join(" ");
	return read(a) === read(b);
}

/** Replace an element with its own children, in place. */
function unwrap(element: Element): void {
	const parent = element.parentNode;
	if (!parent) return;
	const at = parent.childNodes.indexOf(element);
	if (at === -1) return;
	const moved = element.childNodes ?? [];
	for (const child of moved) child.parentNode = parent;
	parent.childNodes.splice(at, 1, ...moved);
}

function remove(element: Element): void {
	const parent = element.parentNode;
	if (!parent) return;
	const at = parent.childNodes.indexOf(element);
	if (at !== -1) parent.childNodes.splice(at, 1);
}
