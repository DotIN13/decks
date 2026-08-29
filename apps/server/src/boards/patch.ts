import type { BoardPatch, ComponentKind, Rect } from "@decks/protocol";
import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

type Element = DefaultTreeAdapterMap["element"];
type Node = DefaultTreeAdapterMap["node"];

/**
 * A user's edit, applied to the board file (DESIGN §6.5).
 *
 * Parsed with parse5 for **source locations**, then the original string is spliced.
 * Not re-serialised — that is the whole design of this file. Board HTML is written by
 * hand, by an agent that reads it back, and a re-serialise reflows the entire
 * document: every drag would produce a diff nobody can review and a file the agent
 * no longer recognises. So a drag rewrites exactly the `style` attribute's byte
 * range, and everything else in the file comes out identical.
 *
 * Anything that cannot be done that way is refused with a reason rather than
 * half-applied. The agent is the fallback editor, and it is a good one.
 */

export class PatchRefused extends Error {
	constructor(reason: string) {
		super(reason);
		this.name = "PatchRefused";
	}
}

export interface PatchOutcome {
	html: string;
	/** What changed, for the line the agent is told (§6.5). */
	summary: string[];
	ids: string[];
}

/**
 * Apply a batch of patches to a board's source.
 *
 * `name` mints an id for an insert that arrived without one, and it is called per
 * patch against the file *as it is by then* rather than once against the file as it
 * arrived. That distinction is the whole reason it is a parameter: naming the batch
 * up front gave two inserts of the same kind the same id — which is what dropping
 * two files on a board at once does — and the second was then refused for a name the
 * first had only just taken. Who decides the name still lives on the server (§6.5);
 * this only decides *when* it is asked.
 */
export function applyPatches(
	html: string,
	patches: BoardPatch[],
	name?: (html: string, kind: ComponentKind) => string,
): PatchOutcome {
	let current = html;
	const summary: string[] = [];
	const ids: string[] = [];

	/*
	 * Re-parsed per patch, deliberately. Source offsets move the moment a splice
	 * happens, and a batch of edits arrives from one gesture — so correctness beats
	 * the cost of parsing a 4KB document a handful of times.
	 */
	for (const patch of patches) {
		const named = patch.op === "insert" && !patch.id && name ? { ...patch, id: name(current, patch.kind) } : patch;
		const result = applyOne(current, named);
		current = result.html;
		summary.push(result.summary);
		ids.push(named.id);
	}

	return { html: current, summary, ids };
}

