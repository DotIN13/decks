import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import type { Response } from "express";
import { bearerOf, fromAnotherSite, originOf, queryTokenOf } from "../auth/guard.ts";
import { APP_NAME, type Apps } from "./service.ts";
import { STORAGE_SCRIPT, storageScript } from "./storage-script.ts";

/**
 * `/app/<name>/…`: an app on Decks' own address (`service.ts`).
 *
 * A static or built app is its folder's files. A server app is proxied to the port it was given,
 * and started first if it is asleep, so the request that finds it asleep is the one that wakes it:
 * the board needs no "wake" button, and an API call from a page that was left open works too. Each
 * request counts as the app being seen, and so does the board's own heartbeat (`lib/live-app.js`).
 *
 * The path the server sees is the path inside the app, `/api/items`, unless its manifest says
 * `prefix` (a framework told its base path, which Decks also passes as `BASE_PATH`).
 *
 * An app is this server's own page, so another site is not let in (`fromAnotherSite`) unless it
 * carries a pairing token, as for `/api/`, or a GET carries an app pass for a tab (`decks_pass`,
 * `auth/passes.ts`), which is how another site opens one in a frame or a tab: an app has no
 * sign-in of its own, and without this any page the person opened could call it. What Decks itself
 * uses to let a request in never reaches the app: the pairing token, in the `Authorization` header
 * or as `decks_token`, a pass, and `X-Decks-*`.
 */

/**
 * Whether a token is one this server gave out, and, given the page it came from (`Origin`), good
 * from that page (`TokenStore.verify`).
 */
export type PairedCheck = (token: string | undefined, origin?: string) => boolean;

/** Whether what a GET carries in its address opens this app: an app pass for a tab, for this app (`decks_pass`, `auth/passes.ts`). */
export type TicketCheck = (pass: string | undefined, name: string) => boolean;

/** Whether the pass in an address's path opens this app: an app pass held by a canvas the app is placed on (`/app/t/<pass>/<name>/…`). */
export type CarriedCheck = (pass: string, name: string) => boolean;

/**
 * `/app/t/<pass>/<name>/…`: an app opened inside the canvas frame (`routes/apps.ts`, `open`). The frame is
 * sandboxed and so is the app's iframe in it, with no origin of its own and no cookies, so the pass rides in
 * the path, and every relative address the app loads, fetches or opens a socket to carries it too.
 */
const CARRIED = /^\/app\/t\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\/([^/?]+)(\/[^?]*)?(\?.*)?$/;

function carriedTarget(url: string): { pass: string; name: string; inner: string; query: string; slash: boolean } | undefined {
	const match = CARRIED.exec(url);
	if (!match) return undefined;
	const [, pass = "", name = "", inner, query = ""] = match;
	if (!APP_NAME.test(name)) return undefined;
	return { pass, name, inner: inner ?? "/", query, slash: inner !== undefined };
}

const ROUTE = /^\/app\/([^/?]+)(\/[^?]*)?(\?.*)?$/;

function target(url: string): { name: string; inner: string; query: string; slash: boolean } | undefined {
	const match = ROUTE.exec(url);
	if (!match) return undefined;
	const [, name = "", inner, query = ""] = match;
	if (!APP_NAME.test(name)) return undefined;
	return { name, inner: inner ?? "/", query, slash: inner !== undefined };
}

