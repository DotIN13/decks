import type { Store } from "../kernel/types.ts";
import type { LiveLink, Transport } from "./client/transport.ts";
import { Live, type LiveSocket } from "./hub/live.ts";
import { hubRoutes } from "./hub/routes.ts";
import { MemoryHub, type Who } from "./hub/store.ts";

// For tests: a private store in memory, and a Studio in memory that the
// client reaches through a Transport, with no network.

export function memoryStore(): Store & { kept: Map<string, Uint8Array> } {
	const kept = new Map<string, Uint8Array>();
	return {
		kept,
		get: async (key) => kept.get(key)?.slice(),
		put: async (key, bytes) => void kept.set(key, bytes.slice()),
		delete: async (key) => void kept.delete(key),
		keys: async (prefix = "") => [...kept.keys()].filter((k) => k.startsWith(prefix)).sort(),
	};
}

export type Gate = (req: Request) => Response | undefined | Promise<Response | undefined>;

/** A Studio in memory: its hub, its live socket, the keys it takes, and a transport onto it. */
export function memoryStudio(gate?: Gate) {
	const hub = new MemoryHub();
	const live = new Live(hub);
	const keys = new Map<string, Who>();
	const keyOf = (req: Request) => req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
	const routes = hubRoutes({ hub, live, who: (req) => keys.get(keyOf(req)) });
	const transport: Transport = {
		fetch: async (req) => (await gate?.(req)) ?? (await routes(req)) ?? new Response("{}", { status: 404 }),
		live: (_url, key) => link(live, keys.get(key)),
	};
	return { hub, live, keys, transport, url: "https://studio.test" };
}

/** Both ends of a socket in memory: the hub's LiveSocket and the client's LiveLink. */
function link(live: Live, who: Who | undefined): LiveLink {
	const toClient: ((text: string) => void)[] = [];
	const clientClosed: ((code: number, reason: string) => void)[] = [];
	const toHub: ((data: unknown) => void)[] = [];
	const hubClosed: (() => void)[] = [];
	const socket: LiveSocket = {
		send: (text) => queueMicrotask(() => toClient.forEach((hear) => hear(text))),
		close: (code = 1000, reason = "") => queueMicrotask(() => (clientClosed.forEach((hear) => hear(code, reason)), hubClosed.forEach((hear) => hear()))),
		on: ((event: string, hear: never) => void (event === "message" ? toHub.push(hear) : hubClosed.push(hear))) as LiveSocket["on"],
	};
	const ends: LiveLink = {
		send: (text) => queueMicrotask(() => toHub.forEach((hear) => hear(text))),
		close: () => hubClosed.forEach((hear) => hear()),
		onMessage: (hear) => void toClient.push(hear),
		onClose: (hear) => void clientClosed.push(hear),
	};
	if (who) queueMicrotask(() => live.add(socket, who));
	else queueMicrotask(() => clientClosed.forEach((hear) => hear(4001, "revoked")));
	return ends;
}
