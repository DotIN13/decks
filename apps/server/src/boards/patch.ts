import { BOX_CLASSES, type BoardPatch, type ComponentKind, type Rect } from "@decks/protocol";
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
	/**
	 * The id each patch ended up acting on, in order.
	 *
	 * Not always the id the patch named: an insert arrives unnamed, a duplicate mints
	 * a name from the original's, and a rename ends on the new one. This is what the
	 * edit is *called* afterwards, which is what an agent needs to address it.
	 */
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
		ids.push(result.id ?? named.id);
	}

	return { html: current, summary, ids };
}

function applyOne(html: string, patch: BoardPatch): { html: string; summary: string; id?: string } {
	const document = parse(html, { sourceCodeLocationInfo: true });

	if (patch.op === "insert") {
		const body = find(document, (node) => node.nodeName === "body");
		if (!body?.sourceCodeLocation?.endTag) {
			throw new PatchRefused("this board has no </body> to insert before");
		}
		if (findById(document, patch.id)) throw new PatchRefused(`there is already a component called ${patch.id}`);
		const at = body.sourceCodeLocation.endTag.startOffset;
		const indent = indentOf(html, at);
		const markup = `${render(patch, indent)}\n${indent}`;
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
			/*
			 * Whole phrases, not words with the id bolted on the end: one update can move
			 * a component, change what it is and set a tone, and "moved and made a
			 * callout and set data-tone #note" is not a sentence anybody can act on. The
			 * agent reads this (§6.5).
			 */
			const done: string[] = [];
			if (patch.style) {
				next = writeStyle(next, element, patch.style);
				done.push(`${describeMove(patch.style)} #${patch.id}`);
			}
			if (patch.class !== undefined) {
				next = writeAttribute(next, reparse(next, patch.id), "class", patch.class);
				done.push(describeClass(patch.id, patch.class));
			}
			for (const [name, value] of Object.entries(patch.attrs ?? {})) {
				next = writeAttribute(next, reparse(next, patch.id), name, value);
				// `null` is a removal and reads as one: "cleared data-tone" is what the
				// agent should hear, not `data-tone=""`, which is a different document.
				done.push(value === null ? `cleared ${name} on #${patch.id}` : `set ${name}="${value}" on #${patch.id}`);
			}
			return { html: next, summary: done.length > 0 ? done.join(" and ") : `changed #${patch.id}` };
		}

		case "text": {
			/*
			 * A card is a heading and a paragraph, and retyping one of them is not
			 * retyping the card — so the target is the component *or* a descendant of
			 * it, addressed by the indices of the element children walked into.
			 *
			 * Resolved against the parse tree, which is what makes the refusal below
			 * honest: a `[data-md]` panel's headings exist only in the rendered DOM the
			 * browser is looking at, so a path into one lands nowhere here and is
			 * refused rather than guessed at.
			 */
			let target = element;
			refuseIfSealed(target, patch.id);
			for (const index of patch.path ?? []) {
				const child = childElements(target)[index];
				if (!child) throw new PatchRefused(`cannot find that part of #${patch.id} in the source`);
				target = child;
				refuseIfSealed(target, patch.id);
			}
			const spot = target.sourceCodeLocation;
			if (!spot?.startTag) throw new PatchRefused(`cannot locate that part of #${patch.id} in the source`);
			if (!spot.endTag) throw new PatchRefused(`#${patch.id} is a void element and has no text`);
			const from = spot.startTag.endOffset;
			const to = spot.endTag.startOffset;
			// Text only: a component whose content is markup — a card with a heading and
			// a list — is not something a plain-text replacement can edit without
			// throwing the markup away. With a path, that is the *inner* element's
			// content, which is how the heading of such a card becomes editable at all.
			if (/<[a-z!/]/i.test(html.slice(from, to))) {
				throw new PatchRefused(`#${patch.id} contains markup; edit it with the file tools instead`);
			}
			/*
			 * The whitespace around the old text is kept, and only the text between it is
			 * replaced.
			 *
			 * A paragraph written over three indented lines is the normal shape of a board,
			 * and replacing the whole inner range pulled its text up onto the opening tag
			 * and its closing tag up behind it — a three-line diff for a retype, in a file
			 * whose whole point is that an edit reads as one line. The splice is still one
			 * byte range; it is just the *inner* one.
			 */
			const inner = html.slice(from, to);
			const lead = /^[ \t\r\n]*/.exec(inner)?.[0] ?? "";
			const trail = inner.length > lead.length ? (/[ \t\r\n]*$/.exec(inner)?.[0] ?? "") : "";
			/*
			 * And where that whitespace is being kept, the new text does not bring its own.
			 * A `contenteditable` hands back the indentation as part of the element's
			 * `textContent`, so a retyped paragraph arrived as "\n\t\t\t\tOne session…" and
			 * landed on top of the indent that was already there — a blank line in the file
			 * for every edit. Where the file had no whitespace of its own (`<h3>Goal</h3>`,
			 * a one-line sticky) the text is written exactly as it came, newlines included.
			 */
			const text = lead || trail ? patch.text.trim() : patch.text;
			const where = target === element ? `#${patch.id}` : `the <${target.tagName}> in #${patch.id}`;
			return {
				html: html.slice(0, from + lead.length) + escapeText(text) + html.slice(to - trail.length),
				summary: `retyped ${where}`,
			};
		}

		case "remove": {
			const start = trimBack(html, location.startOffset);
			const end = location.endOffset;
			return { html: html.slice(0, start) + html.slice(end), summary: `removed #${patch.id}` };
		}

		case "duplicate": {
			const body = find(document, (node) => node.nodeName === "body");
			if (!body?.sourceCodeLocation?.endTag) throw new PatchRefused("this board has no </body> to copy into");

			/*
			 * The copy is the original's own bytes, with two attributes rewritten inside
			 * it. That is the only copy that keeps a card's heading, its paragraph and
			 * its list — rendering a fresh component from the kind would produce the
			 * palette's placeholder wearing the same name.
			 *
			 * The offsets come from the same parse as everything else, rebased onto the
			 * slice, and are applied from the last one backwards so the earlier ones are
			 * still where the parse said they were.
			 */
			const start = location.startOffset;
			const to = nextName(html, patch.id);
			const edits: Array<{ from: number; to: number; text: string }> = [];
			const idAt = location.attrs?.["data-id"];
			if (!idAt) throw new PatchRefused(`cannot locate the name of #${patch.id}`);
			edits.push({ from: idAt.startOffset - start, to: idAt.endOffset - start, text: attr("data-id", to) });
			const offset = patch.offset ?? { x: 16, y: 16 };
			const styleAt = location.attrs?.style;
			if (styleAt) {
				// A connector has no position to offset, and neither has a component an
				// agent left unpositioned; both copy as they are rather than being given
				// coordinates this file invented.
				const existing = attributeValue(element, "style") ?? "";
				const left = pixelsOf(existing, "left");
				const top = pixelsOf(existing, "top");
				const moved = restyle(existing, {
					...(left === undefined ? {} : { left: left + offset.x }),
					...(top === undefined ? {} : { top: top + offset.y }),
				});
				edits.push({ from: styleAt.startOffset - start, to: styleAt.endOffset - start, text: attr("style", moved) });
			}
			const markup = splice(html.slice(start, location.endOffset), edits);

			const at = body.sourceCodeLocation.endTag.startOffset;
			const indent = indentOf(html, at);
			return {
				html: `${html.slice(0, at)}${indent}${markup}\n${indent}${html.slice(at)}`,
				summary: `duplicated #${patch.id} as #${to}`,
				id: to,
			};
		}

		case "rename": {
			if (!/^[A-Za-z][\w-]*$/.test(patch.to)) {
				throw new PatchRefused(`"${patch.to}" is not a name a board can use — letters, digits and dashes`);
			}
			if (patch.to === patch.id) return { html, summary: `#${patch.id} kept its name`, id: patch.id };
			if (findById(document, patch.to)) throw new PatchRefused(`there is already a component called ${patch.to}`);

			/*
			 * The connectors move with it. `data-from`/`data-to` name components by id
			 * (board.js resolves them at draw time), so renaming the component alone
			 * leaves an arrow pointing at nothing — and an arrow that silently stops
			 * being drawn is the worst kind of edit, because the file still looks right.
			 *
			 * One parse, every offset collected, applied back to front: renaming through
			 * repeated single-attribute writes would move the offsets under itself.
			 */
			const edits: Array<{ from: number; to: number; text: string }> = [];
			const idAt = location.attrs?.["data-id"];
			if (!idAt) throw new PatchRefused(`cannot locate the name of #${patch.id}`);
			edits.push({ from: idAt.startOffset, to: idAt.endOffset, text: attr("data-id", patch.to) });
			let links = 0;
			for (const end of ["data-from", "data-to"]) {
				for (const link of findAll(document, (node) => attributeValue(node, end) === patch.id)) {
					const spot = link.sourceCodeLocation?.attrs?.[end];
					if (!spot) continue;
					edits.push({ from: spot.startOffset, to: spot.endOffset, text: attr(end, patch.to) });
					links += 1;
				}
			}
			const also = links === 0 ? "" : ` (and ${links} connector end${links === 1 ? "" : "s"})`;
			return { html: splice(html, edits), summary: `renamed #${patch.id} to #${patch.to}${also}`, id: patch.to };
		}

		case "order": {
			const body = find(document, (node) => node.nodeName === "body");
			if (!body?.sourceCodeLocation?.startTag || !body.sourceCodeLocation.endTag) {
				throw new PatchRefused("this board has no <body> to reorder within");
			}
			const markup = html.slice(location.startOffset, location.endOffset);
			// Its own indentation travels with it. Taking the indent from the line it is
			// being moved *to* is what the first version did, and it put a component at
			// one tab against siblings at two — a reordered board that had been reindented
			// is a diff about whitespace with the actual change hidden in it.
			const indent = indentOf(html, location.startOffset);
			const start = trimBack(html, location.startOffset);
			const without = html.slice(0, start) + html.slice(location.endOffset);

			// Absolute positioning means paint order is document order, so "to front" is
			// "last in the body". Re-measured on the string the element was cut out of.
			const rebody = find(parse(without, { sourceCodeLocationInfo: true }), (node) => node.nodeName === "body");
			const end = rebody?.sourceCodeLocation?.endTag?.startOffset;
			const begin = rebody?.sourceCodeLocation?.startTag?.endOffset;
			if (end === undefined || begin === undefined) throw new PatchRefused("cannot find where to move it to");
			// To the front: on its own line above the `</body>` line, which means inserting
			// at the start of that line rather than at the tag — the closing tag's own
			// indent is already in the file and would otherwise be added to this one's.
			const target = patch.to === "front" ? without.lastIndexOf("\n", end - 1) + 1 : begin;
			const spaced = patch.to === "front" ? `${indent}${markup}\n` : `\n${indent}${markup}`;
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
	return writeAttribute(html, element, "style", restyle(attributeValue(element, "style") ?? "", rect));
}

/**
 * A `style` attribute with some declarations replaced and the rest left exactly as
 * they were — shared by a drag and by the copy a duplicate makes of its original.
 */
function restyle(existing: string, rect: Partial<Rect>): string {
	const wanted = new Map<string, string>();
	for (const [key, value] of Object.entries(rect)) {
		if (typeof value === "number" && Number.isFinite(value)) wanted.set(key, `${Math.round(value)}px`);
	}

	const out: string[] = [];
	for (const [name, value] of declarationsOf(existing)) {
		const replacement = wanted.get(name);
		if (replacement === undefined) out.push(`${name}: ${value}`);
		else {
			out.push(`${name}: ${replacement}`);
			wanted.delete(name);
		}
	}
	for (const [name, value] of wanted) out.push(`${name}: ${value}`);
	return out.join("; ");
}

function declarationsOf(style: string): Array<[string, string]> {
	return style
		.split(";")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const colon = part.indexOf(":");
			return colon === -1 ? [part, ""] : [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
		}) as Array<[string, string]>;
}

