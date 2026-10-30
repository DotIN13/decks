import { baseTheme, placements, type PenDocument } from "@decks/pen";

/** A box on the canvas, in canvas units. */
export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** A top-level item of a drawing as placed: its box, and, for a card, document, app or board, what it names. */
export interface PlacedItem {
	id: string;
	box: Box;
	name?: string;
	/** Its tag (`decks.card`, `decks.board`, `decks.document`, `decks.app`), when it has one. */
	type?: string;
	/** The file a card or board names. */
	path?: string;
}

/**
 * The drawing's top-level items, each with the box it is drawn in (`placements`, laid out in `look`).
 * One reading of the boxes for everything that frames, fits or lists what is on a canvas.
 */
export function placedItems(doc: PenDocument, look: "light" | "dark" = "light"): PlacedItem[] {
	const placed = placements(doc, { theme: baseTheme(doc, look) });
	const out: PlacedItem[] = [];
	for (const node of (doc.children ?? []) as unknown as Array<{ id?: string; name?: string; metadata?: { path?: unknown; type?: unknown } }>) {
		const box = node.id ? placed.get(node.id)?.box : undefined;
		if (!node.id || !box || box.w <= 0 || box.h <= 0) continue;
		out.push({
			id: node.id,
			box: { x: box.x, y: box.y, w: box.w, h: box.h },
			...(typeof node.name === "string" ? { name: node.name } : {}),
			...(typeof node.metadata?.type === "string" ? { type: node.metadata.type } : {}),
			...(typeof node.metadata?.path === "string" ? { path: node.metadata.path } : {}),
		});
	}
	return out;
}

/** The boxes of a drawing's top-level items: what a fit frames. */
export const topBoxes = (doc: PenDocument, look: "light" | "dark" = "light"): Box[] => placedItems(doc, look).map((item) => item.box);

/** The cards and boards a drawing places, by the file each names. */
export const pageItems = (doc: PenDocument, look: "light" | "dark" = "light"): PlacedItem[] =>
	placedItems(doc, look).filter((item) => item.path && (item.type === "decks.card" || item.type === "decks.board"));