/** Answer one request. Answers whether it was an `/app/` request at all. */
export function appRequest(req: IncomingMessage, res: ServerResponse & Partial<Response>, apps: Apps, paired?: PairedCheck, ticketed?: TicketCheck, carried?: CarriedCheck): boolean {
	const url = req.url ?? "/";
	const inFrame = carriedTarget(url);
	const at = inFrame ?? target(url);
	if (!at) return false;
	// Where the app's own addresses start: what its redirects and its base-path header are put under.
	const base = inFrame ? `/app/t/${inFrame.pass}/${at.name}` : `/app/${at.name}`;
	if (inFrame) {
		if (!carried?.(inFrame.pass, at.name)) {
			plain(res, 401, "This app's address has stopped working: the app is no longer on that canvas, the canvas is no longer yours alone, or you signed out. Reload the canvas.");
			return true;
		}
		// The page's address holds the pass: not sent on as the Referer of what it loads from elsewhere.
		res.setHeader("Referrer-Policy", "no-referrer");
		/*
		 * Readable by the app's own page, which has no origin (`Origin: null`): every fetch it makes counts as
		 * another site's. The pass in the path is the credential, and no cookie is used, so `*` is enough.
		 */
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Expose-Headers", "*");
		if (req.method === "OPTIONS" && req.headers["access-control-request-method"]) {
			res.writeHead(204, {
				"access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
				"access-control-allow-headers": String(req.headers["access-control-request-headers"] ?? "*"),
				"access-control-max-age": "600",
			});
			res.end();
			return true;
		}
	} else if (byTicket(req, at.name, ticketed)) {
		// The page's address holds its ticket, which is not sent on as the Referer of what it loads.
		res.setHeader("Referrer-Policy", "no-referrer");
	} else if (refusedSite(req, paired)) {
		plain(res, 403, "An app here answers only its own Decks' pages, or another site paired with this Decks.");
		return true;
	}
	if (!apps.exists(at.name)) {
		plain(res, 404, `There is no app called ${at.name}. An agent makes one with decks apps create ${at.name}.`);
		return true;
	}
	let manifest;
	try {
		manifest = apps.manifest(at.name);
	} catch (error) {
		plain(res, 500, (error as Error).message);
		return true;
	}
	/*
	 * The bare name gets its slash, so the app's relative addresses resolve inside it. Not for an app
	 * told its base path, which answers the bare name itself: Next.js sends `/app/x/` to `/app/x`,
	 * and the two redirects went round until the browser gave up.
	 */
	if (inFrame && manifest.prefix) {
		plain(res, 409, `apps/${at.name} is told its base path, so it loads by absolute addresses, which do not carry the pass. Open it in a tab.`);
		return true;
	}
	if (!at.slash && !manifest.prefix) {
		res.writeHead(301, { location: `${base}/${at.query}` });
		res.end();
		return true;
	}
	apps.seen(at.name);
	// The browser storage an app asks for with one script tag (`storage-script.ts`): Decks', not the app's.
	if (at.inner === `/${STORAGE_SCRIPT}`) {
		res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
		res.end(storageScript(at.name));
		return true;
	}
	if (manifest.kind !== "server") {
		const file = apps.file(at.name, at.inner);
		if (!file) {
			const built = manifest.kind === "build" ? ` A built app is served from its ${manifest.root ?? "dist"}/ folder; build it with decks apps build ${at.name}.` : "";
			plain(res, 404, `apps/${at.name} has no file at ${at.inner}.${built}`);
			return true;
		}
		if (typeof res.sendFile === "function") {
			res.sendFile(file, { dotfiles: "allow", cacheControl: false, headers: { "cache-control": "no-cache" } }, (error) => {
				if (error && !res.headersSent) plain(res, 500, error.message);
			});
		} else plain(res, 500, "This server cannot send files.");
		return true;
	}
	void apps.portFor(at.name).then((port) => {
		if (port === undefined) {
			const state = apps.state(at.name);
			const lines = apps.log(at.name, 30).join("\n");
			plain(res, 503, `apps/${at.name} is ${state.status}${state.error ? `: ${state.error}` : ""}.\n\n${lines}`);
			return;
		}
		const path = manifest.prefix ? `${url.split("?")[0]}${withoutToken(at.query)}` : `${at.inner}${withoutToken(at.query)}`;
		const upstream = httpRequest({ host: "127.0.0.1", port, method: req.method, path, headers: forwarded(req, base, paired) }, (answer) => {
			const headers = { ...answer.headers };
			// A redirect the app made to its own root goes back inside its address.
			const location = headers.location;
			if (!manifest.prefix && typeof location === "string" && location.startsWith("/") && !location.startsWith("//")) headers.location = `${base}${location}`;
			// Its own CORS answer would fight the one above, which is what lets its origin-less page read it.
			if (inFrame) for (const key of Object.keys(headers)) if (key.startsWith("access-control-")) delete headers[key];
			res.writeHead(answer.statusCode ?? 502, headers);
			answer.pipe(res);
		});
		// A browser that goes away mid-answer (a video seeking) leaves the app's answer unread, and the kernel holds it for good.
		res.on("close", () => {
			if (!res.writableFinished) upstream.destroy();
		});
		upstream.on("error", (error) => {
			if (res.destroyed) return;
			if (res.headersSent) return void res.destroy();
			plain(res, 502, `apps/${at.name} did not answer: ${error.message}`);
		});
		req.pipe(upstream);
	});
	return true;
}