function applyOne(html: string, patch: BoardPatch): { html: string; summary: string } {
	const document = parse(html, { sourceCodeLocationInfo: true });

	if (patch.op === "insert") {
		const body = find(document, (node) => node.nodeName === "body");
		if (!body?.sourceCodeLocation?.endTag) {
			throw new PatchRefused("this board has no </body> to insert before");
		}
		if (findById(document, patch.id)) throw new PatchRefused(`there is already a component called ${patch.id}`);
		const at = body.sourceCodeLocation.endTag.startOffset;
		const indent = indentOf(html, at);
		const markup = `${render(patch.kind, patch.id, patch.at, patch.text, patch.embed, indent)}\n${indent}`;
		// The embed is named in the summary because that summary is what the agent is
		// told (§6.5): "added embed #embed-2" leaves it unable to see the file the user
		// just dropped without re-reading the board to find out what it points at.
		const showing = patch.kind === "embed" || patch.kind === "image" ? ` showing ${patch.embed ?? "nothing"}` : "";
		return {
			html: html.slice(0, at) + markup + html.slice(at),
			summary: `added ${patch.kind} #${patch.id}${showing}`,
		};
	}

	const element = findById(document, patch.id);
	if (!element) throw new PatchRefused(`no component with data-id="${patch.id}"`);
	const location = element.sourceCodeLocation;
	if (!location?.startTag) throw new PatchRefused(`cannot locate #${patch.id} in the source`);

	switch (patch.op) {
		case "update": {
			let next = html;
			let what = "changed";
			if (patch.style) {
				next = writeStyle(next, element, patch.style);
				what = describeMove(patch.style);
			}
			if (patch.class !== undefined) next = writeAttribute(next, reparse(next, patch.id), "class", patch.class);
			for (const [name, value] of Object.entries(patch.attrs ?? {})) {
				next = writeAttribute(next, reparse(next, patch.id), name, value);
			}
			return { html: next, summary: `${what} #${patch.id}` };
		}

		case "text": {
			if (!location.endTag) throw new PatchRefused(`#${patch.id} is a void element and has no text`);
			const from = location.startTag.endOffset;
			const to = location.endTag.startOffset;
			// Text only: a component whose content is markup — a card with a heading and
			// a list — is not something a plain-text replacement can edit without
			// throwing the markup away.
			if (/<[a-z!/]/i.test(html.slice(from, to))) {
				throw new PatchRefused(`#${patch.id} contains markup; edit it with the file tools instead`);
			}
			return {
				html: html.slice(0, from) + escapeText(patch.text) + html.slice(to),
				summary: `retyped #${patch.id}`,
			};
		}

		case "remove": {
			const start = trimBack(html, location.startOffset);
			const end = location.endOffset;
			return { html: html.slice(0, start) + html.slice(end), summary: `removed #${patch.id}` };
		}

		case "order": {
			const body = find(document, (node) => node.nodeName === "body");
			if (!body?.sourceCodeLocation?.startTag || !body.sourceCodeLocation.endTag) {
				throw new PatchRefused("this board has no <body> to reorder within");
			}
			const markup = html.slice(location.startOffset, location.endOffset);
			const start = trimBack(html, location.startOffset);
			const without = html.slice(0, start) + html.slice(location.endOffset);

			// Absolute positioning means paint order is document order, so "to front" is
			// "last in the body". Re-measured on the string the element was cut out of.
			const rebody = find(parse(without, { sourceCodeLocationInfo: true }), (node) => node.nodeName === "body");
			const target =
				patch.to === "front"
					? rebody?.sourceCodeLocation?.endTag?.startOffset
					: rebody?.sourceCodeLocation?.startTag?.endOffset;
			if (target === undefined) throw new PatchRefused("cannot find where to move it to");
			const indent = indentOf(without, target);
			const spaced = patch.to === "front" ? `${markup}\n${indent}` : `\n${indent}${markup}`;
			return { html: without.slice(0, target) + spaced + without.slice(target), summary: `sent #${patch.id} to ${patch.to}` };
		}

		default:
			throw new PatchRefused(`unknown operation`);
	}
}

// --- attributes ------------------------------------------------------------------

/**
 * Rewrite the `style` attribute, keeping every declaration the patch did not mention.
 *
 * A drag sets left and top; a resize sets width and height. Neither should discard
 * the `background` an agent put there, and neither should reorder the rest — so the
 * existing declarations are kept in their own order and only the named ones change.
 */
function writeStyle(html: string, element: Element, rect: Partial<Rect>): string {
	const existing = attributeValue(element, "style") ?? "";
	const declarations = existing
		.split(";")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const colon = part.indexOf(":");
			return colon === -1 ? [part, ""] : [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
		}) as Array<[string, string]>;

	const wanted = new Map<string, string>();
	for (const [key, value] of Object.entries(rect)) {
		if (typeof value === "number" && Number.isFinite(value)) wanted.set(key, `${Math.round(value)}px`);
	}

	const out: string[] = [];
	for (const [name, value] of declarations) {
		const replacement = wanted.get(name);
		if (replacement === undefined) out.push(`${name}: ${value}`);
		else {
			out.push(`${name}: ${replacement}`);
			wanted.delete(name);
		}
	}
	for (const [name, value] of wanted) out.push(`${name}: ${value}`);

	return writeAttribute(html, element, "style", out.join("; "));
}

function writeAttribute(html: string, element: Element, name: string, value: string): string {
	const location = element.sourceCodeLocation;
	if (!location?.startTag) throw new PatchRefused(`cannot locate the tag to set ${name} on`);

	const existing = location.attrs?.[name.toLowerCase()];
	const attribute = `${name}="${value.replace(/"/g, "&quot;")}"`;
	if (existing) {
		return html.slice(0, existing.startOffset) + attribute + html.slice(existing.endOffset);
	}
	// No such attribute yet: put it straight after the tag name, which is where a
	// person writing this by hand would have put it.
	const tagStart = location.startTag.startOffset;
	const nameEnd = tagStart + 1 + element.tagName.length;
	return `${html.slice(0, nameEnd)} ${attribute}${html.slice(nameEnd)}`;
}

function attributeValue(element: Element, name: string): string | undefined {
	return element.attrs.find((attribute) => attribute.name === name.toLowerCase())?.value;
}

