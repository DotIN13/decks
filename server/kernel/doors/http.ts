import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { API, LOGIN_PATH, PROTOCOL_VERSION, SOCKET_PATH, type Caller, type Envelope, type RefusalCode } from "../../../protocol/index.ts";
import { LOCAL_PERSON } from "../callers.ts";
import type { Built } from "../kernel.ts";
import { SERVER_VERSION } from "../own-calls.ts";
import type { Route } from "../types.ts";
import { mcpAnswer, MCP_PATH } from "./mcp.ts";
import { socketDoor } from "./socket.ts";
import { accept } from "./ws.ts";

// The HTTP door: POST /api/v1/<name> with the arguments as one JSON object,
// answered with the envelope, 200 for a value or a refusal alike. The token
// is the bearer, or ?pass= for a page. No token answers 401; a browser Origin
// with no token is refused before anything else. Feature routes and /mcp too.

const LIMIT = 32 * 1024 * 1024;
export type Served = { url: string; port: number; server: Server; close(): Promise<void> };

const refusal = (code: RefusalCode, message: string, hint?: string): Envelope<never> => ({ ok: false, error: { code, message, ...(hint ? { hint } : {}) }, notes: [] });
const WHO = "Who is calling? Send a token: Authorization: Bearer <token>, from .decks/server.json or POST /api/v1/login.";
const NO_TOKEN = refusal("refused", WHO, "deck.get");

function json(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(body));
}

function tokenOf(req: IncomingMessage, url: URL): string | undefined {
	const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
	return bearer ?? url.searchParams.get("pass") ?? undefined;
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

function parsed(body: Buffer): Record<string, unknown> | undefined {
	if (body.length === 0) return {};
	try {
		const value: unknown = JSON.parse(body.toString("utf8"));
		return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

function login(built: Built, token: string | undefined, args: Record<string, unknown>): { status: number; body: Envelope<unknown> } {
	const label = typeof args.label === "string" ? args.label : undefined;
	if (typeof args.code === "string") {
		const got = built.callers.redeem(args.code, label);
		return got ? { status: 200, body: { ok: true, value: { token: got.token, name: got.who.name }, notes: [] } } : { status: 401, body: refusal("refused", "That code is wrong, spent or more than ten minutes old.", "deck.pair") };
	}
	const caller = built.callers.resolve(token);
	if (caller?.id !== LOCAL_PERSON.id) return { status: 401, body: refusal("refused", "Log in with a pairing code, or with the token in .decks/server.json as the bearer.", "deck.pair") };
	const got = built.callers.login(label);
	return { status: 200, body: { ok: true, value: { token: got.token, name: got.who.name }, notes: [] } };
}

type RouteOf = { feature: string; route: Route };

function routeFor(routes: RouteOf[], method: string, path: string): RouteOf | undefined {
	const fits = routes.filter(({ route }) => route.method === method && path.startsWith(route.prefix));
	return fits.sort((a, b) => b.route.prefix.length - a.route.prefix.length)[0];
}

async function serveRoute(built: Built, found: RouteOf, caller: Caller, url: URL, body: Buffer, res: ServerResponse): Promise<void> {
	const ctx = built.router.context(found.feature, caller, []);
	const answer = await found.route.answer(ctx, url.pathname, url.searchParams, new Uint8Array(body));
	res.writeHead(answer.status ?? 200, { "content-type": answer.type, ...(answer.headers ?? {}) });
	res.end(typeof answer.body === "string" ? answer.body : Buffer.from(answer.body));
}

export function handler(built: Built) {
	const routes: RouteOf[] = built.features.flatMap((feature) => (feature.routes ?? []).map((route) => ({ feature: feature.name, route })));
	return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
		const url = new URL(req.url ?? "/", "http://decks.local");
		const token = tokenOf(req, url);
		if (req.headers.origin && !token) return json(res, 403, refusal("refused", "A page in a browser must send a token; the origin alone says nothing."));
		const body = await bodyOf(req);
		const method = req.method ?? "GET";
		const path = url.pathname;
		if (method === "GET" && (path === API || path === `${API}/`)) return json(res, 200, { ok: true, value: { protocol: PROTOCOL_VERSION, server: SERVER_VERSION }, notes: [] });
		if (method === "POST" && path === LOGIN_PATH) {
			const args = parsed(body);
			if (!args) return json(res, 200, refusal("invalid", "The body should be one JSON object."));
			const done = login(built, token, args);
			return json(res, done.status, done.body);
		}
		const caller = built.callers.resolve(token);
		if (method === "POST" && path.startsWith(`${API}/`)) {
			const args = parsed(body);
			if (!caller) return json(res, 401, NO_TOKEN);
			if (!args) return json(res, 200, refusal("invalid", "The arguments should be one JSON object, keyed by name."));
			return json(res, 200, await built.router.call(decodeURIComponent(path.slice(API.length + 1)), args, caller));
		}
		if (method === "POST" && path === MCP_PATH) {
			if (!caller) return json(res, 401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: WHO } });
			const answer = await mcpAnswer(built, caller, parsed(body) ?? {});
			if (!answer) return void res.writeHead(202).end();
			return json(res, 200, answer);
		}
		const found = routeFor(routes, method, path);
		if (found && !caller) return json(res, 401, NO_TOKEN);
		if (found && caller) return serveRoute(built, found, caller, url, body, res);
		return json(res, 404, refusal("not_found", `Nothing is served at ${path}.`, "deck.get"));
	};
}

/** Serve the doors on a port; a port in use fails with a sentence, not a crash. */
export function listen(built: Built, port: number, host = "127.0.0.1"): Promise<Served> {
	const serve = handler(built);
	const server = createServer((req, res) => {
		serve(req, res).catch((error: Error) => {
			if (!res.headersSent) json(res, 200, refusal("unavailable", `The server failed: ${error.message}`));
			else res.destroy();
		});
	});
	server.on("upgrade", (req, socket) => {
		const peer = new URL(req.url ?? "/", "http://decks.local").pathname === SOCKET_PATH ? accept(req, socket) : undefined;
		if (peer) socketDoor(built, peer);
		else socket.destroy();
	});
	return new Promise((done, fail) => {
		server.once("error", (error: NodeJS.ErrnoException) => fail(new Error(error.code === "EADDRINUSE" ? `Port ${port} is in use; is another server running there?` : error.message)));
		server.listen(port, host, () => {
			const at = server.address();
			const real = typeof at === "object" && at ? at.port : port;
			const close = () => new Promise<void>((closed) => (server.closeAllConnections(), server.close(() => closed())));
			done({ url: `http://${host}:${real}`, port: real, server, close });
		});
	});
}