/** A pixel declaration as a number, for the one case that has to do arithmetic on one. */
function pixelsOf(style: string, name: string): number | undefined {
	const found = declarationsOf(style).find(([key]) => key === name);
	const value = found && Number.parseFloat(found[1]);
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Write an attribute, or — for a `null` value — take it out.
 *
 * Removal is not a nicety: `data-tone=""` is not the same document as no
 * `data-tone` at all, and "back to the default tone" is a thing the inspector has
 * to be able to say. The whitespace before the attribute goes with it, so clearing
 * one does not leave a double space in a line an agent reads back.
 */
function writeAttribute(html: string, element: Element, name: string, value: string | null): string {
	const location = element.sourceCodeLocation;
	if (!location?.startTag) throw new PatchRefused(`cannot locate the tag to set ${name} on`);

	const existing = location.attrs?.[name.toLowerCase()];
	if (value === null) {
		if (!existing) return html;
		let from = existing.startOffset;
		while (from > 0 && (html[from - 1] === " " || html[from - 1] === "\t")) from--;
		return html.slice(0, from) + html.slice(existing.endOffset);
	}
	if (existing) {
		return html.slice(0, existing.startOffset) + attr(name, value) + html.slice(existing.endOffset);
	}
	/*
	 * No such attribute yet: it goes at the end of the start tag, after whatever is
	 * already there.
	 *
	 * It used to go straight after the tag name, and the result read wrong to the
	 * reader who matters — an agent opening the file found
	 * `<div data-tone="warn" class="callout" data-id="decision">`, with the tone wedged
	 * in front of the two attributes every component leads with. Adding at the end is
	 * what a person does, and it leaves the line's beginning alone.
	 */
	let at = location.startTag.endOffset - 1;
	if (html[at] !== ">") throw new PatchRefused(`cannot see where the tag for ${name} ends`);
	if (html[at - 1] === "/") at -= 1;
	while (at > 0 && /\s/.test(html[at - 1]!)) at -= 1;
	return `${html.slice(0, at)} ${attr(name, value)}${html.slice(at)}`;
}

const attr = (name: string, value: string) => `${name}="${value.replace(/"/g, "&quot;")}"`;

function attributeValue(element: Element, name: string): string | undefined {
	return element.attrs.find((attribute) => attribute.name === name.toLowerCase())?.value;
}

/**
 * `data-edit="false"` — the author saying this text is not the user's to retype.
 *
 * Editability is otherwise *inferred*: a leaf element whose text is in the file is
 * editable, and that inference has no way to know that a number is computed, that a
 * label has to match a chart's axis, or that a script rewrites this line on every
 * mount. So the attribute is how a board declares it, and the browser refuses the
 * same thing before offering the gesture (`Editor.beginEditing`).
 *
 * Checked on the way *down* the path rather than by walking up: the descent already
 * visits exactly the component and the ancestors inside it, so a seal on a container
 * covers everything under it without a second traversal. Only `"false"` seals —
 * `data-edit` on its own is the opposite claim, and treating any value as a seal
 * would make the affordance turn editing off.
 */
function refuseIfSealed(element: Element, id: string): void {
	if (attributeValue(element, "data-edit") === "false") {
		throw new PatchRefused(`#${id} is marked data-edit="false" — that text is the board's, not the user's`);
	}
}

/**
 * Several splices at once, applied back to front.
 *
 * Every offset in this file comes from one parse, and a splice moves everything
 * after it — so an edit that touches three attributes (a rename, with the two
 * connectors that named the old id) either does them in descending order or
 * re-parses twice per attribute. Descending order is the cheap one and it cannot
 * drift.
 */
function splice(text: string, edits: Array<{ from: number; to: number; text: string }>): string {
	let out = text;
	for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
		out = out.slice(0, edit.from) + edit.text + out.slice(edit.to);
	}
	return out;
}

