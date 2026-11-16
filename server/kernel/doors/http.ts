import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { API, LOGIN_PATH, MCP_PATH, PROTOCOL_VERSION, SOCKET_PATH, type Caller, type Envelope } from "../../../protocol/index.ts";
import { LOCAL_PERSON } from "../callers.ts";
import { SERVER_VERSION, type Built } from "../kernel.ts";
import { fail } from "../router.ts";
import { PUBLIC, type Route } from "../types.ts";
import { mcpAnswer } from "./mcp.ts";
import { socketDoor, socketParts } from "./socket.ts";
import { accept } from "./ws.ts";

// The HTTP door: POST /api/v1/<name> with the arguments as one JSON object,
// answered with the envelope, 200 for a value or a refusal alike. The token
// is the bearer, or ?pass= for a page. No token answers 401; a browser Origin
// with no token is refused before anything else. Feature routes and /mcp too.

export type Served = { url: string; port: number; server: Server; close(): Promise<void> };

type RouteOf = { feature: string; route: Route };

const LIMIT = 32 * 1024 * 1024;

/** A sandboxed frame (origin null) may call with its token; a page on another site gets nothing. */
const SANDBOXED = {
	"access-control-allow-origin": "null",
	"access-control-allow-headers": "authorization, content-type",
	"access-control-allow-methods": "GET, POST, PUT, DELETE",
	"access-control-max-age": "600",
};


const WHO = "Who is calling? Send a token: Authorization: Bearer <token>, from .decks/server.json or POST /api/v1/login.";

const NO_TOKEN = fail("refused", WHO, [], "deck.get");

/** Serve the doors on a port; a port in use fails with a sentence, not a crash. */
export function listen(built: Built, port: number, host = "127.0.0.1"): Promise<Served> {
	const serve = handler(built);
	const server = createServer((req, res) => {
		serve(req, res).catch((error: Error) => {
			if (!res.headersSent) json(res, 200, fail("unavailable", `The server failed: ${error.message}`, []));
			else res.destroy();
		});
	});
	const lines = new Set<Duplex>();
	server.on("upgrade", upgrades(built, lines));
	return new Promise((done, fail) => {
		server.once("error", (error: NodeJS.ErrnoException) => fail(new Error(error.code === "EADDRINUSE" ? `Port ${port} is in use; is another server running there?` : error.message)));
		server.listen(port, host, () => {
			const at = server.address();
			const real = typeof at === "object" && at ? at.port : port;
			built.setUrl(`http://${host}:${real}`);
			const close = () => new Promise<void>((closed) => {
				for (const line of lines) line.destroy();
				server.closeAllConnections();
				server.close(() => closed());
			});
			done({ url: `http://${host}:${real}`, port: real, server, close });
		});
	});
}

/** Every request but an upgrade: the browser rule, then a feature route, else the calls. */
export function handler(built: Built) {
	const routes: RouteOf[] = built.features.flatMap((feature) => (feature.routes ?? []).map((route) => ({ feature: feature.name, route })));
	return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
		const url = new URL(req.url ?? "/", "http://decks.local");
		const method = req.method ?? "GET";
		if (req.headers.origin === "null" && method === "OPTIONS") return void res.writeHead(204, SANDBOXED).end();
		const found = url.pathname.startsWith(`${API}/`) || url.pathname === MCP_PATH ? undefined : routeFor(routes, method, url.pathname);
		const inPath = found?.route.tokenOf?.(url);
		if (inPath) req.url = inPath.path + url.search;
		const token = inPath?.token ?? tokenOf(req, url);
		const open = found?.route.public === true && method === "GET";
		if (req.headers.origin === "null" && token) res.setHeader("access-control-allow-origin", "null");
		if (req.headers.origin && !token && !open) return json(res, 403, fail("refused", "A page in a browser must send a token; the origin alone says nothing.", []));
		const caller = built.callers.resolve(token) ?? (open ? PUBLIC : undefined);
		if (found) return caller ? serveRoute(built, found, caller, req, res) : json(res, 401, NO_TOKEN);
		return api(built, req, res, url, token, caller);
	};
}

function tokenOf(req: IncomingMessage, url: URL): string | undefined {
	const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
	return bearer ?? url.searchParams.get("pass") ?? undefined;
}

function json(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(body));
}