// --- new components ----------------------------------------------------------------

/** The markup a palette tool inserts. Formatted as a person would write it. */
function render(
	kind: ComponentKind,
	id: string,
	at: Rect,
	text: string | undefined,
	embed: string | undefined,
	indent: string,
): string {
	const style = [
		`left: ${Math.round(at.left)}px`,
		`top: ${Math.round(at.top)}px`,
		...(at.width ? [`width: ${Math.round(at.width)}px`] : []),
		...(at.height ? [`height: ${Math.round(at.height)}px`] : []),
	].join("; ");
	const body = escapeText(text ?? defaultText(kind));

	switch (kind) {
		case "card":
			return `${indent}<section class="card" data-id="${id}" style="${style}">\n${indent}\t<h3>${body}</h3>\n${indent}</section>`;
		case "panel":
			return `${indent}<section class="panel" data-id="${id}" style="${style}">\n${indent}\t<h3>${body}</h3>\n${indent}</section>`;
		case "sticky":
			return `${indent}<div class="sticky" data-id="${id}" style="${style}">${body}</div>`;
		case "text":
			return `${indent}<div class="text" data-id="${id}" style="${style}">${body}</div>`;
		case "image":
			return `${indent}<div class="embed" data-id="${id}" data-embed="${embed ?? ""}" style="${style}"></div>`;
		case "embed":
			return `${indent}<div class="embed" data-id="${id}" data-embed="${embed ?? ""}" style="${style}"></div>`;
		case "arrow":
			// A connector names two components; the palette supplies them as the embed
			// field ("from>to") because that is the one thing an arrow is.
			{
				const [from, to] = (embed ?? "").split(">");
				if (!from || !to) throw new PatchRefused("an arrow needs a from and a to");
				return `${indent}<svg class="link" data-id="${id}" data-from="${from}" data-to="${to}"></svg>`;
			}
		default:
			throw new PatchRefused(`cannot insert a ${kind}`);
	}
}

function defaultText(kind: ComponentKind): string {
	switch (kind) {
		case "sticky":
			return "…";
		case "card":
		case "panel":
			return "Untitled";
		case "text":
			return "Text";
		default:
			return "";
	}
}

/** An id nobody is using, named after what it is. */
export function mintId(html: string, kind: ComponentKind): string {
	const taken = new Set([...html.matchAll(/data-id="([^"]+)"/g)].map((match) => match[1]!));
	for (let index = 1; index < 1000; index++) {
		const candidate = `${kind}-${index}`;
		if (!taken.has(candidate)) return candidate;
	}
	throw new PatchRefused("a thousand of those is enough");
}

// --- walking ------------------------------------------------------------------------

function find(node: Node, predicate: (node: Element) => boolean): Element | undefined {
	const children = (node as { childNodes?: Node[] }).childNodes ?? [];
	for (const child of children) {
		const element = child as Element;
		if (element.tagName && predicate(element)) return element;
		const nested = find(child, predicate);
		if (nested) return nested;
	}
	return undefined;
}

function findById(node: Node, id: string): Element | undefined {
	return find(node, (element) => element.attrs?.some((attribute) => attribute.name === "data-id" && attribute.value === id) ?? false);
}

function reparse(html: string, id: string): Element {
	const element = findById(parse(html, { sourceCodeLocationInfo: true }), id);
	if (!element) throw new PatchRefused(`lost #${id} while editing it`);
	return element;
}

/** The whitespace at the start of the line an offset falls on, so inserts line up. */
function indentOf(html: string, offset: number): string {
	const lineStart = html.lastIndexOf("\n", offset - 1) + 1;
	return html.slice(lineStart, offset).match(/^[\t ]*/)?.[0] ?? "";
}

/** Include the whitespace before a removed element, so deleting does not leave a hole. */
function trimBack(html: string, start: number): number {
	let index = start;
	while (index > 0 && (html[index - 1] === "\t" || html[index - 1] === " ")) index--;
	if (html[index - 1] === "\n") index--;
	return index;
}

function escapeText(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function describeMove(style: Partial<Rect>): string {
	const moved = style.left !== undefined || style.top !== undefined;
	const resized = style.width !== undefined || style.height !== undefined;
	return moved && resized ? "moved and resized" : resized ? "resized" : moved ? "moved" : "changed";
}
