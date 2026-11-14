import { layout } from "../../protocol/index.ts";
import type { DeckPath, Item, ItemKind, PenNode } from "../kernel/types.ts";
import { fence } from "./fence.ts";

// The card as an item kind. Rules 12 and 13 of the README.

const TAG = "decks.card";
const OWN = new Set(["type", "id", "x", "y", "width", "height", "name", "url"]);
const num = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** Whether a pen node is a card. */
export const isCardNode = (node: PenNode): boolean => node.type === "browser" && (node.metadata as { type?: unknown } | undefined)?.type === TAG;

/** A deck path from what the drawing wrote, read from the canvas's folder. */
function fromCanvas(written: string, canvas: string | undefined): string {
	if (!canvas) return written;
	const got = layout.resolveReference(canvas, written);
	return "path" in got ? got.path : written;
}

/** What the drawing writes for a deck path: the path from the canvas's folder. */
function toCanvas(path: string, canvas: string | undefined): string {
	if (!canvas) return path;
	const got = layout.referenceFor(canvas, path);
	return "path" in got ? got.path : path;
}

export const cardKind: ItemKind = {
	type: "card",
	fromPen(node, at) {
		const meta = (node.metadata ?? {}) as { path?: unknown };
		const written = typeof meta.path === "string" ? meta.path : String(node.url ?? "");
		const rest = Object.fromEntries(Object.entries(node).filter(([key]) => !OWN.has(key)));
		const x = num(node.x);
		const y = num(node.y);
		return {
			...rest,
			type: "card",
			...(node.id === undefined ? {} : { id: node.id }),
			card: fromCanvas(written, at?.canvas),
			...(typeof node.name === "string" ? { title: node.name } : {}),
			box: { x1: x, y1: y, x2: x + num(node.width, 600), y2: y + num(node.height, 400) },
		} as Item;
	},
	toPen(item, at) {
		const { type: _type, card, title, box, ...rest } = item;
		const path = toCanvas(String(card ?? ""), at?.canvas);
		const meta = (rest.metadata ?? {}) as Record<string, unknown>;
		const b = box ?? { x1: 0, y1: 0, x2: 600, y2: 400 };
		return {
			type: "browser",
			...(item.id === undefined ? {} : { id: item.id }),
			...(title === undefined ? {} : { name: title }),
			url: path,
			width: b.x2 - b.x1,
			height: b.y2 - b.y1,
			...rest,
			metadata: { ...meta, type: TAG, path },
			x: b.x1,
			y: b.y1,
		};
	},
	files(item): DeckPath[] {
		const card = String(item.card ?? "");
		return layout.isCardPath(card) ? [fence(card.replace(/\/index\.html$/i, ""))] : [];
	},
};

export const CARD_TAG = TAG;
