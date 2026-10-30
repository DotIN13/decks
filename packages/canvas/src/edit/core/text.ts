/**
 * The words typed on the stage, decided with no page under it: how an item's words are set for
 * the editor laid over them (`textLook`, `cardLook`), what an item is part of that opens for typing
 * (a shape, a card, a file), how wide a card's words are, and what putting the typing away writes
 * (`commitOf`, `cancelOps`, `legacyCard`).
 *
 * The page's half is `dom/TextEditing.tsx`: the editor laid over the item, the typed words drawn as
 * they are typed, the still copy left where the editor was, and a card saved block by block.
 */
import { baseTheme, CARD, color, fillsOf, indexOf, isCard, isMarkdown, isMarkdownText, isShape, NOTE_PAD, textStyleOf, type Op, type PenDocument, type PenNode, type Placed } from "@decks/pen";
import { isFile } from "../../model/file-kinds.ts";
import type { Pt, Rect } from "./model.ts";

/** How a drawn item's words are set, for the editor that types over them (`textLook`). */
export interface TextLook {
	font: string;
	size: number;
	weight: number;
	italic: boolean;
	spacing: number;
	/** A multiple of the size; unset is the font's own. */
	line?: number;
	align: string;
	/** Between the item's edge and its words: a note's padding, none for a text. */
	pad: number;
	ink: string;
	/** A note's colour, drawn under the editor when its words outgrow the note. */
	paper?: string;
	/** A text that grows as wide as its words, or a box of fixed width that grows down. */
	grows: "wide" | "tall";
	/** A card: its words are markdown, typed as markdown and drawn as it reads. */
	markdown?: boolean;
}

/**
 * What is being typed into. A card (`card`) is a frame of items typed into as one piece of markdown
 * (`pen/card-frame.ts`); a note card from before (`legacy`) becomes such a frame when it is saved.
 * `fresh` is an item just made to be typed into, which an empty text does not outlive.
 */
export type TextSession = {
	id: string;
	box: Rect;
	value: string;
	style: TextLook;
	fresh?: boolean;
	kind?: string;
	card?: true;
	legacy?: true;
	held?: Record<string, string>;
	insertAt?: number;
	caretAt?: Pt;
};

/** The colours of the app's own words and paper, in the scheme now (`pen/look.ts`, `CARD_PALETTE`). */
export type Palette = { paper: string; fg: string };
/** The font the page sets a family in, at a weight and a style (`pen/look.ts`, `pageFont`). */
export type FontOf = (family: string, weight: number, italic: boolean) => string;
export type Scheme = "light" | "dark";

const EMPTY: PenDocument = { version: "", children: [] };
const NOTE_PAPER: Record<string, string> = { note: "#fde68a", prompt: "#ddd6fe", context: "#bfdbfe" };
const cssOf = (rgba: ReturnType<typeof color>) => (rgba ? `rgba(${Math.round(rgba[0] * 255)}, ${Math.round(rgba[1] * 255)}, ${Math.round(rgba[2] * 255)}, ${rgba[3]})` : undefined);
const firstColourOf = (node: PenNode) => fillsOf(node.fill).map((f) => (typeof f === "string" ? f : f && f.type === "color" ? (f as { color: string }).color : undefined)).find(Boolean);

/**
 * How the canvas sets an item's words (`pen/paint.ts`, `paintText`), for the editor that types
 * over them: the same font, size, weight, spacing, line height, padding and colour, so the words do
 * not move when the editor opens or closes. The canvas keeps drawing the item — its paper, its
 * shadow, its card — and leaves out only the words while they are the editor's (`muteText`).
 */
