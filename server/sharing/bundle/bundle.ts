import { posix } from "node:path";
import { Refused, layout, type Infer, type shapes } from "../../../protocol/index.ts";
import { toDeckPath, type Context, type Route, type RouteAnswer } from "../../kernel/types.ts";
import { zip, type ZipEntry } from "./zip.ts";

// A canvas as one .decks file (manifest version 2), for a Decks with no server: the canvas's
// folder, lib/ and every file its cards name; no transcript, settings or other canvas.
// Card pictures are left out until pictures exist.

export const BUNDLE_PREFIX = "/api/bundle/";
const MAX_FILE = 40 * 1024 * 1024;
const TEXTUAL = /\.(?:html?|css|svg|md)$/i;
const REFERENCE = /(?:\b(?:src|href|poster|data|data-src)\s*=\s*["']([^"'<>]+)["'])|(?:url\(\s*["']?([^"')]+)["']?\s*\))/gi;

type Card = { path: string; title: string; x: number; y: number; w: number; h: number; seenAt: number; inContext: string[] };

// The route
/** GET /api/bundle/<canvas>: today's address for "Download this canvas". */
export const bundleRoute: Route = { method: "GET", prefix: BUNDLE_PREFIX, answer: (ctx, path) => answer(ctx, path) };

async function answer(ctx: Context, path: string): Promise<RouteAnswer> {
	if (ctx.caller.kind !== "person") return { status: 403, type: "text/plain", body: "Only the person downloads a canvas." };
	try {
		const { bytes, title } = await buildBundle(ctx, decodeURIComponent(path.slice(BUNDLE_PREFIX.length)));
		const file = bundleFileName(title);
		const disposition = `attachment; filename="${file.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'")}"; filename*=UTF-8''${encodeURIComponent(file)}`;
		return { type: "application/zip", body: bytes, headers: { "content-disposition": disposition, "cache-control": "no-store" } };
	} catch (error) {
		if (error instanceof Refused && error.code === "not_found") return { status: 404, type: "text/plain", body: "No such canvas." };
		throw error;
	}
}

/** The download's name: the canvas's title, with what a file system refuses taken out. */
export function bundleFileName(title: string): string {
	const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "canvas";
	return `${base}.decks`;
}

// Building the zip
export async function buildBundle(ctx: Context, asked: string): Promise<{ bytes: Buffer; title: string }> {
	const name = ctx.canvasName(asked);
	const canvas = await ctx.call<Infer<typeof shapes.Canvas>>("canvas.get", { canvas: name });
	const folder = layout.canvasFolder(name);
	const items = ctx.canvas(name).read();
	const cards: Card[] = items
		.filter((i) => i.type === "card" && typeof i.card === "string" && i.box)
		.map((i) => ({ path: i.card!, title: i.title ?? posix.basename(posix.dirname(i.card!)), x: i.box!.x1, y: i.box!.y1, w: i.box!.x2 - i.box!.x1, h: i.box!.y2 - i.box!.y1, seenAt: Date.now(), inContext: [] }));
	const files = new Set([...(await filesUnder(ctx, layout.LIB)), ...(await filesUnder(ctx, folder))]);
	await namedFiles(ctx, cards.map((c) => c.path), files);
	const penBytes = await read(ctx, `${folder}/canvas.pen`);
	const doc = penBytes ? JSON.parse(new TextDecoder().decode(penBytes)) : { children: [] };
	const manifest = { decks: 2, made: new Date().toISOString(), from: "Decks", canvas: { name, title: canvas.title, rev: canvas.rev ?? 0 }, pen: { doc, base: `${folder}/` }, cards, pictures: {} };
	const entries: ZipEntry[] = [{ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest), "utf8") }];
	for (const file of [...files].sort()) {
		const bytes = await read(ctx, file);
		if (bytes && bytes.length <= MAX_FILE) entries.push({ name: `deck/${file}`, data: bytes });
	}
	return { bytes: zip(entries), title: canvas.title };
}

async function filesUnder(ctx: Context, dir: string): Promise<string[]> {
	const out: string[] = [];
	const entries = await ctx.deck.list(toDeckPath(dir)).catch(() => []);
	for (const e of entries) out.push(...(e.kind === "dir" ? await filesUnder(ctx, e.path) : [e.path]));
	return out;
}

async function read(ctx: Context, path: string): Promise<Uint8Array | undefined> {
	return ctx.deck.read(toDeckPath(path)).catch(() => undefined);
}

// The files a canvas's cards name
/** Every file the cards name, and what their stylesheets and pictures name in turn. */
async function namedFiles(ctx: Context, cards: string[], files: Set<string>): Promise<void> {
	const queue = [...cards];
	const seen = new Set<string>();
	while (queue.length) {
		const file = queue.shift()!;
		if (seen.has(file) || !TEXTUAL.test(file)) continue;
		seen.add(file);
		const bytes = await read(ctx, file);
		if (!bytes) continue;
		for (const m of new TextDecoder().decode(bytes).matchAll(REFERENCE)) {
			const target = resolveRef(file, m[1] ?? m[2] ?? "");
			if (!target || files.has(target) || !(await read(ctx, target))) continue;
			if (layout.isCardPath(target) && !cards.includes(target)) continue;
			files.add(target);
			if (/\.(?:css|svg)$/i.test(target)) queue.push(target);
		}
	}
}

/** A reference read against the file that made it, as a deck path; undefined when it leaves the deck. */
export function resolveRef(fromFile: string, ref: string): string | undefined {
	const clean = (ref.split(/[?#]/)[0] ?? "").trim();
	if (!clean || /^(?:[a-z][a-z0-9+.-]*:|\/|#|\{|\$)/i.test(clean)) return undefined;
	let decoded = clean;
	try {
		decoded = decodeURIComponent(clean);
	} catch {
		decoded = clean;
	}
	const joined = posix.normalize(posix.join(posix.dirname(fromFile), decoded));
	return joined.startsWith("..") || joined.startsWith("/") || !layout.deckPathOk(joined) ? undefined : joined;
}
