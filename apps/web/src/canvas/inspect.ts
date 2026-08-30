import { BOX_CLASSES, type BoardPatch, type BoxClass } from "@decks/protocol";

/**
 * What the selected component *is*, and what an inspector edit does to it.
 *
 * The board is same-origin (DESIGN §4), so this reads the live document rather than
 * asking the server what it wrote — the same trick the editor is built on, and the
 * reason the inspector needs no protocol of its own. Two halves:
 *
 * 1. **Reading.** `readShape` turns the selected element into a plain description.
 *    Plain rather than a live node, because a signal holding a DOM node from a frame
 *    that may reload is a stale pointer waiting to happen; every write re-queries.
 * 2. **Writing.** An edit becomes a `BoardPatch` (the file is the artifact) *and* a
 *    mutation of the live document (so the change is on screen before the write
 *    lands, which is what lets the frame stay pinned and not flash — §7).
 *
 * The vocabulary is `board.css`'s and `board.js`'s, not this file's: the editor can
 * only offer what the stylesheet already styles and the runtime already reads. A
 * deck's `lib/` is a **copy**, but it is refreshed from this build every time the deck
 * is opened (`deck/lib-sync.ts`), so a class added to `board.css` reaches an existing
 * deck on its next restart rather than never. Adding a row here therefore means
 * adding the CSS in the same commit — not that the vocabulary is fixed. That is the
 * whole answer to "what does appearance mean for a component" —
 * the five interchangeable box classes, `data-tone`, and the two attributes an embed
 * is made of.
 */

/** Which set of rows the inspector draws. */
export type Family = "box" | "embed" | "other";

export interface Shape {
	path: string;
	id: string;
	/** The tag as written, for the line that says what this is. */
	tag: string;
	family: Family;
	/** The box class it currently has, when it has one of the five. */
	box?: BoxClass;
	/** Every class on it, so a swap keeps the ones this build knows nothing about. */
	classes: string[];
	attrs: Record<string, string>;
	/**
	 * Whether `board.js` owns what is inside it — an embed, a `[data-md]` panel, a
	 * diagram. Retyping such a component in place would be editing the *rendered* DOM,
	 * whose shape has nothing to do with the file's.
	 */
	generated: boolean;
}

export type Edit =
	| { kind: "box"; to: BoxClass }
	| { kind: "attr"; name: string; value: string | null }
	| { kind: "rename"; to: string }
	| { kind: "order"; to: "front" | "back" }
	| { kind: "duplicate" }
	| { kind: "remove" };

/** Attributes whose change means `board.js` has to mount the component again. */
const REMOUNT = new Set(["data-embed", "data-pages", "data-mode"]);

/**
 * Which rows the selection gets, from its classes and attributes alone.
 *
 * The tag used to be part of it, because an `<svg>` was a connector by construction.
 * Nothing is decided by the tag now: a hand-drawn diagram is whatever its author
 * classed it, and an agent that gave it a box class means it to have the box rows.
 */
export function familyOf(classes: string[], attrs: Record<string, string>): Family {
	if (attrs["data-embed"] !== undefined || classes.includes("embed")) return "embed";
	if (classes.some((name) => (BOX_CLASSES as readonly string[]).includes(name))) return "box";
	// A `kpi`, a `table`, a `chip`, or something the agent invented: it still has a
	// name, an order and a copy, but its appearance is not a vocabulary we have.
	return "other";
}

/**
 * The class attribute after a swap, keeping every token this build does not own.
 *
 * An agent writes `class="card wide"` and means both halves of it; replacing the
 * whole attribute with `"panel"` would silently drop a rule it wrote its own CSS
 * for. So the box class is substituted in place and everything else stays where it
 * was, in its own order.
 */
export function swapBox(classes: string[], to: BoxClass): string {
	const known = (name: string) => (BOX_CLASSES as readonly string[]).includes(name);
	if (!classes.some(known)) return [to, ...classes].join(" ");
	return classes.map((name) => (known(name) ? to : name)).join(" ");
}

/** The board's document, if that board is mounted and live. */
export function frameOf(path: string): { win: Window; doc: Document } | undefined {
	const frame = document.querySelector(`.board-node[data-path="${cssEscape(path)}"] iframe`) as HTMLIFrameElement | null;
	const doc = frame?.contentDocument;
	const win = frame?.contentWindow;
	return doc && win ? { win, doc } : undefined;
}

