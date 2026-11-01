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

type TopNode = { id?: string; type?: string; x?: unknown; y?: unknown; width?: unknown; height?: unknown; rotation?: unknown };

const sized = (n: TopNode) => typeof n.x === "number" && typeof n.y === "number" && typeof n.width === "number" && n.width > 0 && typeof n.height === "number" && n.height > 0 && !n.rotation;

/**
 * Each top-level item's box, by id. A top-level item with a number for its place and size sits in
 * that box: nothing lays it out, since the top level has no layout of its own. Only the items sized
 * by their content (a text that grows, a frame that fits) are laid out, and those alone: laying the
 * whole drawing out for every change cost 10 to 20 ms of a drag on 2,000 items, for boxes already
 * written on the items.
 */
export function topBoxMap(doc: PenDocument, look: "light" | "dark" = "light", options?: { layout?: boolean }): Map<string, Box> {
	const out = new Map<string, Box>();
	const needy: TopNode[] = [];
	for (const node of (doc.children ?? []) as unknown as TopNode[]) {
		if (!node.id) continue;
		if (sized(node)) out.set(node.id, { x: node.x as number, y: node.y as number, w: node.width as number, h: node.height as number });
		else needy.push(node);
	}
	// `layout: false`: a list that needs no sizes gets a content-sized item's place with no size, and lays nothing out.
	if (needy.length && options?.layout === false) {
		for (const node of needy) out.set(node.id!, { x: typeof node.x === "number" ? node.x : 0, y: typeof node.y === "number" ? node.y : 0, w: 0, h: 0 });
	} else if (needy.length) {
		const placed = placements({ ...doc, children: needy as PenDocument["children"] }, { theme: baseTheme(doc, look) });
		for (const node of needy) {
			const box = placed.get(node.id!)?.box;
			if (box) out.set(node.id!, { x: box.x, y: box.y, w: box.w, h: box.h });
		}
	}
	return out;
}

/**
 * The drawing's top-level items, each with the box it is drawn in (`topBoxMap`).
 * One reading of the boxes for everything that frames, fits or lists what is on a canvas.
 */
export function placedItems(doc: PenDocument, look: "light" | "dark" = "light"): PlacedItem[] {
	const placed = topBoxMap(doc, look);
	const out: PlacedItem[] = [];
	for (const node of (doc.children ?? []) as unknown as Array<{ id?: string; name?: string; metadata?: { path?: unknown; type?: unknown } }>) {
		const box = node.id ? placed.get(node.id) : undefined;
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

const isPageNode = (node: { metadata?: { path?: unknown; type?: unknown } }) => typeof node.metadata?.path === "string" && (node.metadata.type === "decks.card" || node.metadata.type === "decks.board");

/**
 * The cards and boards a drawing places, by the file each names. Only they are read, so the notes
 * and frames sized by their content are not laid out for a question about where the cards are.
 */
export const pageItems = (doc: PenDocument, look: "light" | "dark" = "light"): PlacedItem[] =>
	placedItems({ ...doc, children: ((doc.children ?? []) as unknown as Array<{ metadata?: { path?: unknown; type?: unknown } }>).filter(isPageNode) as PenDocument["children"] }, look);
