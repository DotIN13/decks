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
	 * The component each patch ended up acting on, in order.
	 *
	 * Rarely the id the patch named: an insert arrives unnamed, a duplicate mints a
	 * name from the original's, a rename ends on the new one, and a `text` op names no
	 * component at all — it names a `data-edit`, and the component is whichever one
	 * that run turned out to be inside. This is what the edit is *called* afterwards,
	 * which is what an agent needs in order to address it.
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
		ids.push(result.id);
	}

	return { html: current, summary, ids };
}

function applyOne(html: string, patch: BoardPatch): { html: string; summary: string; id: string } {
	const document = parse(html, { sourceCodeLocationInfo: true });

	if (patch.op === "insert") {
		const body = find(document, (node) => node.nodeName === "body");
		if (!body?.sourceCodeLocation?.endTag) {
			throw new PatchRefused("this board has no </body> to insert before");
		}
		if (findById(document, patch.id)) throw new PatchRefused(`there is already a component called ${patch.id}`);
		const at = body.sourceCodeLocation.endTag.startOffset;
		const indent = indentOf(html, at);
		// The run this component's text lives in is named here rather than in `render`,
		// because only this side of the call has the file to check the name against.
		const markup = `${render(patch, indent, freeName(editNames(html), `${patch.id}-${patch.kind === "sticky" || patch.kind === "text" ? "text" : "title"}`))}\n${indent}`;
		// The embed is named in the summary because that summary is what the agent is
		// told (§6.5): "added embed #embed-2" leaves it unable to see the file the user
		// just dropped without re-reading the board to find out what it points at.
		const showing = patch.kind === "embed" || patch.kind === "image" ? ` showing ${patch.embed ?? "nothing"}` : "";
		return {
			html: html.slice(0, at) + markup + html.slice(at),
			summary: `added ${patch.kind} #${patch.id}${showing}`,
			id: patch.id,
		};
	}

	/*
	 * Retyping is the one op that does not name a component.
	 *
	 * It names a `data-edit`, which its author wrote on the run of text itself, and the
	 * component is read back off the file — the nearest ancestor with a `data-id`. That
	 * is the direction the ownership actually runs: the browser knows which words were
	 * double-clicked, and only the file knows what those words are part of.
	 */
	if (patch.op === "text") return retype(html, document, patch.edit, patch.text);

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
			return { html: next, summary: done.length > 0 ? done.join(" and ") : `changed #${patch.id}`, id: patch.id };
		}

		case "remove": {
			const start = trimBack(html, location.startOffset);
			const end = location.endOffset;
			return { html: html.slice(0, start) + html.slice(end), summary: `removed #${patch.id}`, id: patch.id };
		}

		case "duplicate": {
			const body = find(document, (node) => node.nodeName === "body");
			if (!body?.sourceCodeLocation?.endTag) throw new PatchRefused("this board has no </body> to copy into");

			/*
			 * The copy is the original's own bytes, with a handful of attributes rewritten
			 * inside it. That is the only copy that keeps a card's heading, its paragraph
			 * and its list — rendering a fresh component from the kind would produce the
			 * palette's placeholder wearing the same name.
			 *
			 * The offsets come from the same parse as everything else, rebased onto the
			 * slice, and are applied from the last one backwards so the earlier ones are
			 * still where the parse said they were.
			 */
			const start = location.startOffset;
			const to = numbered(idNames(html), patch.id);
			const edits: Array<{ from: number; to: number; text: string }> = [];
			const idAt = location.attrs?.["data-id"];
			if (!idAt) throw new PatchRefused(`cannot locate the name of #${patch.id}`);
			edits.push({ from: idAt.startOffset - start, to: idAt.endOffset - start, text: attr("data-id", to) });
			/*
			 * And every `data-edit` inside it, which is the half a copy cannot skip.
			 *
			 * A `data-edit` is unique within a board and a `text` patch addresses one by
			 * that name alone, so a copy that kept the original's would give two components
			 * the same editable: retyping either would resolve to whichever came first in
			 * the file, and the server would have no way to tell which one the user
			 * double-clicked. The names are minted against the whole board and against each
			 * other, because a component may hold several runs off the same base.
			 */
			const takenEdits = editNames(html);
			for (const [name, spot] of editAttributes(element)) {
				const renamed = numbered(takenEdits, name);
				takenEdits.add(renamed);
				edits.push({ from: spot.startOffset - start, to: spot.endOffset - start, text: attr("data-edit", renamed) });
			}
			const offset = patch.offset ?? { x: 16, y: 16 };
			const styleAt = location.attrs?.style;
			if (styleAt) {
				// A component an agent left unpositioned copies as it is, rather than being
				// given coordinates this file invented.
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
			 * One splice, of the `data-id` attribute's own byte range.
			 *
			 * This used to rewrite every `data-from`/`data-to` that named the old id along
			 * with it, because a connector resolved its ends by name at draw time and a
			 * rename left an arrow pointing at nothing. Connectors are gone (`board.js`),
			 * and with them the only thing in a board that referred to a component by id
			 * from somewhere else — so a rename is now local, and what remains of the
			 * reason this is an op is the checking above and the name it answers with.
			 */
			const idAt = location.attrs?.["data-id"];
			if (!idAt) throw new PatchRefused(`cannot locate the name of #${patch.id}`);
			const renamed = splice(html, [{ from: idAt.startOffset, to: idAt.endOffset, text: attr("data-id", patch.to) }]);
			return { html: renamed, summary: `renamed #${patch.id} to #${patch.to}`, id: patch.to };
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
			return {
				html: without.slice(0, target) + spaced + without.slice(target),
				summary: `sent #${patch.id} to ${patch.to}`,
				id: patch.id,
			};
		}

		default:
			throw new PatchRefused(`unknown operation`);
	}
}

