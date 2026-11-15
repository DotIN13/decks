import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Peer } from "../types.ts";

// A small WebSocket server side (RFC 6455): the handshake, text frames in
// and out, ping, close. Enough for JSON messages; no extensions. A frame
// over 16 MB closes the connection.

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const MAX = 16 * 1024 * 1024;

export type { Peer } from "../types.ts";

type Parsed = { fin: boolean; opcode: number; payload: Buffer; used: number };

/** Answer the upgrade; undefined if the request is not a WebSocket one. */
export function accept(req: IncomingMessage, socket: Duplex): Peer | undefined {
	const key = req.headers["sec-websocket-key"];
	if (typeof key !== "string" || String(req.headers.upgrade).toLowerCase() !== "websocket") return undefined;
	const answer = createHash("sha1").update(key + GUID).digest("base64");
	socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${answer}\r\n\r\n`);
	return peerOn(socket);
}

function peerOn(socket: Duplex): Peer {
	let buffered = Buffer.alloc(0);
	let parts: Buffer[] = [];
	let open = true;
	const texts: ((text: string) => void)[] = [];
	const closes: (() => void)[] = [];
	const close = (code = 1000, reason = "") => {
		if (!open) return;
		open = false;
		const body = Buffer.alloc(2 + Buffer.byteLength(reason));
		body.writeUInt16BE(code, 0);
		body.write(reason, 2);
		socket.end(frame(8, body));
	};
	const handle = (one: Parsed) => {
		if (one.opcode === 8) return close();
		if (one.opcode === 9) return void socket.write(frame(10, one.payload));
		if (one.opcode !== 1 && one.opcode !== 0) return;
		parts.push(one.payload);
		if (!one.fin) return;
		const text = Buffer.concat(parts).toString("utf8");
		parts = [];
		for (const hear of texts) hear(text);
	};
	socket.on("data", (chunk: Buffer) => {
		buffered = Buffer.concat([buffered, chunk]);
		for (let one = parse(buffered); one; one = parse(buffered)) {
			if (one === "too big") return close(1009, "too big");
			buffered = buffered.subarray(one.used);
			handle(one);
		}
	});
	socket.on("close", () => {
		open = false;
		for (const hear of closes) hear();
	});
	socket.on("error", () => socket.destroy());
	return {
		send: (text) => void (open && socket.write(frame(1, Buffer.from(text, "utf8")))),
		close,
		onText: (hear) => void texts.push(hear),
		onClose: (hear) => void closes.push(hear),
	};
}

function parse(buf: Buffer): Parsed | undefined | "too big" {
	if (buf.length < 2) return undefined;
	const fin = (buf[0]! & 0x80) !== 0;
	const opcode = buf[0]! & 0x0f;
	const masked = (buf[1]! & 0x80) !== 0;
	let length = buf[1]! & 0x7f;
	let at = 2;
	if (length === 126) {
		if (buf.length < 4) return undefined;
		length = buf.readUInt16BE(2);
		at = 4;
	} else if (length === 127) {
		if (buf.length < 10) return undefined;
		length = Number(buf.readBigUInt64BE(2));
		at = 10;
	}
	if (length > MAX) return "too big";
	const mask = masked ? buf.subarray(at, at + 4) : undefined;
	at += masked ? 4 : 0;
	if (buf.length < at + length) return undefined;
	const payload = Buffer.from(buf.subarray(at, at + length));
	if (mask) for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!;
	return { fin, opcode, payload, used: at + length };
}

function frame(opcode: number, payload: Buffer): Buffer {
	const head = payload.length < 126 ? Buffer.from([0x80 | opcode, payload.length]) : payload.length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
	if (payload.length >= 126 && payload.length < 65536) {
		head[0] = 0x80 | opcode;
		head[1] = 126;
		head.writeUInt16BE(payload.length, 2);
	} else if (payload.length >= 65536) {
		head[0] = 0x80 | opcode;
		head[1] = 127;
		head.writeBigUInt64BE(BigInt(payload.length), 2);
	}
	return Buffer.concat([head, payload]);
}
