import { createHash } from "node:crypto";
import { layout, Refused } from "../../protocol/index.ts";
import { toDeckPath, type Context, type Route, type RouteAnswer } from "../kernel/index.ts";
import type { PictureTools } from "./tools.ts";
import { canvasShot } from "./shot.ts";

// A canvas's tile picture (rule 12): the whole canvas, its long side 480 px,
// a JPEG kept in the store by the drawing's bytes and the scheme.

export const TILES = "/pictures/canvas-tile/";
const LONG_SIDE = 480;

export const tileRoute = (m: () => PictureTools): Route => ({ method: "GET", prefix: TILES, answer: (ctx, path, query) => answer(ctx, m(), path, query) });

async function answer(ctx: Context, m: PictureTools, path: string, query: URLSearchParams): Promise<RouteAnswer> {
	try {
		const scheme = query.get("scheme") === "dark" ? "dark" : "light";
		const bytes = await canvasTile(ctx, m, decodeURIComponent(path.slice(TILES.length)), scheme);
		return { type: "image/jpeg", body: bytes, headers: { "cache-control": query.has("v") ? "private, max-age=31536000, immutable" : "no-cache" } };
	} catch (error) {
		const code = error instanceof Refused ? error.code : "unavailable";
		return { status: code === "not_found" ? 404 : code === "invalid" ? 400 : 503, type: "text/plain", body: (error as Error).message };
	}
}

/** The tile's JPEG bytes, taken once per drawing and scheme. */
export async function canvasTile(ctx: Context, m: PictureTools, canvas: string, scheme: "light" | "dark"): Promise<Uint8Array> {
	const name = ctx.canvasName(canvas);
	const drawing = await ctx.deck.read(toDeckPath(`${layout.canvasFolder(name)}/canvas.pen`)).catch(() => undefined);
	if (!drawing) throw new Refused("not_found", `There is no canvas called ${canvas}.`, "canvas.list");
	const key = `tile-${createHash("sha256").update(name).update(drawing).digest("hex").slice(0, 24)}-${scheme}.jpg`;
	const kept = await ctx.store.get(key);
	if (kept) return kept;
	const taken = await canvasShot(ctx, m, name, { format: "jpeg", scheme, scale: LONG_SIDE / 1600 });
	await ctx.store.put(key, taken.bytes);
	return taken.bytes;
}