export function elementOf(path: string, id: string): HTMLElement | undefined {
	return (frameOf(path)?.doc.querySelector(`[data-id="${cssEscape(id)}"]`) as HTMLElement | null) ?? undefined;
}

export function readShape(path: string, id: string): Shape | undefined {
	const frame = frameOf(path);
	const element = frame?.doc.querySelector(`[data-id="${cssEscape(id)}"]`) as HTMLElement | null;
	if (!frame || !element) return undefined;

	const attrs: Record<string, string> = {};
	for (const attribute of element.attributes) {
		if (attribute.name.startsWith("data-") && attribute.name !== "data-id") attrs[attribute.name] = attribute.value;
	}
	/*
	 * The editor's own classes are not the component's.
	 *
	 * `decks-editing` is the selection outline, added to the element in the board's
	 * document and never meant to be written down (§6.5) — and a class swap sends the
	 * whole attribute, so the first version of this saved
	 * `class="callout decks-editing"` into the file. The overlay leaking into the
	 * artifact is the one thing the affordances are marked for.
	 */
	const classes = [...element.classList].filter((name) => !name.startsWith("decks-"));
	const tag = element.tagName.toLowerCase();
	const family = familyOf(classes, attrs);

	return {
		path,
		id,
		tag,
		family,
		box: classes.find((name) => (BOX_CLASSES as readonly string[]).includes(name)) as BoxClass | undefined,
		classes,
		attrs,
		generated: family === "embed" || "data-md" in attrs || "data-mermaid" in attrs,
	};
}

/** The patch an edit becomes. Declarative, and the same shape a gesture sends (§6.5). */
export function patchesFor(shape: Shape, edit: Edit): BoardPatch[] {
	switch (edit.kind) {
		case "box":
			return [{ op: "update", id: shape.id, class: swapBox(shape.classes, edit.to) }];
		case "attr":
			// An empty field means "no attribute", not `data-pages=""`: the second is a
			// declaration that the PDF has no pages, and board.js reads it as one.
			return [{ op: "update", id: shape.id, attrs: { [edit.name]: edit.value === "" ? null : edit.value } }];
		case "rename":
			return [{ op: "rename", id: shape.id, to: edit.to }];
		case "order":
			return [{ op: "order", id: shape.id, to: edit.to }];
		case "duplicate":
			return [{ op: "duplicate", id: shape.id }];
		case "remove":
			return [{ op: "remove", id: shape.id }];
	}
}

/**
 * The same edit, applied to the live document.
 *
 * Not decoration: the frame is pinned to the revision it loaded so the user's own
 * edit does not reload the board they are working on (§7), and a pinned frame shows
 * whatever the DOM says. An edit that only sent a patch would be invisible until
 * somebody else wrote the file — which is exactly what deleting a component used to
 * be.
 *
 * A duplicate is the exception and returns `false`: its markup exists only in the
 * file, so that one takes the reload.
 */
export function applyLive(shape: Shape, edit: Edit): boolean {
	const frame = frameOf(shape.path);
	const element = elementOf(shape.path, shape.id);
	if (!frame || !element) return false;
	const board = (frame.win as Window & { __board?: { mount?: (host: Element) => void } }).__board;

	switch (edit.kind) {
		case "box":
			// `setAttribute` and not `className`, which on an SVG element is not a string.
			element.setAttribute("class", swapBox(shape.classes, edit.to));
			return true;
		case "attr": {
			if (edit.value === null || edit.value === "") element.removeAttribute(edit.name);
			else element.setAttribute(edit.name, edit.value);
			if (REMOUNT.has(edit.name)) void board?.mount?.(element);
			return true;
		}
		case "rename":
			// Nothing else in the board names it: an id is referred to from outside the
			// component only by the app, never by another component (`board.js`).
			element.dataset.id = edit.to;
			return true;
		case "order":
			if (edit.to === "front") frame.doc.body.appendChild(element);
			else frame.doc.body.insertBefore(element, frame.doc.body.firstElementChild);
			return true;
		case "remove":
			element.remove();
			return true;
		case "duplicate":
			return false;
	}
}

/** Whether a file's extension is one the PDF page-range field applies to. */
export const isPdf = (path: string | undefined) => /\.pdf(\?|#|$)/i.test(path ?? "");

export function cssEscape(value: string): string {
	return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}
