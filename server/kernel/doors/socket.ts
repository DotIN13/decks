import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { compatible, EVENTS, PROTOCOL_VERSION, type Caller, type Envelope } from "../../../protocol/index.ts";
import type { Heard } from "../events.ts";
import type { Built } from "../kernel.ts";
import type { Client, SocketDoor, Stop } from "../types.ts";
import { accept, type Peer } from "./ws.ts";

// The socket door, /api/v1/socket: hello first with a token and the client's
// protocol, then calls up and events down. The token is resolved on every
// call, so a revoked caller is cut off at once; a new token may replace it.

const CLOSED_NO_HELLO = 4401;
const HARNESS_NOUNS = ["chat", "account", "runtime"];

export function socketDoor(built: Built, peer: Peer): void {
	const client = clientOf("socket");
	let token: string | undefined;
	let first: Caller | undefined;
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
		first = caller;
		clearTimeout(timer);
		client.closed(built.relay.connect(client.id, send));
		send({ type: "hello", protocol: PROTOCOL_VERSION, caller });
	};
	const renew = (next: string) => {
		const caller = built.callers.resolve(next);
		const same = caller && caller.id === first?.id && (caller.kind !== "card" || caller.canvas === first?.canvas);
		if (!caller || !same) return peer.close(4403, "the new token is not this line's caller");
		token = next;
		send({ type: "hello", protocol: PROTOCOL_VERSION, caller });
	};
	const deliver = (heard: Heard) => {
		if (built.callers.resolve(token)) send({ type: "event", name: heard.name, payload: heard.payload });
	};
	peer.onText((text) => {
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(text) as Record<string, unknown>;
		} catch {
			return peer.close(1007, "every message is JSON");
		}
		if (token === undefined) return hello(message);
		if (message.type === "token") return renew(String(message.token));
		const caller = who();
		if (!caller) return;
		if (message.type === "call") void built.router.call(String(message.name), message.args ?? {}, caller, client).then((envelope) => send({ type: "answer", id: message.id, envelope }));
		if (message.type === "reply") return built.relay.reply(client.id, String(message.id), message.envelope as Envelope<unknown>);
		if (message.type === "tell") return tell(built, caller, message);
		if (message.type === "watch") {
			watching?.();
			watching = catchUp(built, caller, client.id, message, deliver);
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

/** A watch that first replays a canvas's changes after since, then goes live, losing and doubling none. */
function catchUp(built: Built, caller: Caller, client: string, message: Record<string, unknown>, deliver: (heard: Heard) => void): Stop {
	const canvas = typeof message.canvas === "string" ? message.canvas : undefined;
	const since = typeof message.since === "number" ? message.since : undefined;
	if (canvas === undefined || since === undefined) return watch(built, caller, client, message, deliver);
	const held: Heard[] = [];
	let live = false;
	const stop = watch(built, caller, client, message, (heard) => (live ? deliver(heard) : void held.push(heard)));
	const past = replayed(built, caller, canvas, since);
	for (const one of past) deliver(one);
	const last = past.reduce((top, one) => Math.max(top, Number(one.payload.rev ?? 0)), since);
	live = true;
	for (const one of held) if (!(one.name === "item.changed" && one.payload.canvas === canvas && Number(one.payload.rev) <= last)) deliver(one);
	return stop;
}

/** The canvas's item.changed after since, as the caller may hear them; one missed when the log is short. */
function replayed(built: Built, caller: Caller, canvas: string, since: number): Heard[] {
	let answer: ReturnType<Built["replay"]>;
	try {
		answer = built.replay(canvas, since);
	} catch {
		return [];
	}
	if (!answer) return [];
	const past = "missed" in answer ? [{ canvas, ids: [], by: "server", rev: since, missed: true }] : answer;
	return past.map((payload) => ({ name: "item.changed", payload })).filter((one) => built.events.may(caller, one.name, one.payload));
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
