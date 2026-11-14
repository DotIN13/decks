import { request, type IncomingMessage, type ServerResponse } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import type { RouteAnswer } from "../kernel/index.ts";

// A request passed on to a local port, streamed both ways, on a connection of
// its own that closes when it ends, with a 60 s limit: a proxy keeps no socket.
// Decks's own token never reaches the app.

const PROXY_MS = 60_000;
const DROP = new Set(["authorization", "cookie", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "host"]);

/** The request's headers as the app should see them. */
export function headersFor(req: IncomingMessage, base: string): Record<string, string | string[]> {
	const out: Record<string, string | string[]> = {};
	for (const [key, value] of Object.entries(req.headers)) if (value !== undefined && !DROP.has(key) && !key.startsWith("x-decks-")) out[key] = value;
	out.connection = "close";
	if (base) out["x-forwarded-prefix"] = base;
	return out;
}

/** The address a request passes on, with ?pass= taken off. */
export function withoutPass(path: string, search: string): string {
	const query = new URLSearchParams(search);
	query.delete("pass");
	return `${path}${query.size ? `?${query}` : ""}`;
}

/** A redirect from the app to its own root, put back under its address on Decks. */
export function underBase(location: string | undefined, base: string): string | undefined {
	if (!location || !base || !location.startsWith("/") || location.startsWith("//") || location.startsWith(base)) return location;
	return `${base}${location}`;
}

export function pipeTo(req: IncomingMessage, res: ServerResponse, port: number, path: string, base: string): Promise<void> {
	return new Promise((done) => {
		const upstream = request({ host: "127.0.0.1", port, method: req.method, path, headers: headersFor(req, base), agent: false, timeout: PROXY_MS }, (answer) => {
			const headers = { ...answer.headers };
			delete headers.connection;
			delete headers["keep-alive"];
			const location = underBase(typeof headers.location === "string" ? headers.location : undefined, base);
			if (location) headers.location = location;
			res.writeHead(answer.statusCode ?? 502, headers);
			answer.pipe(res);
			answer.on("end", () => done());
			answer.on("error", () => (res.destroy(), done()));
		});
		upstream.on("timeout", () => upstream.destroy(new Error(`no answer in ${PROXY_MS / 1000} s`)));
		upstream.on("error", (error) => {
			if (res.headersSent) res.destroy();
			else res.writeHead(502, { "content-type": "text/plain; charset=utf-8" }).end(`Nothing answered on port ${port}: ${error.message}`);
			done();
		});
		res.on("close", () => upstream.destroy());
		req.pipe(upstream);
	});
}

/** A WebSocket or other upgrade passed on as raw bytes; either side closing closes both. */
export function upgradeTo(req: IncomingMessage, socket: Duplex, head: Buffer, port: number, path: string, base: string): void {
	const upstream = connect(port, "127.0.0.1", () => {
		const lines = [`${req.method ?? "GET"} ${path} HTTP/1.1`, `host: 127.0.0.1:${port}`, "connection: Upgrade", `upgrade: ${req.headers.upgrade ?? "websocket"}`];
		for (const [name, value] of Object.entries(headersFor(req, base))) {
			if (name === "connection") continue;
			for (const one of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${one}`);
		}
		upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
		if (head.length) upstream.write(head);
		upstream.pipe(socket);
		socket.pipe(upstream);
	});
	const end = () => {
		upstream.destroy();
		socket.destroy();
	};
	upstream.on("error", end);
	socket.on("error", end);
	upstream.on("close", end);
	socket.on("close", end);
}

/** Write a buffered answer to a raw response. */
export function send(res: ServerResponse, answer: RouteAnswer): void {
	res.writeHead(answer.status ?? 200, { "content-type": answer.type, ...(answer.headers ?? {}) });
	res.end(typeof answer.body === "string" ? answer.body : Buffer.from(answer.body));
}
