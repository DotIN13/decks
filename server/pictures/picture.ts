import { createHash } from "node:crypto";
import { layout, PICTURE_LADDER, Refused } from "../../protocol/index.ts";
import { toDeckPath, type Context, type DeckPath, type Route, type RouteAnswer } from "../kernel/index.ts";
import { ASTC_TYPE, compress, encoder, LEVELS } from "./astc.ts";
import type { Machine } from "./machine.ts";

// A card's picture for the canvas at /pictures/ (rule 11): its page at a rung of
// the canvas's ladder, kept in the store, and compressed for the GPU when asked.

export const PICTURES = "/pictures/";
/** The canvas's ladder: the widths it asks a card's picture at, from the protocol. */
export const LADDER: readonly number[] = PICTURE_LADDER;
/** The widest picture an export or a screenshot draws a card from. */
const WIDEST = 2000;

export const pictureRoute = (m: () => Machine): Route => ({ method: "GET", prefix: PICTURES, answer: (ctx, path, query) => answer(ctx, m(), path, query) });

async function answer(ctx: Context, m: Machine, path: string, query: URLSearchParams): Promise<RouteAnswer> {
	try {
		const card = decodeURIComponent(path.slice(PICTURES.length));
		const asked = Number(query.get("w") ?? 480);
		const scheme = query.get("scheme") === "dark" ? "dark" : "light";
		const bytes = await cardPicture(ctx, m, card, Number.isFinite(asked) && asked > 0 ? asked : 480, scheme);
		const cache = query.has("v") ? "private, max-age=31536000, immutable" : "no-cache";
		const packed = query.get("astc") === "1" ? await compressedPicture(ctx, m, bytes).catch(() => undefined) : undefined;
		if (packed) return { type: ASTC_TYPE, body: packed, headers: { "cache-control": cache } };
		return { type: "image/jpeg", body: bytes, headers: { "cache-control": cache } };
	} catch (error) {
		if (!(error instanceof Refused)) return { status: 503, type: "text/plain", body: (error as Error).message };
		return { status: error.code === "not_found" ? 404 : error.code === "unavailable" ? 503 : 400, type: "text/plain", body: error.message };
	}
}

/** The page's picture as JPEG bytes, taken once per version, rung and scheme. */
export async function cardPicture(ctx: Context, m: Machine, card: string, asked: number, scheme: "light" | "dark", exact = false): Promise<Uint8Array> {
	const path = picturedPath(card);
	const source = await ctx.deck.read(path).catch(() => {
		throw new Refused("not_found", `There is no page at ${path}.`, "file.find");
	});
	const rung = exact ? exactWidth(asked) : rungFor(asked);
	const key = `${createHash("sha256").update(source).digest("hex").slice(0, 24)}-${rung}-${scheme}.jpg`;
	const kept = await ctx.store.get(key);
	if (kept) return kept;
	const width = metaWidth(new TextDecoder().decode(source));
	const canvas = layout.canvasOfPath(path)?.name ?? "";
	const page = m.cardPage(path, canvas);
	const tab = await m.browser.page({ width, height: Math.round(width * 0.72), scale: rung / width, scheme });
	try {
		await tab.goto(page.url);
		// The card's own width, so the picture is exactly the rung; what spills sideways is cut.
		const tall = Math.max(1, Math.ceil(Number(await tab.evaluate("document.documentElement.scrollHeight")) || width * 0.72));
		const bytes = await tab.screenshot({ type: "jpeg", full: true, clip: { x: 0, y: 0, width, height: tall } });
		await ctx.store.put(key, bytes);
		return bytes;
	} finally {
		await tab.close();
		page.done();
	}
}

/** The picture compressed for the GPU, kept beside it; undefined when this machine has no encoder. */
export async function compressedPicture(ctx: Context, m: Machine, jpeg: Uint8Array, encode = encoder()): Promise<Uint8Array | undefined> {
	if (!encode) return undefined;
	const key = `${createHash("sha256").update(jpeg).digest("hex").slice(0, 24)}.astc`;
	const kept = await ctx.store.get(key);
	if (kept) return kept;
	const tab = await m.browser.page({ width: 16, height: 16, scale: 1, scheme: "light" });
	try {
		const made = await tab.evaluate<{ width: number; height: number; b64: string }[]>(`(${LEVELS})(${JSON.stringify(Buffer.from(jpeg).toString("base64"))})`);
		const levels = made.map((one) => ({ width: one.width, height: one.height, rgba: new Uint8Array(Buffer.from(one.b64, "base64")) }));
		const packed = await compress(levels, encode);
		await ctx.store.put(key, packed);
		return packed;
	} finally {
		await tab.close();
	}
}

/** A card by its folder or index.html, or any other .html page in the deck, kept from before cards. */
export function picturedPath(raw: string): DeckPath {
	const trimmed = raw.replace(/\/+$/, "");
	if (/\.html?$/i.test(trimmed) && !/\/index\.html$/i.test(trimmed)) return toDeckPath(trimmed);
	return cardPath(trimmed);
}

/** A card named by its folder or its index.html, as its index.html. */
export function cardPath(raw: string): DeckPath {
	const trimmed = raw.replace(/\/+$/, "");
	const index = /\/index\.html$/i.test(trimmed) ? trimmed : `${trimmed}/index.html`;
	if (!layout.isCardPath(index)) throw new Refused("invalid", `${raw} is not a card: a card is canvases/<canvas>/cards/<name>/index.html.`, "card.list");
	return toDeckPath(index);
}

/** The width a card asks for in its meta tag, else 1000. */
export function metaWidth(source: string): number {
	const content = /<meta\s+name=["']card["']\s+content='(\{[^']*)'/i.exec(source)?.[1];
	try {
		const w = (JSON.parse(content ?? "{}") as { w?: unknown }).w;
		return typeof w === "number" && w > 0 ? w : 1000;
	} catch {
		return 1000;
	}
}

/** The rung for a width the canvas asks: a rung of its ladder exactly, else the next one up, never past the top. */
export const rungFor = (asked: number): number => (LADDER.includes(asked) ? asked : (LADDER.find((rung) => rung >= asked) ?? LADDER.at(-1)!));

/** The width a screenshot or an export draws a card at: what it needs, in whole pixels, at most WIDEST. */
export const exactWidth = (px: number): number => Math.max(1, Math.min(WIDEST, Math.ceil(px)));

