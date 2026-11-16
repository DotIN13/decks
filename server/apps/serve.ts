import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { toDeckPath, type Context, type RouteAnswer, type SocketDoor } from "../kernel/index.ts";
import { APP_NAME, folderOf, type Manifest } from "./manifest.ts";
import { asksGuest, guestScript, guestSrc, withGuest } from "./guest.ts";
import { pipeTo, send, upgradeTo, withoutPass } from "./proxy.ts";
import type { Apps } from "./service.ts";

// /app/<name>/<path>: a static app's files from the deck, a built app's from
// its running copy, a server app proxied. Rule 6 of the README.

const TYPES: Record<string, string> = {
	html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
	json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
	ico: "image/x-icon", woff2: "font/woff2", woff: "font/woff", txt: "text/plain; charset=utf-8", wasm: "application/wasm", mp3: "audio/mpeg", mp4: "video/mp4",
};

export const typeOf = (path: string) => TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
const plain = (status: number, text: string): RouteAnswer => ({ status, type: "text/plain; charset=utf-8", body: text });

/** Answer one request under /app/, streamed. */
export async function serveApp(ctx: Context, apps: Apps, req: IncomingMessage, res: ServerResponse): Promise<void> {
	const url = new URL(req.url ?? "/", "http://decks.local");
	const at = parseAppPath(url.pathname);
	if (!at) return send(res, plain(404, "An app's address is /app/<name>/."));
	if (!at.slash) return send(res, { status: 308, type: "text/plain", body: "", headers: { location: `/app/${at.name}/${url.search}` } });
	const manifest = await apps.manifest(at.name).catch(() => undefined);
	if (!manifest) return send(res, plain(404, `There is no app called ${at.name}.`));
	apps.seen(at.name);
	const guest: RouteAnswer = { type: "text/javascript; charset=utf-8", body: guestScript(at.name), headers: { "cache-control": "no-cache" } };
	if (manifest.kind === "server") {
		if (asksGuest(at.inner)) return send(res, guest);
		const target = await serverTarget(apps, at.name, manifest, at.inner, url.search);
		if (!target) return send(res, plain(503, `The app ${at.name} could not start; app.logs says why.`));
		return pipeTo(req, res, target.port, target.path, target.base);
	}
	if (req.method !== "GET" && req.method !== "HEAD") return send(res, plain(405, `${at.name} is a ${manifest.kind} app: it answers GET only.`));
	const inDeck = manifest.kind === "static" && !manifest.source;
	const root = manifest.root ?? (manifest.kind === "build" ? "dist" : "");
	const found = inDeck ? await fromDeck(ctx, at.name, root, at.inner) : await fromCopy(apps, at.name, root, at.inner);
	if (!found) return send(res, asksGuest(at.inner) ? guest : plain(404, `${at.inner} is not in the app ${at.name}.`));
	if (!found.type.startsWith("text/html")) return send(res, found);
	const page = typeof found.body === "string" ? found.body : new TextDecoder().decode(found.body);
	send(res, { ...found, body: withGuest(page, guestSrc(at.inner)) });
}

/** A WebSocket to a server app, its pass in the path or the query; refused before it opens. */
export function upgradeApp(apps: Apps, req: IncomingMessage, socket: Duplex, head: Buffer, door: SocketDoor): void {
	const asked = new URL(req.url ?? "/", "http://decks.local");
	const carried = passInPath(asked);
	const url = carried ? new URL(`${carried.path}${asked.search}`, asked) : asked;
	const at = parseAppPath(url.pathname);
	if (!at || !door.resolve(carried?.token ?? url.searchParams.get("pass") ?? undefined)) return void socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
	void apps.manifest(at.name)
		.then((manifest) => (manifest.kind === "server" ? serverTarget(apps, at.name, manifest, at.inner, url.search) : undefined))
		.catch(() => undefined)
		.then((target) => (target ? upgradeTo(req, socket, head, target.port, target.path, target.base) : socket.end("HTTP/1.1 404 Not Found\r\n\r\n")));
}

// The address
/** The app's name and the path inside it, from /app/<name>/<inner>. */
export function parseAppPath(path: string): { name: string; inner: string; slash: boolean } | undefined {
	const match = /^\/app\/([^/]+)(\/.*)?$/.exec(path);
	if (!match || !APP_NAME.test(match[1]!)) return undefined;
	return { name: match[1]!, inner: match[2] ?? "/", slash: match[2] !== undefined };
}

/** /app/t/<pass>/<name>/x: the pass rides in the path, so the page's relative addresses carry it too. */
export function passInPath(url: URL): { token: string; path: string } | undefined {
	const match = /^\/app\/t\/([A-Za-z0-9_.~-]+)\/(.*)$/.exec(url.pathname);
	return match ? { token: match[1]!, path: `/app/${match[2]}` } : undefined;
}

// Files from the deck or the copy
/** The candidates a path names, in order: the file, its folder's index.html, the app's index.html. */
export function candidates(inner: string): string[] {
	let path: string;
	try {
		path = decodeURIComponent(inner).replace(/^\/+/, "");
	} catch {
		return [];
	}
	if (path.split("/").some((part) => part.startsWith("."))) return [];
	const trimmed = path.replace(/\/$/, "");
	const out = trimmed ? [trimmed, `${trimmed}/index.html`] : ["index.html"];
	if (!/\.[a-z0-9]{1,8}$/i.test(path)) out.push("index.html");
	return [...new Set(out)];
}

async function fromDeck(ctx: Context, name: string, root: string, inner: string): Promise<RouteAnswer | undefined> {
	for (const path of candidates(inner)) {
		const bytes = await ctx.deck.read(toDeckPath(`${folderOf(name)}/${root ? `${root}/` : ""}${path}`)).catch(() => undefined);
		if (bytes) return { type: typeOf(path), body: bytes, headers: { "cache-control": "no-cache" } };
	}
	return undefined;
}

async function fromCopy(apps: Apps, name: string, root: string, inner: string): Promise<RouteAnswer | undefined> {
	for (const path of candidates(inner)) {
		const bytes = await apps.folders.read(name, root ? `${root}/${path}` : path);
		if (bytes) return { type: typeOf(path), body: bytes, headers: { "cache-control": "no-cache" } };
	}
	return undefined;
}

// Server apps
/** The port and the address a server app's request passes on to, starting it when it sleeps. */
export async function serverTarget(apps: Apps, name: string, manifest: Manifest, inner: string, search: string): Promise<{ port: number; path: string; base: string } | undefined> {
	const port = await apps.portFor(name);
	if (!port) return undefined;
	const base = `/app/${name}`;
	return { port, path: withoutPass(manifest.prefix ? `${base}${inner}` : inner, search), base };
}
