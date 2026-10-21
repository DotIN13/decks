import { PenError, walk, type PenDocument, type PenNode } from "@decks/pen";
import { referenceFor, resolveReference, urlFor } from "../deck/layout.ts";

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
/** What a refused board item is held as, in memory only. */
export const REFUSED_ITEM = "decks.board.refused";

interface Meta {
	type?: unknown;
	path?: unknown;
	url?: unknown;
	why?: unknown;
	[key: string]: unknown;
}

const metaOf = (node: PenNode): Meta | undefined => (node.metadata && typeof node.metadata === "object" ? (node.metadata as Meta) : undefined);

/** A drawing read from disk, each board named by its deck path. Changes `doc` in place and answers it. */
export function toMemory(name: string, doc: PenDocument): PenDocument {
	for (const node of walk(doc.children)) {
		const meta = metaOf(node);
		if (node.type !== "browser" || meta?.type !== BOARD_ITEM || typeof meta.path !== "string") continue;
		const resolved = resolveReference(name, meta.path);
		if ("path" in resolved) {
			node.metadata = { ...meta, type: BOARD_ITEM, path: resolved.path };
			continue;
		}
		node.metadata = { ...meta, type: REFUSED_ITEM, url: node.url, why: resolved.refused };
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
			const { why: _why, url, ...rest } = meta;
			node.metadata = { ...rest, type: BOARD_ITEM };
			if (typeof url === "string") node.url = url;
			else delete node.url;
			continue;
		}
		if (node.type !== "browser" || meta?.type !== BOARD_ITEM || typeof meta.path !== "string") continue;
		let reference = referenceFor(name, meta.path);
		if ("refused" in reference) {
			if (!adopt) throw new PenError(`${meta.path} cannot be placed on ${name}: ${reference.refused}.`);
			const copied = adopt.board(name, meta.path);
			reference = referenceFor(name, copied);
			if ("refused" in reference) throw new PenError(`${meta.path} cannot be placed on ${name}: ${reference.refused}.`);
		}
		node.metadata = { ...meta, type: BOARD_ITEM, path: reference.path };
		node.url = urlFor(name, reference.path);
	}
	if (adopt?.frame) for (const ref of frameRefsOf(out)) adopt.frame(name, ref);
	return out;
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
