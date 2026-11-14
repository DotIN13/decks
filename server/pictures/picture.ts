import { createHash } from "node:crypto";
import { layout, Refused } from "../../protocol/index.ts";
import type { Context, Route, RouteAnswer } from "../kernel/index.ts";
import { cardPath, type Machine } from "./machine.ts";

// A card's picture for the canvas (rule 11): its page at its own width,
// shrunk to w, kept in the store by the card's bytes, width and scheme.

export const PICTURES = "/pictures/";
const RUNGS = [192, 480, 1000, 2000];

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

/** The rung asked for, rounded up to one the store keeps. */
export const rungFor = (asked: number) => RUNGS.find((rung) => rung >= asked) ?? RUNGS.at(-1)!;

/** The card's picture as PNG bytes, taken once per card version, rung and scheme. */
export async function cardPicture(ctx: Context, m: Machine, card: string, asked: number, scheme: "light" | "dark"): Promise<Uint8Array> {
	const source = await ctx.deck.read(cardPath(card));
	const rung = rungFor(asked);
	const key = `${createHash("sha256").update(source).digest("hex").slice(0, 24)}-${rung}-${scheme}.png`;
	const kept = await ctx.store.get(key);
	if (kept) return kept;
	const width = metaWidth(new TextDecoder().decode(source));
	const canvas = layout.canvasOfPath(card)?.name ?? "";
	const page = m.cardPage(card, canvas);
	const tab = await m.browser.page({ width, height: Math.round(width * 0.72), scale: rung / width, scheme });
	try {
		await tab.goto(page.url);
		const bytes = await tab.screenshot({ type: "png", full: true });
		await ctx.store.put(key, bytes);
		return bytes;
	} finally {
		await tab.close();
		page.done();
	}
}

async function answer(ctx: Context, m: Machine, path: string, query: URLSearchParams): Promise<RouteAnswer> {
	try {
		const card = decodeURIComponent(path.slice(PICTURES.length));
		const asked = Number(query.get("w") ?? 480);
		const scheme = query.get("scheme") === "dark" ? "dark" : "light";
		const bytes = await cardPicture(ctx, m, card, Number.isFinite(asked) && asked > 0 ? asked : 480, scheme);
		return { type: "image/png", body: bytes, headers: { "cache-control": "no-cache" } };
	} catch (error) {
		if (!(error instanceof Refused)) return { status: 503, type: "text/plain", body: (error as Error).message };
		return { status: error.code === "not_found" ? 404 : error.code === "unavailable" ? 503 : 400, type: "text/plain", body: error.message };
	}
}

export const pictureRoute = (m: () => Machine): Route => ({ method: "GET", prefix: PICTURES, answer: (ctx, path, query) => answer(ctx, m(), path, query) });