/** A websocket to a server app (a dev server's reloads, a chat). Answers whether it was an `/app/` upgrade at all. */
export function appUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, apps: Apps, paired?: PairedCheck, carried?: CarriedCheck): boolean {
	const url = req.url ?? "/";
	const inFrame = carriedTarget(url);
	const at = inFrame ?? target(url);
	if (!at) return false;
	const base = inFrame ? `/app/t/${inFrame.pass}/${at.name}` : `/app/${at.name}`;
	if (inFrame ? !carried?.(inFrame.pass, at.name) : refusedSite(req, paired)) {
		socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
		return true;
	}
	if (!apps.exists(at.name) || apps.manifest(at.name).kind !== "server") {
		socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
		return true;
	}
	const prefix = apps.manifest(at.name).prefix;
	if (inFrame && prefix) {
		socket.end("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n");
		return true;
	}
	void apps.portFor(at.name).then((port) => {
		if (port === undefined) return void socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
		const upstream = connect(port, "127.0.0.1", () => {
			const lines = [`${req.method ?? "GET"} ${prefix ? `${url.split("?")[0]}${withoutToken(at.query)}` : `${at.inner}${withoutToken(at.query)}`} HTTP/1.1`];
			for (const [name, value] of Object.entries(forwarded(req, base, paired))) {
				for (const one of Array.isArray(value) ? value : [value]) if (one !== undefined) lines.push(`${name}: ${one}`);
			}
			upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
			if (head.length > 0) upstream.write(head);
			upstream.pipe(socket);
			socket.pipe(upstream);
		});
		const close = () => {
			upstream.destroy();
			socket.destroy();
		};
		upstream.on("error", close);
		socket.on("error", close);
		socket.on("close", () => upstream.destroy());
		upstream.on("close", () => socket.destroy());
	});
	return true;
}

/** Another site's request, without a paired token: `Sec-Fetch-Site` says so, or an `Origin` that is not this host. */
function refusedSite(req: IncomingMessage, paired: PairedCheck | undefined): boolean {
	if (!fromAnotherSite(req.headers)) return false;
	return !(paired?.(bearerOf(req.headers) ?? queryTokenOf(req.url), originOf(req.headers)) ?? false);
}

/** Another site's GET let in by an app pass for this app (`decks_pass`, `auth/passes.ts`). */
function byTicket(req: IncomingMessage, name: string, ticketed: TicketCheck | undefined): boolean {
	if (!ticketed || req.method !== "GET" || !fromAnotherSite(req.headers)) return false;
	const pass = passOf(req.url);
	return pass !== undefined && ticketed(pass, name);
}

/** The app pass a tab's address carries (`decks_pass`), if any. */
function passOf(url: string | undefined): string | undefined {
	try {
		return new URL(url ?? "/", "http://decks").searchParams.get("decks_pass") ?? undefined;
	} catch {
		return undefined;
	}
}

/** A query string (`?a=1&decks_token=…`) without the pairing token or a pass, which are Decks', not the app's. */
export function withoutToken(query: string): string {
	if (!query.includes("decks_token") && !query.includes("decks_pass")) return query;
	const params = new URLSearchParams(query.slice(1));
	params.delete("decks_token");
	params.delete("decks_pass");
	const rest = params.toString();
	return rest ? `?${rest}` : "";
}

function forwarded(req: IncomingMessage, base: string, paired?: PairedCheck): Record<string, string | string[] | undefined> {
	const headers: Record<string, string | string[] | undefined> = {};
	for (const [key, value] of Object.entries(req.headers)) if (!key.startsWith("x-decks-")) headers[key] = value;
	// A pairing token is Decks' to check, never the app's to see; an app's own bearer token goes on.
	const auth = req.headers.authorization;
	if (typeof auth === "string" && auth.startsWith("Bearer ") && paired?.(auth.slice(7).trim())) delete headers.authorization;
	const host = req.headers["x-forwarded-host"] ?? req.headers.host;
	if (host) headers["x-forwarded-host"] = host;
	headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] ?? "http";
	headers["x-forwarded-for"] = req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "";
	headers["x-forwarded-prefix"] = base;
	return headers;
}

function plain(res: ServerResponse, status: number, text: string): void {
	if (res.headersSent) return void res.end();
	res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
	res.end(text);
}
