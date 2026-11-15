import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { API, CALL_BY_NAME, check, LOGIN_PATH, PROTOCOL_VERSION, Refused, SOCKET_PATH } from "../../../protocol/index.ts";

// A small server that speaks the wire, a test double for the clients' tests:
// it checks each call's arguments against the protocol, answers with the
// handlers given, and refuses the rest as unavailable.

export type FakeHandler = (args: Record<string, unknown>, token: string | undefined) => unknown;
export type Fake = { url: string; token: string; calls: { name: string; args: unknown; token?: string }[]; emit(name: string, payload: unknown): void; close(): Promise<void> };

export async function fakeServer(port: number, handlers: Record<string, FakeHandler> = {}): Promise<Fake> {
	const token = "test-token";
	const calls: Fake["calls"] = [];
	const sockets = new Set<Duplex>();
	const server: Server = createServer(async (req, res) => {
		const body = await read(req);
		const bearer = req.headers.authorization?.replace(/^Bearer /, "");
		res.setHeader("content-type", "application/json");
		if (req.url === LOGIN_PATH) return res.end(JSON.stringify({ token, name: "fake" }));
		const name = (req.url ?? "").slice(API.length + 1);
		const args = body ? JSON.parse(body) : {};
		calls.push({ name, args, ...(bearer ? { token: bearer } : {}) });
		res.end(JSON.stringify(envelope(name, args, bearer, handlers, token)));
	});
	server.on("upgrade", (req, socket) => {
		if (req.url !== SOCKET_PATH) return socket.destroy();
		const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
		socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
		socket.on("data", (chunk: Buffer) => {
			for (const text of texts(chunk)) {
				if (text === null) {
					socket.end(Buffer.from([0x88, 0]));
					continue;
				}
				const message = JSON.parse(text) as { type: string; token?: string };
				if (message.type === "hello" && message.token === token) {
					sockets.add(socket);
					socket.write(frame(JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION, caller: { kind: "person", id: "p", name: "Person" } })));
				}
			}
		});
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", () => sockets.delete(socket));
	});
	await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
	const emit = (name: string, payload: unknown) => {
		for (const socket of sockets) socket.write(frame(JSON.stringify({ type: "event", name, payload })));
	};
	const close = () =>
		new Promise<void>((resolve) => {
			for (const socket of sockets) socket.destroy();
			server.close(() => resolve());
			server.closeAllConnections();
		});
	return { url: `http://127.0.0.1:${port}`, token, calls, emit, close };
}

const read = (req: IncomingMessage) =>
	new Promise<string>((resolve) => {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", () => resolve(body));
	});

function envelope(name: string, args: unknown, token: string | undefined, handlers: Record<string, FakeHandler>, known: string): object {
	const call = CALL_BY_NAME.get(name);
	if (!call) return { ok: false, error: { code: "not_found", message: `There is no call named ${name}.`, hint: "deck.get" }, notes: [] };
	if (token !== known) return { ok: false, error: { code: "refused", message: "That token is not one this server gave.", hint: "agent.attach" }, notes: [] };
	const problems = check(call.input, args);
	if (problems.length) return { ok: false, error: { code: "invalid", message: problems.join(" "), hint: name }, notes: [] };
	const handler = handlers[name];
	if (!handler) return { ok: false, error: { code: "unavailable", message: `${name} is not handled here yet.` }, notes: [] };
	try {
		return { ok: true, value: handler(args as Record<string, unknown>, token), notes: [`${name} answered by the fake server.`] };
	} catch (error) {
		const r = error as Refused;
		return { ok: false, error: { code: r.code ?? "unavailable", message: r.message, ...(r.hint ? { hint: r.hint } : {}) }, notes: [] };
	}
}

/** A text frame from server to client, unmasked. */
function frame(text: string): Buffer {
	const data = Buffer.from(text);
	const head = data.length < 126 ? Buffer.from([0x81, data.length]) : Buffer.from([0x81, 126, data.length >> 8, data.length & 255]);
	return Buffer.concat([head, data]);
}

/** The text of each whole client frame in a chunk (masked, under 64 KB); null for a close. */
function texts(chunk: Buffer): (string | null)[] {
	const out: (string | null)[] = [];
	for (let at = 0; at + 2 <= chunk.length; ) {
		let length = chunk[at + 1]! & 127;
		let start = at + 2;
		if (length === 126) [length, start] = [chunk.readUInt16BE(at + 2), at + 4];
		const mask = chunk.subarray(start, start + 4);
		const data = chunk.subarray(start + 4, start + 4 + length).map((b, i) => b ^ mask[i % 4]!);
		if ((chunk[at]! & 15) === 1) out.push(Buffer.from(data).toString());
		if ((chunk[at]! & 15) === 8) out.push(null);
		at = start + 4 + length;
	}
	return out;
}
