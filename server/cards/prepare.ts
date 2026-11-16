import { deckFiles, layout, Refused, type Caller } from "../../protocol/index.ts";
import type { Deck, Item, ItemKind } from "../kernel/types.ts";
import { freeCard, slug, titleOf } from "./cards.ts";
import { fence } from "./fence.ts";
import { cardKind } from "./item.ts";

// Rules 16 and 17: a card given as html is written before it is placed, and a
// card placed with no size takes the size its own file declares.

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const DEFAULT_W = 1000;
export const DEFAULT_H = 600;

/** The card's file with its meta tag saying w and h, what else it says kept; a tag is added when it has none. */
export function withSize(source: string, size: { w: number; h: number }): string {
	const meta = deckFiles.cardMeta(source);
	if (!meta) return `<meta name="card" content='${JSON.stringify(size)}' />\n${source}`;
	return source.replace(meta.tag, `<meta name="${meta.name}" content='${JSON.stringify({ ...meta.given, w: size.w, h: size.h })}' />`);
}

const num = (value: unknown): number | undefined => (typeof value === "number" && value > 0 ? value : undefined);

/** Write a card given as html into a folder of the canvas no card has yet; answer its path. */
async function writeHtml(deck: Deck, canvas: string, item: Item, caller: Caller): Promise<string> {
	const html = String(item.html);
	const title = (typeof item.title === "string" && item.title.trim()) || titleOf("card/x", html);
	const folder = layout.canvasFolder(canvas);
	const path = await freeCard(deck, folder, slug(title));
	const source = /<title[\s>]/i.test(html) ? html : `<title>${title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</title>\n${html}`;
	await deck.write(path, encoder.encode(source), caller);
	return path;
}

/** A card named by its folder or index.html, from the deck's root or the canvas's folder, as its index.html. */
function asCardPath(card: string, canvas: string): string {
	const asDeck = layout.cardIndex(card);
	if (asDeck) return asDeck;
	const resolved = layout.resolveReference(canvas, card);
	return ("path" in resolved && layout.cardIndex(resolved.path)) || card;
}

/** A card item made ready to place: written when given as html, sized from its file when it has no box. */
export async function prepareCard(deck: Deck, item: Item, at: { canvas: string; caller: Caller }): Promise<Item> {
	const { html, width, height, ...rest } = item as Item & { width?: unknown; height?: unknown };
	let card = typeof item.card === "string" ? item.card : undefined;
	if (typeof html === "string") card = await writeHtml(deck, at.canvas, item, at.caller);
	if (!card) throw new Refused("invalid", "A card item names its card ({ type: card, card: <path> }) or gives its html.", "card.create");
	const path = asCardPath(card, at.canvas);
	if (item.box) return { ...rest, card: path };
	const source = await deck.read(fence(path)).then((b) => decoder.decode(b), () => "");
	const meta = deckFiles.cardMeta(source);
	const w = num(width) ?? meta?.w ?? DEFAULT_W;
	const h = num(height) ?? meta?.h ?? DEFAULT_H;
	return { ...rest, card: path, ...(source && !item.title ? { title: titleOf(path, source) } : {}), box: { x1: 0, y1: 0, x2: w, y2: h } };
}

/** The card kind, able to prepare once the feature has its deck. */
export function cardKindWith(deck: () => Deck | undefined): ItemKind {
	return {
		...cardKind,
		async prepare(item, at) {
			const given = at.deck ?? deck();
			if (!given) throw new Refused("unavailable", "Cards have not started yet.", "card.list");
			return prepareCard(given, item, at);
		},
	};
}
