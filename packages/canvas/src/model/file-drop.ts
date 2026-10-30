import { CARD, MEDIA } from "@decks/pen";
import { cardChildren, CARD_GAP, CARD_PAD, CARD_RADIUS, fileCard, FILE_CARD_W, liveFileItem } from "./card-frame.ts";

/**
 * Files dropped on a canvas, as the items that hold them: pure, the drawing's `insert` ops for what a
 * host has already read and uploaded (its words, its picture's size, its deck path, what the server
 * said a film is). The host keeps the uploads and the asking; this decides what lands, how big and
 * where, so every host that takes a drop (the Decks page, Studio) lands it the same.
 */

/** How wide a dropped picture lands on the stage, at most, in stage pixels. */
export const PICTURE_W = 640;
/** How wide a dropped text file's card is, in stage pixels. */
export const DROP_CARD_W = 480;
/** The gap between items dropped together. */
export const DROP_GAP = 32;
/** A sound has no picture, so it lands as a strip wide enough for a name and a time. */
const SOUND_W = 420;
const SOUND_H = 72;

type Node = Record<string, unknown>;
type Op = Record<string, unknown>;
type Size = { width: number; height: number };
type Point = { x: number; y: number };

/** An item to land: its node, its width, and its height where it has one of its own (a card's grows with its words). */
export interface DroppedItem {
	node: Node;
	w: number;
	h?: number;
}

/** An item with a height of its own. */
export type SizedItem = DroppedItem & { h: number };

/** What the server read of a film or a sound (`files/media.ts`). */
export interface MediaFacts {
	kind: "video" | "audio";
	poster?: string;
	peaks?: number[];
	seconds?: number;
	w?: number;
	h?: number;
}

/** A text file's words as a card: a column of its blocks (`card-frame.ts`), each given its id by the server. */
export function wordsCard(name: string, words: string): DroppedItem {
	const children = cardChildren(words, [], { fresh: () => "", inner: DROP_CARD_W - CARD_PAD * 2 });
	return { node: { type: "frame", name, layout: "vertical", gap: CARD_GAP, padding: CARD_PAD, cornerRadius: CARD_RADIUS, metadata: { type: CARD, file: name }, children }, w: DROP_CARD_W };
}

/** A picture: a rectangle filled with it (`url`, as the drawing reads it), at its own proportions and at most `PICTURE_W` wide. */
export function pictureItem(name: string, url: string, natural: Size): SizedItem {
	const w = Math.min(PICTURE_W, natural.width);
	const h = Math.round((w * natural.height) / Math.max(1, natural.width));
	return { node: { type: "rectangle", name, cornerRadius: 8, fill: { type: "image", url, mode: "fill" } }, w, h };
}

/**
 * A film or a sound: pen's own rectangle, filled with the still the server wrote and marked as media
 * (`@decks/pen`, `MEDIA`). pen.dev opens it as the rectangle it is, showing the poster, which is the
 * right thing to show for something not playing. The canvas draws the still and puts a play badge on
 * it; nothing decodes until it is pressed. `file` is its deck path; `url` makes a drawing's address of one.
 */
export function mediaItem(name: string, file: string, facts: MediaFacts, url: (path: string) => string, natural: Size = { width: 640, height: 360 }): SizedItem {
	const sound = facts.kind === "audio";
	const w = sound ? SOUND_W : Math.min(PICTURE_W, facts.w ?? natural.width);
	const h = sound ? SOUND_H : Math.round((w * (facts.h ?? natural.height)) / Math.max(1, facts.w ?? natural.width));
	return {
		node: {
			type: "rectangle",
			name,
			cornerRadius: 8,
			...(facts.poster ? { fill: { type: "image", url: url(facts.poster), mode: "fill" } } : { fill: "#1f2328" }),
			metadata: { type: MEDIA, kind: facts.kind, file, ...(facts.poster ? { poster: facts.poster } : {}), ...(facts.seconds === undefined ? {} : { seconds: facts.seconds }), ...(facts.peaks ? { peaks: facts.peaks } : {}) },
		},
		w,
		h,
	};
}

