import type { DeckPath, Item, ItemKind } from "../kernel/types.ts";
import { fence } from "./path.ts";

// The document as an item kind. Rule 9: the path is from the deck's root.

const TAG = "decks.document";
const OWN = new Set(["type", "id", "x", "y", "width", "height", "name"]);
const num = (value: unknown, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

export const documentKind: ItemKind = {
	type: "document",
	fromPen(node) {
		const meta = (node.metadata ?? {}) as { path?: unknown };
		const rest = Object.fromEntries(Object.entries(node).filter(([key]) => !OWN.has(key)));
		const x = num(node.x);
		const y = num(node.y);
		return {
			...rest,
			type: "document",
			...(node.id === undefined ? {} : { id: node.id }),
			path: typeof meta.path === "string" ? meta.path : "",
			...(typeof node.name === "string" ? { title: node.name } : {}),
			box: { x1: x, y1: y, x2: x + num(node.width, 800), y2: y + num(node.height, 1000) },
		} as Item;
	},
	toPen(item) {
		const { type: _type, path, title, box, ...rest } = item;
		const b = box ?? { x1: 0, y1: 0, x2: 800, y2: 1000 };
		const meta = (rest.metadata ?? {}) as Record<string, unknown>;
		return {
			type: "browser",
			...(item.id === undefined ? {} : { id: item.id }),
			...(title === undefined ? {} : { name: title }),
			width: b.x2 - b.x1,
			height: b.y2 - b.y1,
			...rest,
			metadata: { ...meta, type: TAG, path: String(path ?? "") },
			x: b.x1,
			y: b.y1,
		};
	},
	files(item): DeckPath[] {
		try {
			return [fence(item.path)];
		} catch {
			return [];
		}
	},
};
