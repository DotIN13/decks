import { layout, Refused } from "../../protocol/index.ts";
import type { Bytes, Context, Route, RouteAnswer } from "../kernel/index.ts";
import type { Machine } from "./machine.ts";
import { picturedPath } from "./picture.ts";

// A card drawn from markup the reader's page posted (rule 14): POST /pictures/snapshot?path=&w=&h=&scheme=.
// The markup is drawn at the card's own address, so its relative files load as on the canvas.

export const SNAPSHOT = "/pictures/snapshot";
const LIMIT = 24 * 1024 * 1024;
const text = (status: number, body: string): RouteAnswer => ({ status, type: "text/plain; charset=utf-8", body });
const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export const snapshotRoute = (m: () => Machine): Route => ({ method: "POST", prefix: SNAPSHOT, answer: (ctx, _path, query, body) => answer(ctx, m(), query, body) });

async function answer(ctx: Context, m: Machine, query: URLSearchParams, body: Bytes): Promise<RouteAnswer> {
	try {
		if (body.length > LIMIT) return text(413, "The markup is over 24 MB.");
		const path = picturedPath(query.get("path") ?? "");
		await ctx.deck.read(path).catch(() => {
			throw new Refused("not_found", `There is no card at ${path}.`, "card.list");
		});
		const w = Math.min(4000, Number(query.get("w")) || 1000);
		const h = Math.min(8000, Number(query.get("h")) || 700);
		const scheme = query.get("scheme") === "dark" ? "dark" : "light";
		const page = m.cardPage(path, layout.canvasOfPath(path)?.name ?? "");
		const address = new URL(page.url);
		const folder = `${address.origin}${address.pathname.replace(/[^/]*$/, "")}`;
		const tab = await m.browser.page({ width: w, height: h, scale: 1, scheme });
		try {
			await tab.authorize(address.origin, address.searchParams.get("pass") ?? "");
			await tab.show(based(new TextDecoder().decode(body), folder));
			const bytes = await tab.screenshot({ type: "png", clip: { x: 0, y: 0, width: w, height: h } });
			return { type: "image/png", body: bytes, headers: { "cache-control": "no-store" } };
		} finally {
			await tab.close();
			page.done();
		}
	} catch (error) {
		const code = error instanceof Refused ? error.code : "unavailable";
		return text(code === "not_found" ? 404 : code === "unavailable" ? 503 : 400, (error as Error).message);
	}
}

/** The markup with a base at the card's folder, put first in its head. */
export function based(html: string, base: string): string {
	const tag = `<base href="${escapeAttr(base)}">`;
	if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (head) => `${head}${tag}`);
	return `<!doctype html><html><head><meta charset="utf-8">${tag}</head><body>${html}</body></html>`;
}