export function textLook(given: PenDocument | undefined, node: PenNode, placed: Placed | undefined, scheme: Scheme, palette: Palette, font: FontOf): TextLook {
	const doc = given ?? EMPTY;
	const theme = placed?.theme ?? baseTheme(doc, scheme);
	const style = textStyleOf(doc, node, theme);
	const firstColour = firstColourOf(node);
	const card = node.type !== "text";
	const paper = card ? (cssOf(firstColour ? color(doc, firstColour, theme) : undefined) ?? (isMarkdown(node) ? palette.paper : (NOTE_PAPER[node.type] ?? NOTE_PAPER.note!))) : undefined;
	// A card's words are the app's own colour, light or dark; a sticky note's are dark on its colour.
	const ink = isMarkdown(node) ? palette.fg : card ? "#1f2328" : (cssOf(firstColour ? color(doc, firstColour, theme) : undefined) ?? (scheme === "dark" ? "#e6e6e6" : "#1f2328"));
	return {
		font: font(style.fontFamily, style.fontWeight, style.fontStyle === "italic"),
		size: style.fontSize,
		weight: style.fontWeight,
		italic: style.fontStyle === "italic",
		spacing: style.letterSpacing,
		// Skia's line height, left unset, is the font's own: CSS's "normal".
		line: style.lineHeight,
		align: node.textAlign ?? "left",
		pad: card ? NOTE_PAD : 0,
		ink,
		...(paper ? { paper } : {}),
		grows: node.type === "text" ? ((node.textGrowth ?? "auto") === "auto" ? "wide" : "tall") : "tall",
		...(isMarkdown(node) || isMarkdownText(node) ? { markdown: true } : {}),
	};
}

/** A card's words, its padding and its paper, for the editor laid over it: its first text block's look, on the card. */
export function cardLook(given: PenDocument | undefined, card: PenNode, scheme: Scheme, palette: Palette, font: FontOf, cardPad: number): TextLook {
	const block = (card.children ?? []).find((child) => child.type === "text");
	const look = textLook(given, block ?? ({ type: "text", id: "", content: "" } as PenNode), undefined, scheme, palette, font);
	const doc = given ?? EMPTY;
	const firstColour = firstColourOf(card);
	const rgba = firstColour ? color(doc, firstColour, baseTheme(doc, scheme)) : undefined;
	const paper = rgba ? `rgba(${Math.round(rgba[0] * 255)}, ${Math.round(rgba[1] * 255)}, ${Math.round(rgba[2] * 255)}, ${rgba[3]})` : palette.paper;
	return { ...look, pad: typeof card.padding === "number" ? card.padding : cardPad, ink: palette.fg, paper, align: "left", grows: "tall", markdown: true };
}

/** The shape an item is, or is part of (its outline or its words): the frame, by id. */
export function shapeOf(doc: PenDocument | undefined, id: string): string | undefined {
	if (!doc) return undefined;
	const found = indexOf(doc).get(id);
	if (!found) return undefined;
	if (isShape(found.node)) return found.node.id;
	return isShape(found.parent) ? found.parent!.id : undefined;
}

/** The card an item is a block of, if it is one. */
export function cardOf(doc: PenDocument | undefined, id: string): PenNode | undefined {
	const parent = doc ? indexOf(doc).get(id)?.parent : undefined;
	return parent && isCard(parent) ? parent : undefined;
}

/** The item itself or the nearest one round it that `is` says yes to: a file's chip from its icon or its name. */
export function enclosing(doc: PenDocument | undefined, id: string, is: (node: PenNode) => boolean): PenNode | undefined {
	const index = doc ? indexOf(doc) : undefined;
	let found: PenNode | undefined;
	for (let at = index?.get(id); at && !found; at = at.parent ? index?.get(at.parent.id) : undefined) if (is(at.node)) found = at.node;
	return found;
}

/** A file's chip, or anything inside it (a file card's picture, tile, name), that has a path to open. */
export function fileOf(doc: PenDocument | undefined, id: string): (PenNode & { metadata: { path: string } }) | undefined {
	const file = enclosing(doc, id, isFile);
	return file && typeof file.metadata?.path === "string" ? (file as PenNode & { metadata: { path: string } }) : undefined;
}

