import { PenError, walk, type PenDocument, type PenNode } from "@decks/pen";
import { posix } from "node:path";
import { canvasFolder, isCardPath, referenceFor, resolveReference, urlFor } from "../deck/layout.ts";

/**
 * A canvas's drawing as it is on disk, and as the harness holds it.
 *
 * On disk a board item names its board from the canvas's own folder (`"boards/plan.html"`), so the
 * folder can be copied anywhere whole (`deck/layout.ts`). Inside the harness every board is named by
 * its deck path (`"canvases/plan/boards/plan.html"`), as every record, picture, route and page always
 * named it. `toMemory` turns the one into the other as a drawing is read, and `toDisk` back as it is
 * written. Nothing else in the harness sees the difference.
 *
 * A reference the rules refuse (another canvas's board, the library, a hidden folder) is held as an
 * item that is no board, with nothing to load, and written back as it was: what a hand edit wrote is
 * not lost, and it is not shown either. A board placed from somewhere else is copied into the canvas
 * as the drawing is written (`adopt`), so a canvas only ever names its own.
 */
export const BOARD_ITEM = "decks.board";
/** A card: a board drawn in a shadow root of the stage's own page (`deck/layout.ts`, `isCardPath`). */
export const CARD_ITEM = "decks.card";
/** Whether a tag is a board's or a card's: both name a page in the canvas's folder by `path`. */
export const isPageTag = (type: unknown): type is string => type === BOARD_ITEM || type === CARD_ITEM;
/** What a refused board item is held as, in memory only. */
export const REFUSED_ITEM = "decks.board.refused";

interface Meta {
	type?: unknown;
	path?: unknown;
	url?: unknown;
	why?: unknown;
	was?: unknown;
	[key: string]: unknown;
}

const metaOf = (node: PenNode): Meta | undefined => (node.metadata && typeof node.metadata === "object" ? (node.metadata as Meta) : undefined);

/** A drawing read from disk, each board named by its deck path. Changes `doc` in place and answers it. */
export function toMemory(name: string, doc: PenDocument): PenDocument {
	for (const node of walk(doc.children)) {
		const meta = metaOf(node);
		if (node.type !== "browser" || !isPageTag(meta?.type) || typeof meta.path !== "string") continue;
		const resolved = resolveReference(name, meta.path);
		if ("path" in resolved) {
			node.metadata = { ...meta, type: meta.type as string, path: resolved.path };
			continue;
		}
		node.metadata = { ...meta, type: REFUSED_ITEM, was: meta.type, url: node.url, why: resolved.refused };
		node.url = "about:blank";
	}
	return doc;
}

/** How a canvas takes in what it was given from elsewhere: a board copied into its folder, and a frame. */
export interface Adopt {
	/** Copy the board at this deck path into the canvas, and answer the deck path of the copy. */
	board(canvas: string, path: string): string;
	/** Copy a saved frame (`frames/<name>`) the drawing uses into the canvas, if it is not there yet. */
	frame?(canvas: string, ref: string): void;
	/**
	 * Copy a deck file a drawn item fills with (a picture dropped into the deck's `assets/`) into the
	 * canvas's `files/`, and answer its path in the canvas's folder; undefined leaves it as it is.
	 */
	file?(canvas: string, deckPath: string): string | undefined;
}

/**
 * A drawing as it is written to disk: a copy, each board named from the canvas's own folder. A board
 * from anywhere else is copied in first (`adopt`); with nothing to copy it, the write is refused.
 */
export function toDisk(name: string, doc: PenDocument, adopt?: Adopt): PenDocument {
	const out = structuredClone(doc);
	for (const node of walk(out.children)) {
		const meta = metaOf(node);
		if (node.type === "browser" && meta?.type === REFUSED_ITEM) {
			const { why: _why, url, was, ...rest } = meta;
			node.metadata = { ...rest, type: isPageTag(was) ? was : BOARD_ITEM };
			if (typeof url === "string") node.url = url;
			else delete node.url;
			continue;
		}
		if (node.type !== "browser" || !isPageTag(meta?.type) || typeof meta.path !== "string") continue;
		let reference = referenceFor(name, meta.path);
		let deckPath = meta.path;
		if ("refused" in reference) {
			if (!adopt) throw new PenError(`${meta.path} cannot be placed on ${name}: ${reference.refused}.`);
			deckPath = adopt.board(name, meta.path);
			reference = referenceFor(name, deckPath);
			if ("refused" in reference) throw new PenError(`${meta.path} cannot be placed on ${name}: ${reference.refused}.`);
		}
		// A board copied in may have landed as a card (`copy-in.ts`): its tag follows its path in the deck.
		node.metadata = { ...meta, type: isCardPath(deckPath) ? CARD_ITEM : (meta.type as string), path: reference.path };
		node.url = urlFor(name, reference.path);
	}
	if (adopt?.frame) for (const ref of frameRefsOf(out)) adopt.frame(name, ref);
	if (adopt?.file) adoptFills(name, out, adopt.file);
	return out;
}

/**
 * Every fill's address that reaches out of the canvas's folder into the deck (`../../assets/a.png`)
 * pointed at the canvas's own copy in `files/`, made now: so the drawing reads the same in any folder
 * it is copied to, a friend's included.
 */
function adoptFills(name: string, doc: PenDocument, file: NonNullable<Adopt["file"]>): void {
	const folder = canvasFolder(name);
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) value.forEach(visit);
		else if (value && typeof value === "object") {
			const record = value as Record<string, unknown>;
			for (const [key, inner] of Object.entries(record)) {
				if (key === "children" || key === "metadata") continue;
				if (key === "url" && typeof inner === "string" && !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(inner)) {
					const target = posix.normalize(posix.join(folder, inner));
					if (target.startsWith("..") || target.startsWith(`${folder}/`)) continue;
					const own = file(name, target);
					if (own) record[key] = own;
				} else if (inner && typeof inner === "object") visit(inner);
			}
		}
	};
	for (const node of walk(doc.children)) if (node.type !== "browser") visit(node);
}

/** The saved frames a drawing places by ref, `frames/<name>`, overrides and all. */
export function frameRefsOf(doc: PenDocument): string[] {
	const found = new Set<string>();
	const scan = (value: unknown): void => {
		if (Array.isArray(value)) value.forEach(scan);
		else if (value && typeof value === "object") {
			const ref = (value as { ref?: unknown }).ref;
			if (typeof ref === "string") {
				const match = /^(frames\/[A-Za-z0-9][\w.-]*(?:\/[A-Za-z0-9][\w.-]*)*)(?::|$)/.exec(ref);
				if (match) found.add(match[1]!);
			}
			for (const inner of Object.values(value)) if (inner && typeof inner === "object") scan(inner);
		}
	};
	scan(doc.children);
	return [...found];
}
