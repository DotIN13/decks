import type { Caller } from "../../protocol/index.ts";
import { defineFeature, type Feature, type Item, type Kernel, type PenNode } from "../kernel/types.ts";
import { toDeckPath } from "../kernel/types.ts";

// What the call tests share: a small deck, and two kinds another feature might
// register: "sticker" (a page with a file) and "leaf" (an older page kind).

export const NOTE = (id: string, x: number, y: number, content = id) => ({ type: "note", id, content, x, y, width: 200, height: 100 });
export const pen = (children: unknown[]) => `${JSON.stringify({ version: "2.14", children }, null, 2)}\n`;

export const DECK = {
	"canvases/plan/canvas.pen": pen([NOTE("a", 0, 0), NOTE("b", 360, 0)]),
	"canvases/plan/canvas.json": JSON.stringify({ title: "The plan" }),
	"canvases/plan/stickers/s1/index.html": "<p>sticker</p>",
	"canvases/plan/stickers/s2/index.html": "<p>second</p>",
	"canvases/other/canvas.pen": pen([]),
};

export function stickerFeature(): Feature {
	let deck: Kernel["deck"] | undefined;
	const prepare = async (item: Item, at: { canvas: string; caller: Caller }): Promise<Item> => {
		if (item.title === "sized") return { ...item, path: "canvases/plan/stickers/s2/index.html", box: { x1: 0, y1: 0, x2: 300, y2: 200 } };
		if (item.path || !item.title) return item;
		const path = `canvases/${at.canvas}/stickers/${item.title.replace(/ /g, "-")}/index.html`;
		await deck!.write(toDeckPath(path), new TextEncoder().encode(`<p>${item.title}</p>`), at.caller);
		return { ...item, path };
	};
	return defineFeature({
		name: "stickers",
		calls: [],
		start: (kernel) => void (deck = kernel.deck),
		items: [{
			prepare,
			type: "sticker",
			fromPen: (node: PenNode, at) => ({ type: "sticker", id: node.id, path: `canvases/${at?.canvas}/${(node.metadata as { path: string }).path}` }) as Item,
			toPen: (item: Item, at) => ({ type: "browser", ...(item.id ? { id: item.id } : {}), width: 300, height: 200, metadata: { type: "decks.sticker", path: item.path!.replace(`canvases/${at?.canvas}/`, "") } }),
			files: (item: Item) => [toDeckPath(item.path!)],
		}],
	});
}

/** An older page kind: a browser node tagged decks.leaf, answered as { type: leaf, file }. */
export function leafFeature(): Feature {
	return defineFeature({
		name: "leaves",
		calls: [],
		items: [{
			type: "leaf",
			fromPen: (node: PenNode) => ({ type: "leaf", id: node.id, file: (node.metadata as { path: string }).path }) as Item,
			toPen: (item: Item) => ({ type: "browser", ...(item.id ? { id: item.id } : {}), width: 400, height: 300, metadata: { type: "decks.leaf", path: (item as { file?: string }).file } }),
		}],
	});
}
