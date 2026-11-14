import { randomUUID } from "node:crypto";
import { compatible, PROTOCOL_VERSION, type Caller } from "../../../protocol/index.ts";
import type { Built } from "../kernel.ts";
import type { Client, Stop } from "../types.ts";
import type { Peer } from "./ws.ts";

// The socket door, /api/v1/socket: hello first with a token and the client's
// protocol, then calls up and events down. The token is resolved again on
// every call, so a revoked or deleted caller is cut off at once.

const CLOSED_NO_HELLO = 4401;

export function socketDoor(built: Built, peer: Peer): void {
	const closers = new Set<() => void>();
	const client: Client = { id: `socket-${randomUUID()}`, closed: (on) => (closers.add(on), () => void closers.delete(on)) };
	let token: string | undefined;
	let watching: Stop | undefined;
	const timer = setTimeout(() => token === undefined && peer.close(CLOSED_NO_HELLO, "hello first, with a token"), 10_000);
	const who = (): Caller | undefined => {
		const caller = built.callers.resolve(token);
		if (!caller) peer.close(CLOSED_NO_HELLO, "the token is not good, or no longer");
		return caller;
	};
	const send = (message: unknown) => peer.send(JSON.stringify(message));
	peer.onText((text) => {
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(text) as Record<string, unknown>;
		} catch {
			return peer.close(1007, "every message is JSON");
		}
		if (token === undefined) return hello(message);
		const caller = who();
		if (!caller) return;
		if (message.type === "call") void built.router.call(String(message.name), message.args ?? {}, caller, client).then((envelope) => send({ type: "answer", id: message.id, envelope }));
		if (message.type === "watch") {
			watching?.();
			const events = Array.isArray(message.events) ? message.events.map(String) : undefined;
			const canvas = typeof message.canvas === "string" ? message.canvas : undefined;
			watching = built.events.subscribe({ caller, client: client.id, ...(events ? { events } : {}), ...(canvas ? { canvas } : {}) }, (heard) => {
				if (built.callers.resolve(token)) send({ type: "event", name: heard.name, payload: heard.payload });
			});
		}
	});
	const hello = (message: Record<string, unknown>) => {
		const caller = message.type === "hello" ? built.callers.resolve(String(message.token)) : undefined;
		if (!caller) return peer.close(CLOSED_NO_HELLO, "hello first, with a good token");
		if (!compatible(String(message.protocol ?? ""), PROTOCOL_VERSION)) return peer.close(4400, `this server speaks protocol ${PROTOCOL_VERSION}`);
		token = String(message.token);
		clearTimeout(timer);
		send({ type: "hello", protocol: PROTOCOL_VERSION, caller });
	};
	peer.onClose(() => {
		clearTimeout(timer);
		watching?.();
		for (const on of closers) on();
	});
}
