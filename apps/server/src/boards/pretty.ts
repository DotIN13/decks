import { parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

type Element = DefaultTreeAdapterMap["element"];
type Node = DefaultTreeAdapterMap["node"];

/**
 * The model's markup, indented to sit where it is going.
 *
 * GrapesJS writes a component as one line: a card that gains a paragraph comes back as a
 * single `<section …><h3>…</h3><p>…</p></section>`, and a card holding a table as a two
 * thousand character one. An agent reading the file cannot work with that, so the writer
 * formats what it writes — and the boards say why this is the writer's job rather than the
 * library's: `the-editor-rewrite-the-writer-without-ops`, "pretty-printing the region it
 * writes".
 *
 * ### Two rules, and the second is the one that matters
 *
 * **Content that is already a list of elements is re-flowed**: one element per line, each
 * indented one tab deeper than its parent. That is a document's blocks — a card's heading and
 * paragraph, a table's rows — and the whitespace between them is the author's formatting
 * rather than anything the document means.
 *
 * **Content with words in it is left exactly as it is.** `<p>Hello <b>x</b>.</p>` is one line
 * and stays one line, because in HTML the space between `Hello` and `<b>` renders, and a
 * printer that broke that line would change what the board says. This is not caution for its
 * own sake: whitespace collapsing is the one part of HTML where "reformatting" and "editing"
 * are the same operation.
 *
 * ### It does not re-serialise
 *
 * Every tag, attribute and attribute value is copied out of the payload **byte for byte**,
 * taken from parse5's own source locations rather than rebuilt from the parse tree. A
 * serialiser would re-escape an attribute's `>` and re-quote its quotes — and the reason this
 * whole area exists is that a write which reformats what nobody edited is a write nobody can
 * review. The only bytes this file introduces are newlines and tabs.
 */
export function formatBlock(html: string, indent: string): string {
	const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
	const roots = (fragment.childNodes ?? []).filter((node) => (node as Element).tagName);
	const [root] = roots as Element[];
	// No element at all: there is nothing to indent, and refusing here would be a second
	// implementation of the check `checkBlock` already does.
	if (!root) return html.trim();
	return emit(root, html, indent).join("\n");
}

/**
 * One element, as lines.
 *
 * `inline` is the decision rule above, asked once per element: an element whose own content
 * contains words is emitted whole, and one whose content is only elements is broken into
 * lines with its children beneath it.
 */
function emit(element: Element, source: string, indent: string): string[] {
	const whole = slice(element, source);
	const children = (element.childNodes ?? []).filter((node) => (node as Element).tagName) as Element[];
	if (children.length === 0 || hasWords(element)) return [`${indent}${whole}`];

	const open = element.sourceCodeLocation?.startTag;
	const close = element.sourceCodeLocation?.endTag;
	if (!open || !close) return [`${indent}${whole}`];

	const lines = [`${indent}${source.slice(open.startOffset, open.endOffset)}`];
	for (const child of children) lines.push(...emit(child, source, indent + "\t"));
	lines.push(`${indent}${source.slice(close.startOffset, close.endOffset)}`);
	return lines;
}

/** The element's own bytes, from its first `<` to the `>` of its closing tag. */
function slice(element: Element, source: string): string {
	const location = element.sourceCodeLocation;
	if (!location) return "";
	const end = location.endTag?.endOffset ?? location.startTag?.endOffset ?? location.endOffset;
	return source.slice(location.startOffset, end);
}

/**
 * Whether an element's own content says anything in words.
 *
 * A run of whitespace between two blocks is formatting and gets replaced by the newline the
 * printer writes. A run with a character in it is the document, and the element holding it is
 * left alone.
 */
function hasWords(element: Element): boolean {
	for (const child of element.childNodes ?? []) {
		if ((child as Element).tagName) continue;
		const value = (child as { value?: string }).value ?? "";
		if (value.trim().length > 0) return true;
	}
	return false;
}
