import { FILES_PATH, layout, Refused } from "../../protocol/index.ts";
import type { Context, Route, RouteAnswer } from "../kernel/types.ts";
import { fence } from "./fence.ts";
import { titleOf } from "./cards.ts";
import { stat } from "./files.ts";

// A card's page and its modules, and every other file, under /files/. Rules 8 and 14.

export const FILES = FILES_PATH;
const RUNS = /^(?:|module|text\/javascript|application\/javascript)$/i;
const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const decoder = new TextDecoder();
const IMPORTS: Record<string, string> = {
	d3: "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm",
	three: "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js",
	"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/",
	gsap: "https://cdn.jsdelivr.net/npm/gsap@3.15.0/+esm",
	"chart.js": "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/+esm",
};
const TYPES: Record<string, string> = {
	html: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json", md: "text/markdown",
	txt: "text/plain", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
	pdf: "application/pdf", mp4: "video/mp4", mp3: "audio/mpeg", wav: "audio/wav", woff2: "font/woff2", wasm: "application/wasm",
};

const runs = (attrs: string) => RUNS.test(/\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1] ?? "");

/** The inline scripts a card runs, in order: the n-th is served at <card>.m<n>.js. */
export function cardModules(source: string): string[] {
	return [...source.matchAll(SCRIPT)].filter((m) => !/\bsrc\s*=/.test(m[1] ?? "") && runs(m[1] ?? "")).map((m) => m[2] ?? "");
}

