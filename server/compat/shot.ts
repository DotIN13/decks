import { toDeckPath, type Route } from "../kernel/index.ts";

// Today's GET /api/stage-shot: canvas.screenshot taken for a download, the file answered with its
// box and how it was taken in X-Shot-Box and X-Shot-How, then removed, as today.

const TYPES: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", pdf: "application/pdf" };

/** canvas.screenshot's arguments from today's query: of a list, a box, or the whole canvas. */
export function shotArgs(query: URLSearchParams, canvas: string): Record<string, unknown> {
	const box = query.get("box")?.split(",").map(Number);
	const listed = query.get("of")?.split(",").filter(Boolean);
	const of = box ? { x1: box[0], y1: box[1], x2: box[2], y2: box[3] } : listed?.length === 1 ? listed[0] : listed;
	const format = query.get("format") === "jpeg" || query.get("format") === "pdf" ? query.get("format")! : "png";
	const scale = Number.isFinite(Number(query.get("scale"))) && query.get("scale") ? Number(query.get("scale")) : 2;
	const live = query.get("live") === "1" || query.get("live") === "true";
	return { canvas, format, scale, scheme: query.get("scheme") === "dark" ? "dark" : "light", ...(of !== undefined ? { of } : {}), ...(live ? { live } : {}) };
}

export const stageShotRoute: Route = {
	method: "GET",
	prefix: "/api/stage-shot",
	async answer(ctx, _path, query) {
		const agent = query.get("agent");
		const home = agent ? await ctx.call<{ canvas?: string }>("agent.get", { agent }).then((a) => a.canvas, () => undefined) : undefined;
		const canvas = query.get("canvas") || home;
		if (!canvas) return { status: 404, type: "text/plain", body: "Say which canvas to picture." };
		const args = shotArgs(query, canvas);
		let shot: { file: string; box?: unknown; how?: string };
		try {
			shot = await ctx.call("canvas.screenshot", args);
		} catch (error) {
			return { status: 503, type: "text/plain", body: (error as Error).message };
		}
		const path = toDeckPath(shot.file);
		const body = await ctx.deck.read(path);
		await ctx.deck.remove(path, ctx.caller).catch(() => undefined);
		const name = /^[\w.-]{1,80}$/.test(query.get("name") ?? "") ? query.get("name")! : canvas.replace(/[^\w-]+/g, "-");
		const format = String(args.format);
		return {
			type: TYPES[format] ?? "image/png",
			body,
			headers: { "x-shot-box": JSON.stringify(shot.box ?? null), "x-shot-how": encodeURIComponent(shot.how ?? ""), "content-disposition": `attachment; filename="${name}.${format === "jpeg" ? "jpg" : format}"`, "cache-control": "no-store" },
		};
	},
};
