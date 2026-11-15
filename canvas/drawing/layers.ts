import type { PenDocument } from "@decks/pen";
import { topBoxMap } from "./boxes.ts";

/**
 * The layers list (the Decks page's Canvas tab): the drawing's top-level items, as Studio's editor lists its layers, each with
 * its box; the arrows are one row, since a canvas can have dozens and none has a name.
 */

export type ItemKind = "board" | "note" | "text" | "shape" | "frame" | "ink" | "other";
export type CanvasItem = { id: string; kind: ItemKind; label: string; board?: string; box: { x: number; y: number; w: number; h: number } };

const clip = (text: unknown, fallback: string) => {
	const line = String(text ?? "").split("\n").find((one) => one.trim()) ?? "";
	return line.trim().slice(0, 60) || fallback;
};

/**
 * `boxes: false` lists without laying anything out: an item sized by its content comes with its place
 * and no size, which is enough to list it; ask again with boxes for the one picked, to fly to it.
 */
export function canvasItems(doc: PenDocument | undefined, query = "", options?: { boxes?: boolean }): { items: CanvasItem[]; arrows: string[] } {
	const items: CanvasItem[] = [];
	const arrows: string[] = [];
	if (!doc) return { items, arrows };
	const q = query.trim().toLowerCase();
	const placed = topBoxMap(doc, "light", { layout: options?.boxes !== false });
	for (const n of (doc.children ?? []) as unknown as Record<string, unknown>[]) {
		const id = String(n.id);
		const meta = (n.metadata ?? {}) as { type?: string; path?: string };
		const frame = placed.get(id);
		const box = frame ? { x: frame.x, y: frame.y, w: frame.w, h: frame.h } : { x: Number(n.x ?? 0), y: Number(n.y ?? 0), w: 0, h: 0 };
		const named = typeof n.name === "string" && n.name.trim() ? n.name.trim() : undefined;
		let item: CanvasItem;
		if (meta.type === "decks.arrow") {
			arrows.push(id);
			continue;
		} else if (meta.type === "decks.document" || meta.type === "decks.app") {
			// A document or an app item: listed with the cards, by its name, its file's or its app's.
			const what = meta.type === "decks.app" ? String((meta as { name?: unknown }).name ?? "App") : String(meta.path ?? "Document").split("/").pop()!;
			item = { id, box, kind: "board", label: named ?? clip(what, "Item"), board: `item:${id}` };
		} else if (meta.type === "decks.board" || meta.type === "decks.card") item = { id, box, kind: "board", label: named ?? clip(meta.type === "decks.card" ? meta.path?.split("/").at(-2) : meta.path?.split("/").pop()?.replace(/\.html$/, ""), meta.type === "decks.card" ? "Card" : "Board"), ...(meta.path ? { board: meta.path } : {}) };
		else if (n.type === "note") item = { id, box, kind: "note", label: named ?? clip(n.content, "Note") };
		else if (n.type === "text") item = { id, box, kind: "text", label: named ?? clip(n.content, "Text") };
		else if (meta.type === "decks.ink" || n.type === "path") item = { id, box, kind: "ink", label: named ?? "Drawing" };
		else if (meta.type === "decks.shape" || n.type === "rectangle" || n.type === "ellipse") {
			const words = ((n.children ?? []) as Record<string, unknown>[]).find((c) => c.type === "text")?.content;
			item = { id, box, kind: "shape", label: named ?? clip(words, "Shape") };
		} else if (n.type === "frame") item = { id, box, kind: "frame", label: named ?? (meta.type === "decks.markdown-card" || meta.type === "decks.card" ? "Card" : "Frame") };
		else item = { id, box, kind: "other", label: named ?? clip(n.type, "Item") };
		if (!q || item.label.toLowerCase().includes(q)) items.push(item);
	}
	return { items, arrows: q ? [] : arrows };
}
