import { Refused } from "../../protocol/index.ts";
import type { Context, Route, RouteAnswer } from "../kernel/index.ts";
import type { Machine } from "./machine.ts";
import { take, type ShotArgs } from "./shot.ts";

// A picture to download (rule 13): GET /pictures/shot?canvas=&agent=&of=&box=&format=&scale=&scheme=&live=&name=.
// Taken as canvas.screenshot takes it, answered as bytes and kept nowhere.

export const SHOT = "/pictures/shot";
const TYPES = { png: "image/png", jpeg: "image/jpeg", pdf: "application/pdf" } as const;

export const shotRoute = (m: () => Machine): Route => ({ method: "GET", prefix: SHOT, answer: (ctx, _path, query) => answer(ctx, m(), query) });

async function answer(ctx: Context, m: Machine, query: URLSearchParams): Promise<RouteAnswer> {
	const text = (status: number, body: string): RouteAnswer => ({ status, type: "text/plain; charset=utf-8", body });
	try {
		const canvas = await canvasOf(ctx, query);
		if (!canvas) return text(404, "Say which canvas to picture: canvas=, or agent= for that agent's home.");
		const args = shotArgs(query);
		const taken = await take(ctx, m, { ...args, canvas });
		const name = /^[\w.-]{1,80}$/.test(query.get("name") ?? "") ? query.get("name")! : taken.canvas.replace(/[^\w-]+/g, "-");
		const ext = args.format === "jpeg" ? "jpg" : args.format!;
		const headers = { "x-shot-box": JSON.stringify(taken.box ?? null), "x-shot-how": encodeURIComponent(taken.how), "content-disposition": `attachment; filename="${name}.${ext}"`, "cache-control": "no-store" };
		return { type: TYPES[args.format!], body: taken.bytes, headers };
	} catch (error) {
		const code = error instanceof Refused ? error.code : "unavailable";
		return text(code === "not_found" ? 404 : code === "unavailable" ? 503 : 400, (error as Error).message);
	}
}

async function canvasOf(ctx: Context, query: URLSearchParams): Promise<string | undefined> {
	const named = query.get("canvas");
	if (named) return named;
	const agent = query.get("agent");
	if (!agent) return undefined;
	return (await ctx.call<{ canvas?: string }>("agent.get", { agent }).catch(() => undefined))?.canvas;
}

/** The screenshot's arguments from the address. of is ids or a card, comma separated; box is x1,y1,x2,y2. */
export function shotArgs(query: URLSearchParams): Omit<ShotArgs, "canvas"> {
	const box = query.get("box")?.split(",").map(Number);
	const listed = query.get("of")?.split(",").filter(Boolean);
	const of = box && box.length === 4 && box.every(Number.isFinite) ? { x1: box[0]!, y1: box[1]!, x2: box[2]!, y2: box[3]! } : listed?.length === 1 ? listed[0] : listed?.length ? listed : undefined;
	const format = query.get("format") === "jpeg" || query.get("format") === "pdf" ? (query.get("format") as "jpeg" | "pdf") : "png";
	const scale = Number(query.get("scale") ?? 2);
	const live = query.get("live") === "1" || query.get("live") === "true";
	return { ...(of !== undefined ? { of } : {}), format, scale: Number.isFinite(scale) && scale > 0 ? scale : 2, scheme: query.get("scheme") === "dark" ? "dark" : "light", ...(live ? { live } : {}) };
}