/**
 * The name a copy gets: `goal` -> `goal-2`, `sticky-1` -> `sticky-2`.
 *
 * Derived from the original rather than minted from the kind, because a copy of
 * `risk-refresh` called `sticky-7` tells nobody what it is — and an id is the one
 * thing in a board an agent addresses by hand.
 */
function nextName(html: string, id: string): string {
	const base = id.replace(/-\d+$/, "");
	const taken = new Set([...html.matchAll(/data-id="([^"]+)"/g)].map((match) => match[1]!));
	for (let index = 2; index < 1000; index++) {
		const candidate = `${base}-${index}`;
		if (!taken.has(candidate)) return candidate;
	}
	throw new PatchRefused("a thousand copies of that is enough");
}

// --- new components ----------------------------------------------------------------

/** The markup a palette tool inserts. Formatted as a person would write it. */
function render(patch: Extract<BoardPatch, { op: "insert" }>, indent: string): string {
	const { kind, id, at, text, embed } = patch;
	const style = [
		`left: ${Math.round(at.left)}px`,
		`top: ${Math.round(at.top)}px`,
		...(at.width ? [`width: ${Math.round(at.width)}px`] : []),
		...(at.height ? [`height: ${Math.round(at.height)}px`] : []),
	].join("; ");
	const body = escapeText(text ?? defaultText(kind));
	/*
	 * Extra attributes go into the markup rather than being written afterwards with
	 * `writeAttribute`: an insert is one splice, and this way a `data-pages` lands
	 * between the `data-id` and the `style`, which is where an agent writes one.
	 */
	const extra = Object.entries(patch.attrs ?? {})
		.map(([name, value]) => ` ${attr(name, value)}`)
		.join("");

	switch (kind) {
		case "card":
			return `${indent}<section class="card" data-id="${id}"${extra} style="${style}">\n${indent}\t<h3>${body}</h3>\n${indent}</section>`;
		case "panel":
			return `${indent}<section class="panel" data-id="${id}"${extra} style="${style}">\n${indent}\t<h3>${body}</h3>\n${indent}</section>`;
		case "sticky":
			return `${indent}<div class="sticky" data-id="${id}"${extra} style="${style}">${body}</div>`;
		case "text":
			return `${indent}<div class="text" data-id="${id}"${extra} style="${style}">${body}</div>`;
		case "image":
		case "embed":
			return `${indent}<div class="embed" data-id="${id}" data-embed="${embed ?? ""}"${extra} style="${style}"></div>`;
		case "arrow":
			/*
			 * A connector is its two ends and nothing else — no position, no size, since
			 * it covers the whole board and is routed from the components it names.
			 *
			 * The ends arrive as ordinary attributes. They used to arrive in the `embed`
			 * field as `"from>to"`, which was one string doing a job the protocol already
			 * had a shape for, and it meant the one op that could not be read without
			 * knowing the trick.
			 */
			{
				const from = patch.attrs?.["data-from"];
				const to = patch.attrs?.["data-to"];
				if (!from || !to) throw new PatchRefused("an arrow needs a from and a to");
				const rest = Object.entries(patch.attrs ?? {})
					.filter(([name]) => name !== "data-from" && name !== "data-to")
					.map(([name, value]) => ` ${attr(name, value)}`)
					.join("");
				return `${indent}<svg class="link" data-id="${id}" data-from="${from}" data-to="${to}"${rest}></svg>`;
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

function findAll(node: Node, predicate: (node: Element) => boolean): Element[] {
	const found: Element[] = [];
	for (const child of (node as { childNodes?: Node[] }).childNodes ?? []) {
		const element = child as Element;
		if (element.tagName && predicate(element)) found.push(element);
		found.push(...findAll(child, predicate));
	}
	return found;
}

/** The element children, in document order — what a `text` patch's path indexes. */
function childElements(element: Element): Element[] {
	return (element.childNodes ?? []).filter((child) => (child as Element).tagName) as Element[];
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

/**
 * What a class change is called, for the agent's line.
 *
 * A class attribute can carry anything, so the summary names the box class if it
 * finds one and says "restyled" if it does not — the agent then knows to look
 * rather than being told something confidently wrong.
 */
function describeClass(id: string, value: string): string {
	const box = value.split(/\s+/).find((token) => (BOX_CLASSES as readonly string[]).includes(token));
	return box ? `made #${id} a ${box}` : `restyled #${id}`;
}

function describeMove(style: Partial<Rect>): string {
	const moved = style.left !== undefined || style.top !== undefined;
	const resized = style.width !== undefined || style.height !== undefined;
	return moved && resized ? "moved and resized" : resized ? "resized" : moved ? "moved" : "changed";
}