// --- retyping --------------------------------------------------------------------

/**
 * Write a run of text back into the file, addressed by its `data-edit`.
 *
 * The run is a leaf the author marked, and the component it belongs to is read off the
 * file rather than sent — see the note at the call site. Everything that can go wrong
 * here is refused with a reason instead of guessed at, because the browser has already
 * shown the user the edit and a refusal re-reads the frame (§6.5): a name nothing has,
 * a name two things have, and content that is markup rather than text.
 */
function retype(html: string, document: Node, edit: string, incoming: string): { html: string; summary: string; id: string } {
	const found = findByEdit(document, edit);
	if (found.length === 0) throw new PatchRefused(`nothing on this board is called data-edit="${edit}"`);
	/*
	 * Two runs with one name is the author's mistake, and it is the mistake this
	 * addressing scheme can make: with an index path a wrong answer was impossible and
	 * a refusal was common, and with a name the reverse. So it is checked rather than
	 * resolved to the first match — writing the user's words into a component they were
	 * not looking at is the worst available outcome.
	 */
	if (found.length > 1) {
		throw new PatchRefused(`data-edit="${edit}" is on ${found.length} elements — an editable name has to be unique in a board`);
	}
	const target = found[0]!;
	const component = componentOf(target);
	if (!component) throw new PatchRefused(`data-edit="${edit}" is not inside a component`);
	const id = attributeValue(component, "data-id")!;

	const spot = target.sourceCodeLocation;
	if (!spot?.startTag) throw new PatchRefused(`cannot locate data-edit="${edit}" in the source`);
	if (!spot.endTag) throw new PatchRefused(`data-edit="${edit}" is a void element and has no text`);
	const from = spot.startTag.endOffset;
	const to = spot.endTag.startOffset;
	/*
	 * Text only, and this is the check that keeps that true.
	 *
	 * A run made of markup — `<p>See <a>the doc</a></p>` — cannot be replaced by plain
	 * text without throwing the markup away, so the author marks the leaf instead. It
	 * catches a `[data-md]` whose source contains raw HTML too, for the same reason
	 * rather than a different one: the browser only ever had that element's
	 * `textContent`, which is the source with the tags already dropped, so writing it
	 * back is the same loss.
	 */
	if (/<[a-z!/]/i.test(html.slice(from, to))) {
		throw new PatchRefused(`data-edit="${edit}" contains markup; edit it with the file tools instead`);
	}
	/*
	 * The whitespace around the old text is kept, and only the text between it is
	 * replaced.
	 *
	 * A paragraph written over three indented lines is the normal shape of a board, and
	 * replacing the whole inner range pulled its text up onto the opening tag and its
	 * closing tag up behind it — a three-line diff for a retype, in a file whose whole
	 * point is that an edit reads as one line. The splice is still one byte range; it is
	 * just the *inner* one.
	 */
	const inner = html.slice(from, to);
	const lead = /^[ \t\r\n]*/.exec(inner)?.[0] ?? "";
	const trail = inner.length > lead.length ? (/[ \t\r\n]*$/.exec(inner)?.[0] ?? "") : "";
	/*
	 * And where that whitespace is being kept, the new text does not bring its own. A
	 * `contenteditable` hands back the indentation as part of the element's
	 * `textContent`, so a retyped paragraph arrived as "\n\t\t\t\tOne session…" and
	 * landed on top of the indent that was already there — a blank line in the file for
	 * every edit. Where the file had no whitespace of its own (`<h3>Goal</h3>`, a
	 * one-line sticky) the text is written exactly as it came, newlines included.
	 *
	 * A markdown source is the multi-line case, and the editor sends it indented to
	 * match the block it came out of: the first line's indent and the last line's
	 * newline are what this trim takes off, and every line between keeps the
	 * indentation the file already had, so changing one line of a rendered component is a one-line
	 * diff.
	 */
	const text = lead || trail ? incoming.trim() : incoming;
	const where = target === component ? `#${id}` : `the <${target.tagName}> in #${id}`;
	return {
		html: html.slice(0, from + lead.length) + escapeText(text) + html.slice(to - trail.length),
		summary: `retyped ${where}`,
		id,
	};
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
 * Several splices at once, applied back to front.
 *
 * Every offset in this file comes from one parse, and a splice moves everything
 * after it — so an edit that touches two attributes (a duplicate rewrites the copy's
 * `data-id` and its `style`) either does them in descending order or re-parses
 * between them. Descending order is the cheap one and it cannot drift.
 */
function splice(text: string, edits: Array<{ from: number; to: number; text: string }>): string {
	let out = text;
	for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
		out = out.slice(0, edit.from) + edit.text + out.slice(edit.to);
	}
	return out;
}