/** Where the words a shape gets are typed, before it has them: centred and as wide as the shape, less 10 each side. */
export function labelBox(shape: Rect): Rect {
	return { x: shape.x + 10, y: shape.y + shape.h / 2 - 10, w: Math.max(20, shape.w - 20), h: 20 };
}

/** How wide a card's words are: its width (as placed, else as written, else 320) less its padding, at least 40. */
export function cardInner(card: PenNode, placedWidth: number | undefined, cardPad: number): number {
	const width = placedWidth ?? (typeof card.width === "number" ? card.width : 320);
	const pad = typeof card.padding === "number" ? card.padding : cardPad;
	return Math.max(40, width - pad * 2);
}

/** The pictures a card's markdown shows, by the address written: `![…](url)` and `![[name.png]]`. */
export function pictureUrls(markdown: string): string[] {
	return [...markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)|!\[\[([^\]|]+\.(?:png|jpe?g|gif|webp|svg|avif|bmp))(?:\|[^\]]*)?\]\]/gi)].map((m) => (m[1] ?? m[2])!);
}

/** A plain text item with no words is invisible, so a fresh one left empty goes; a note or a card is a shape you can see, and is kept. */
export const emptyVanishes = (open: { kind?: string | undefined; card?: true | undefined }) => !open.card && open.kind === "text";

/** What Escape on the typing writes: a fresh text, never typed into, goes. */
export function cancelOps(open: TextSession | undefined): Op[] {
	return open?.fresh && emptyVanishes(open) ? [{ op: "delete", id: open.id }] : [];
}

/**
 * What Escape does with the words typed: an item a tool has just made (`fresh`) keeps them, as
 * clicking away does, since there is nothing from before to go back to and a note typed into and
 * left with Escape used to be left empty; any other item's words go back as they were.
 */
export const escapeKeeps = (open: TextSession | undefined): boolean => !!open?.fresh;

/**
 * What putting the typing away does with `value`, the words as typed, against `was`, the item's
 * words as the server has them:
 * - `close`: nothing can be written (no typing open, or a drawing that is read-only here);
 * - `vanish`: a text made to be typed into and left empty, deleted;
 * - `unchanged`: the words are as they were;
 * - `update`: a text's or a note's words written;
 * - `card`: a card (or a note card from before) saved as edits to its blocks, by the page.
 */
export type Commit = { do: "close" } | { do: "vanish"; ops: Op[] } | { do: "unchanged" } | { do: "update"; ops: Op[] } | { do: "card" };
export function commitOf(open: TextSession | undefined, value: string, was: string | undefined, editable: boolean): Commit {
	if (!open || !editable) return { do: "close" };
	// A text made by a tool and left empty was never wanted: with no words it is nothing on the canvas. A note or a card stays, empty, where it was put.
	if (open.fresh && !value.trim() && emptyVanishes(open)) return { do: "vanish", ops: [{ op: "delete", id: open.id }] };
	if (value === was) return { do: "unchanged" };
	if (!open.card && !open.legacy) return { do: "update", ops: [{ op: "update", id: open.id, set: { content: value } }] };
	return { do: "card" };
}

/** A note card from before, as the card frame it becomes when it is saved, in its place and with its fill: its blocks are the page's to fill in. */
export function legacyCard(base: PenNode, sizes: { gap: number; pad: number; radius: number }): PenNode {
	return {
		type: "frame",
		id: base.id,
		name: base.name ?? "Card",
		...(base.x !== undefined ? { x: base.x } : {}),
		...(base.y !== undefined ? { y: base.y } : {}),
		width: typeof base.width === "number" ? base.width : 320,
		layout: "vertical",
		gap: sizes.gap,
		padding: sizes.pad,
		cornerRadius: sizes.radius,
		...(base.fill ? { fill: base.fill } : {}),
		metadata: { type: CARD },
		children: [],
	} as PenNode;
}