/** Items in a row centred on `middle`, a stage point, their tops level with the tallest's; `id` names each. */
export function rowOps(items: readonly DroppedItem[], middle: Point, id: (index: number) => string): Op[] {
	if (items.length === 0) return [];
	const total = items.reduce((sum, item) => sum + item.w, 0) + DROP_GAP * (items.length - 1);
	const tallest = Math.max(...items.map((item) => item.h ?? 240));
	let x = Math.round(middle.x - total / 2);
	const y = Math.round(middle.y - tallest / 2);
	return items.map((item, i) => {
		const box = item.h === undefined ? { x1: x, y1: y, x2: x + item.w } : { x1: x, y1: y, x2: x + item.w, y2: y + item.h };
		x += item.w + DROP_GAP;
		return { op: "insert", node: { ...item.node, id: id(i) }, box };
	});
}

/** One item centred on `middle`. */
export function centredOp(item: SizedItem, middle: Point, id: string): Op {
	const box = { x1: Math.round(middle.x - item.w / 2), y1: Math.round(middle.y - item.h / 2), x2: Math.round(middle.x + item.w / 2), y2: Math.round(middle.y + item.h / 2) };
	return { op: "insert", node: { ...item.node, id }, box };
}

/** A deck file's preview as the server describes it (`/api/where`). */
export interface FilePreview {
	preview: string;
	w: number;
	h: number;
	pages?: number;
	title?: string;
}

/** SVGs shown live on the canvas (`liveFileItem`), in a row from `middle`, each with the still the server made of it. */
export function liveFileOps(files: ReadonlyArray<{ path: string; preview?: FilePreview }>, middle: Point, fresh: () => string, url: (path: string) => string): Op[] {
	let at = middle.x;
	return files.map(({ path, preview }) => {
		const node = liveFileItem(path, fresh, { ...(preview ? { still: preview.preview, w: preview.w, h: preview.h } : {}), url });
		const w = Number(node.width);
		const op = { op: "insert", node, box: { x1: Math.round(at - w / 2), y1: Math.round(middle.y - 200), x2: Math.round(at + w / 2) } };
		at += w + DROP_GAP;
		return op;
	});
}

/**
 * Deck files as file cards (`fileCard`) in a row centred on `middle`: a picture of each where the server
 * made one, its name and kind under it. `path` is as a card's file chip has it (from the canvas's own
 * folder), so a double-click opens it.
 */
export function fileCardOps(files: ReadonlyArray<{ path: string; preview?: FilePreview }>, middle: Point, fresh: () => string, url: (path: string) => string): Op[] {
	const total = files.length * FILE_CARD_W + DROP_GAP * (files.length - 1);
	let x = Math.round(middle.x - total / 2);
	return files.map(({ path, preview }) => {
		const node = fileCard(path, fresh, { ...(preview ?? {}), url });
		const tall = preview ? Math.min(420, (FILE_CARD_W * preview.h) / Math.max(1, preview.w)) + 52 : 52;
		const op = { op: "insert", node, box: { x1: x, y1: Math.round(middle.y - tall / 2), x2: x + FILE_CARD_W } };
		x += FILE_CARD_W + DROP_GAP;
		return op;
	});
}

/** A picture among a card's blocks: as wide as the card's words at most (`inner`), at its own proportions. */
export function cardPicture(name: string, url: string, inner: number, natural: Size | undefined): Node {
	const w = Math.round(Math.min(inner, natural?.width ?? inner));
	const h = Math.round(natural ? (w * natural.height) / Math.max(1, natural.width) : w * 0.5625);
	return { type: "rectangle", name, cornerRadius: 6, width: w, height: h, fill: { type: "image", url, mode: "fill" } };
}