// The calls, login and MCP.
async function api(built: Built, req: IncomingMessage, res: ServerResponse, url: URL, token: string | undefined, caller: Caller | undefined): Promise<void> {
	const body = await bodyOf(req);
	const method = req.method ?? "GET";
	const path = url.pathname;
	if (method === "GET" && (path === API || path === `${API}/`)) return json(res, 200, { ok: true, value: { protocol: PROTOCOL_VERSION, server: SERVER_VERSION }, notes: [] });
	if (method === "POST" && path === LOGIN_PATH) {
		const args = parsed(body);
		if (!args) return json(res, 200, fail("invalid", "The body should be one JSON object.", []));
		const done = login(built, token, args);
		return json(res, done.status, done.body);
	}
	if (method === "POST" && path.startsWith(`${API}/`)) {
		const args = parsed(body);
		if (!caller) return json(res, 401, NO_TOKEN);
		if (!args) return json(res, 200, fail("invalid", "The arguments should be one JSON object, keyed by name.", []));
		return json(res, 200, await built.router.call(decodeURIComponent(path.slice(API.length + 1)), args, caller));
	}
	if (method === "POST" && path === MCP_PATH) {
		if (!caller) return json(res, 401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: WHO } });
		const answer = await mcpAnswer(built, caller, parsed(body) ?? {});
		if (!answer) return void res.writeHead(202).end();
		return json(res, 200, answer);
	}
	return json(res, 404, fail("not_found", `Nothing is served at ${path}.`, [], "deck.get"));
}

function login(built: Built, token: string | undefined, args: Record<string, unknown>): { status: number; body: Envelope<unknown> } {
	const label = typeof args.label === "string" ? args.label : undefined;
	if (typeof args.code === "string") {
		const got = built.callers.redeem(args.code, label);
		return got ? { status: 200, body: { ok: true, value: { token: got.token, name: got.who.name }, notes: [] } } : { status: 401, body: fail("refused", "That code is wrong, spent or more than ten minutes old.", [], "deck.pair") };
	}
	const caller = built.callers.resolve(token);
	if (caller?.id !== LOCAL_PERSON.id) return { status: 401, body: fail("refused", "Log in with a pairing code, or with the token in .decks/server.json as the bearer.", [], "deck.pair") };
	const got = built.callers.login(label);
	return { status: 200, body: { ok: true, value: { token: got.token, name: got.who.name }, notes: [] } };
}

function parsed(body: Buffer): Record<string, unknown> | undefined {
	if (body.length === 0) return {};
	try {
		const value: unknown = JSON.parse(body.toString("utf8"));
		return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

async function bodyOf(req: IncomingMessage): Promise<Buffer> {
	const parts: Buffer[] = [];
	let size = 0;
	for await (const chunk of req as AsyncIterable<Buffer>) {
		size += chunk.length;
		if (size > LIMIT) throw new Error("The body is over 32 MB.");
		parts.push(chunk);
	}
	return Buffer.concat(parts);
}

// Feature routes.
function routeFor(routes: RouteOf[], method: string, path: string): RouteOf | undefined {
	const fits = routes.filter(({ route }) => (route.method === method || route.method === "ANY") && path.startsWith(route.prefix));
	return fits.sort((a, b) => b.route.prefix.length - a.route.prefix.length)[0];
}

async function serveRoute(built: Built, found: RouteOf, caller: Caller, req: IncomingMessage, res: ServerResponse): Promise<void> {
	const ctx = built.router.context(found.feature, caller, []);
	if (found.route.serve) return found.route.serve(ctx, req, res);
	const url = new URL(req.url ?? "/", "http://decks.local");
	if (!found.route.answer) return json(res, 404, fail("not_found", `Nothing is served at ${url.pathname}.`, []));
	const answer = await found.route.answer(ctx, url.pathname, url.searchParams, new Uint8Array(await bodyOf(req)));
	res.writeHead(answer.status ?? 200, { "content-type": answer.type, ...(answer.headers ?? {}) });
	res.end(typeof answer.body === "string" ? answer.body : Buffer.from(answer.body));
}

// Upgrades: the socket door, or the feature route whose prefix holds the path.
/** Sends each upgrade to its door, and keeps the sockets so close can end them. */
function upgrades(built: Built, lines: Set<Duplex>) {
	const routes = built.features.flatMap((feature) => (feature.routes ?? []).filter((route) => route.upgrade));
	return (req: IncomingMessage, socket: Duplex, head: Buffer) => {
		lines.add(socket);
		socket.on("close", () => lines.delete(socket));
		const path = new URL(req.url ?? "/", "http://decks.local").pathname;
		const peer = path === SOCKET_PATH ? accept(req, socket) : undefined;
		if (peer) return socketDoor(built, peer);
		const route = routes.filter((one) => path.startsWith(one.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
		if (route?.upgrade) route.upgrade(req, socket, head, socketParts(built, req, socket));
		else socket.destroy();
	};
}