/**
 * A sibling of a name, never the name: `goal` -> `goal-2`, `sticky-1` -> `sticky-2`.
 *
 * What a copy is called, for a component and for every editable run inside it. Derived
 * from the original rather than minted from the kind, because a copy of `risk-refresh`
 * called `sticky-7` tells nobody what it is — and these names are the one thing in a
 * board a person and an agent both address by hand.
 */
function numbered(taken: Set<string>, from: string): string {
	const base = from.replace(/-\d+$/, "");
	for (let index = 2; index < 1000; index++) {
		const candidate = `${base}-${index}`;
		if (!taken.has(candidate)) return candidate;
	}
	throw new PatchRefused("a thousand copies of that is enough");
}

/** `wanted` when nothing has it, and a numbered sibling of it when something does. */
function freeName(taken: Set<string>, wanted: string): string {
	return taken.has(wanted) ? numbered(taken, wanted) : wanted;
}

/*
 * Read with a regex rather than off the parse tree, deliberately: these two answer
 * "what names are taken", which is a question about the whole file including the parts
 * a splice is about to move, and a parse is the expensive way to ask it.
 */
const idNames = (html: string) => new Set([...html.matchAll(/data-id="([^"]+)"/g)].map((match) => match[1]!));
const editNames = (html: string) => new Set([...html.matchAll(/data-edit="([^"]+)"/g)].map((match) => match[1]!));

/** Every `data-edit` in a subtree, with the byte range of the attribute that carries it. */
function editAttributes(root: Element): Array<[string, { startOffset: number; endOffset: number }]> {
	const out: Array<[string, { startOffset: number; endOffset: number }]> = [];
	for (const element of [root, ...findAll(root, () => true)]) {
		const name = attributeValue(element, "data-edit");
		const spot = element.sourceCodeLocation?.attrs?.["data-edit"];
		if (name !== undefined && spot) out.push([name, spot]);
	}
	return out;
}

// --- new components ----------------------------------------------------------------

/**
 * The markup a palette tool inserts. Formatted as a person would write it.
 *
 * `edit` names the run of text it writes, so a component inserted from the palette is
 * retypeable the moment it exists. Without it the first thing a user does with a new
 * sticky — double-click the placeholder and type — would do nothing, and they would
 * have no way to find out why.
 */
function render(patch: Extract<BoardPatch, { op: "insert" }>, indent: string, edit: string): string {
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
			return `${indent}<section class="card" data-id="${id}"${extra} style="${style}">\n${indent}\t<h3 data-edit="${edit}">${body}</h3>\n${indent}</section>`;
		case "sticky":
			return `${indent}<div class="sticky" data-id="${id}" data-edit="${edit}"${extra} style="${style}">${body}</div>`;
		case "text":
			return `${indent}<div class="text" data-id="${id}" data-edit="${edit}"${extra} style="${style}">${body}</div>`;
		case "image":
		case "embed":
			return `${indent}<div class="embed" data-id="${id}" data-embed="${embed ?? ""}"${extra} style="${style}"></div>`;
		default:
			throw new PatchRefused(`cannot insert a ${kind}`);
	}
}

function defaultText(kind: ComponentKind): string {
	switch (kind) {
		case "sticky":
			return "…";
		case "card":
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

/** Every element matching, unlike `find` — because "how many" is the question sometimes. */
function findAll(node: Node, predicate: (node: Element) => boolean): Element[] {
	const out: Element[] = [];
	for (const child of (node as { childNodes?: Node[] }).childNodes ?? []) {
		const element = child as Element;
		if (element.tagName && predicate(element)) out.push(element);
		out.push(...findAll(child, predicate));
	}
	return out;
}

const hasAttribute = (element: Element, name: string, value: string) =>
	element.attrs?.some((attribute) => attribute.name === name && attribute.value === value) ?? false;

function findById(node: Node, id: string): Element | undefined {
	return find(node, (element) => hasAttribute(element, "data-id", id));
}

/** Every element carrying this `data-edit`. More than one is a refusal, not a choice. */
function findByEdit(node: Node, edit: string): Element[] {
	return findAll(node, (element) => hasAttribute(element, "data-edit", edit));
}

/**
 * The component an editable run belongs to: the nearest ancestor with a `data-id`.
 *
 * A run may *be* the component — a `[data-md]` component's editable is its whole source —
 * so the element itself counts. Nothing here checks that the component is a child of
 * the body: the browser decides what it lets a user select, and a file this walks is
 * the file an agent wrote, so a stricter rule here would only produce a refusal whose
 * cause is invisible in the markup.
 */
function componentOf(element: Element): Element | undefined {
	let cursor: Element | undefined = element;
	// Stops at the document, which has no tag and no attributes: an editable run outside
	// every component walks all the way out rather than reading `attrs` off a node that
	// has none.
	while (cursor?.tagName) {
		if (attributeValue(cursor, "data-id") !== undefined) return cursor;
		cursor = (cursor.parentNode as Element | undefined) ?? undefined;
	}
	return undefined;
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

/**
 * The two characters that are not text, and only those two.
 *
 * A serialiser escapes `>` as well, and this used to. It cost the file the thing it is
 * for: a Mermaid source is `A --> B` on every line, and retyping one line of a diagram
 * rewrote all of them as `--&gt;`, so the diff was the whole component and what the
 * agent read back no longer looked like the diagram it wrote. A bare `>` in a text node
 * is not special to the HTML tokenizer — only `&` and `<` start something — so escaping
 * it bought nothing and spent that.
 */
function escapeText(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
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