/** The width a card asks for in its meta tag. */
export function widthOf(source: string): number {
	const content = /<meta\s+name=["'][\w-]+["']\s+content='(\{[^']*)'/i.exec(source)?.[1];
	try {
		const w = (JSON.parse(content ?? "{}") as { w?: unknown }).w;
		return typeof w === "number" && w > 0 ? w : 1000;
	} catch {
		return 1000;
	}
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A card as a page of its own: the piece under card.css, its modules called with a card. */
export function cardPage(input: { path: string; source: string; pass: string; deckImports: Record<string, string> }): string {
	const n = cardModules(input.source).length;
	const shared = layout.isSharedCanvas(layout.canvasOfPath(input.path)?.name ?? "");
	const name = input.path.split("/").pop()!;
	const urls = shared ? [] : Array.from({ length: n }, (_, i) => `./${name}.m${i}.js${input.pass}`);
	const html = input.source.replace(SCRIPT, (all, attrs: string) => (runs(attrs) ? "" : all));
	const w = widthOf(input.source);
	// Relative to the card, so a pass in the path (a compat address) or in the query reaches them too.
	const up = "../".repeat(input.path.split("/").length - 1);
	const deck = Object.fromEntries(Object.entries(input.deckImports).map(([name, address]) => [name, address.startsWith(FILES) ? up + address.slice(FILES.length) + (address.endsWith("/") ? "" : input.pass) : address]));
	const map = JSON.stringify({ imports: { ...deck, ...IMPORTS } });
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>${escape(titleOf(input.path, input.source))}</title>
<link rel="stylesheet" href="${up}lib/card.css${input.pass}" />
<script type="importmap">${map}</script></head>
<body class="card" style="width:${w}px"><div class="card-body" id="decks-card">${html}</div>
<script type="module">${PAGE_SCRIPT.replace("__PATH__", JSON.stringify(input.path)).replace("__URLS__", JSON.stringify(urls)).replace("__W__", String(w))}</script>
<script src="${up}lib/card.js${input.pass}"></script></body></html>
`;
}

// The card a card's scripts are handed, on a page of its own: the same names as on a canvas.
const PAGE_SCRIPT = `
const root = document.getElementById("decks-card");
root.getElementById = (id) => root.querySelector("#" + CSS.escape(id));
const url = location.href.replace(/[?#].*$/, ""), path = __PATH__, dark = matchMedia("(prefers-color-scheme: dark)");
const listeners = { theme: new Set(), size: new Set() }, key = (n) => "decks.card:" + path + ":" + n;
const calls = (name) => new Proxy(function () {}, {
	get: (_t, k) => (typeof k === "string" && k !== "then" ? calls(name ? name + "." + k : k) : undefined),
	apply: () => Promise.reject(new Error(name + ": a card opened in a tab of its own makes no calls; open it on its canvas.")),
});
const card = { root, document, signal: new AbortController().signal, url, path, page: true, elements: customElements,
	file: (n) => new URL(n, url).href + location.search, theme: dark.matches ? "dark" : "light", size: { w: __W__, h: root.offsetHeight },
	store: { getItem: (n) => localStorage.getItem(key(n)), setItem: (n, v) => localStorage.setItem(key(n), v), removeItem: (n) => localStorage.removeItem(key(n)) },
	on: (what, fn) => void listeners[what]?.add(fn), decks: calls("") };
dark.addEventListener("change", () => { card.theme = dark.matches ? "dark" : "light"; for (const fn of listeners.theme) fn(); });
new ResizeObserver(() => { card.size = { w: root.offsetWidth, h: root.offsetHeight }; for (const fn of listeners.size) fn(); }).observe(root);
for (const u of __URLS__) {
	try { const m = await import(new URL(u, location.href).href); if (typeof m.default === "function") await m.default(card); }
	catch (error) { console.error(u, error); }
}`;

/** The deck's own import names, from assets/importmap.json; relative ones under /files/assets/. */
async function deckImports(ctx: Context): Promise<Record<string, string>> {
	try {
		const given = JSON.parse(decoder.decode(await ctx.deck.read(fence("assets/importmap.json")))) as { imports?: Record<string, unknown> };
		const out: Record<string, string> = {};
		for (const [name, address] of Object.entries(given.imports ?? {})) {
			if (typeof address !== "string") continue;
			if (/^https:\/\//.test(address)) out[name] = address;
			else if (!address.split("/").some((p) => p === ".." || p.startsWith("."))) out[name] = `${FILES}assets/${address.replace(/^\.\//, "")}`;
		}
		return out;
	} catch {
		return {};
	}
}

const refusal = (status: number, message: string): RouteAnswer => ({ status, type: "text/plain", body: message });

/** GET /files/<path>: a file, a card's page, or one of its modules. */
export async function answerFile(ctx: Context, rest: string, query: URLSearchParams): Promise<RouteAnswer> {
	try {
		const asked = decodeURIComponent(rest.startsWith(FILES) ? rest.slice(FILES.length) : rest.replace(/^\/+/, ""));
		const pass = query.get("pass") ? `?pass=${encodeURIComponent(query.get("pass")!)}` : "";
		const module = /^(.+\/index\.html)\.m(\d+)\.js$/i.exec(asked);
		if (module && layout.isCardPath(module[1]!)) {
			if (layout.isSharedCanvas(layout.canvasOfPath(module[1]!)?.name ?? "")) return refusal(403, "A card shared with you runs no scripts.");
			const source = cardModules(decoder.decode(await ctx.deck.read(fence(module[1]))))[Number(module[2])];
			return source === undefined ? refusal(404, "The card has no such script.") : { type: "text/javascript", body: source, headers: { "cache-control": "no-cache" } };
		}
		const path = fence(asked);
		if ((await stat(ctx.deck, path))?.kind !== "file") return refusal(404, `There is no file at ${path}.`);
		if (layout.isCardPath(path) && query.get("raw") === null) {
			return { type: "text/html", body: cardPage({ path, source: decoder.decode(await ctx.deck.read(path)), pass, deckImports: await deckImports(ctx) }) };
		}
		return { type: TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream", body: await ctx.deck.read(path) };
	} catch (error) {
		if (error instanceof Refused) return refusal(error.code === "not_found" ? 404 : error.code === "refused" ? 403 : 400, error.message);
		throw error;
	}
}

export const routes: Route[] = [{ method: "GET", prefix: FILES, answer: (ctx, path, query) => answerFile(ctx, path, query) }];
