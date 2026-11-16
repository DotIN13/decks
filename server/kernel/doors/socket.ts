import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { compatible, EVENTS, PROTOCOL_VERSION, type Caller, type Envelope } from "../../../protocol/index.ts";
import type { Heard } from "../events.ts";
import type { Built } from "../kernel.ts";
import type { Client, SocketDoor, Stop } from "../types.ts";
import { accept, type Peer } from "./ws.ts";

// The socket door, /api/v1/socket: hello first with a token and the client's
// protocol, then calls up and events down. The token is resolved again on
// every call, so a revoked or deleted caller is cut off at once.

const CLOSED_NO_HELLO = 4401;
const HARNESS_NOUNS = ["chat", "account", "runtime"];

export function socketDoor(built: Built, peer: Peer): void {
	const client = clientOf("socket");
	let token: string | undefined;
	let watching: Stop | undefined;
	const timer = setTimeout(() => token === undefined && peer.close(CLOSED_NO_HELLO, "hello first, with a token"), 10_000);
	const send = (message: unknown) => peer.send(JSON.stringify(message));
	const who = (): Caller | undefined => {
		const caller = built.callers.resolve(token);
		if (!caller) peer.close(CLOSED_NO_HELLO, "the token is not good, or no longer");
		return caller;
	};
	const hello = (message: Record<string, unknown>) => {
		const caller = message.type === "hello" ? built.callers.resolve(String(message.token)) : undefined;
		if (!caller) return peer.close(CLOSED_NO_HELLO, "hello first, with a good token");
		if (!compatible(String(message.protocol ?? ""), PROTOCOL_VERSION)) return peer.close(4400, `this server speaks protocol ${PROTOCOL_VERSION}`);
		token = String(message.token);
		clearTimeout(timer);
		client.closed(built.relay.connect(client.id, send));
		send({ type: "hello", protocol: PROTOCOL_VERSION, caller });
	};
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
		if (message.type === "reply") return built.relay.reply(client.id, String(message.id), message.envelope as Envelope<unknown>);
		if (message.type === "tell") return tell(built, caller, message);
		if (message.type === "watch") {
			watching?.();
			watching = watch(built, caller, client.id, message, (heard) => {
				if (built.callers.resolve(token)) send({ type: "event", name: heard.name, payload: heard.payload });
			});
		}
	});
	peer.onClose(() => {
		clearTimeout(timer);
		watching?.();
		client.end();
	});
}

/** A watch: what this caller may hear, narrowed to some events or a canvas. */
function watch(built: Built, caller: Caller, client: string, message: Record<string, unknown>, hear: (heard: Heard) => void): Stop {
	const events = Array.isArray(message.events) ? message.events.map(String) : undefined;
	const canvas = typeof message.canvas === "string" ? message.canvas : undefined;
	return built.events.subscribe({ caller, client, ...(events ? { events } : {}), ...(canvas ? { canvas } : {}) }, hear);
}

/** A harness's own event, told on its socket: the person's only, of the harness's nouns. */
function tell(built: Built, caller: Caller, message: Record<string, unknown>): void {
	const event = EVENTS.find((one) => one.name === message.name);
	if (!event || caller.kind !== "person" || !HARNESS_NOUNS.includes(event.name.split(".")[0]!)) return;
	try {
		built.events.emit(event, message.payload as never);
	} catch {
		// A payload that does not fit its event is dropped.
	}
}

/** The kernel's socket parts, for a feature route that speaks its own line on an upgrade. */
export function socketParts(built: Built, req: IncomingMessage, socket: Duplex): SocketDoor {
	return {
		accept: () => accept(req, socket),
		resolve: (token) => built.callers.resolve(token),
		call: (name, args, caller, client) => built.router.call(name, args, caller, client),
		subscribe: (sub, hear) => built.events.subscribe(sub, hear),
		client: () => clientOf("line"),
	};
}

/** A client for one connection; end() runs whatever waited for it to close. */
function clientOf(kind: string): Client & { end(): void } {
	const closers = new Set<() => void>();
	return { id: `${kind}-${randomUUID()}`, closed: (on) => (closers.add(on), () => void closers.delete(on)), end: () => closers.forEach((on) => on()) };
}
