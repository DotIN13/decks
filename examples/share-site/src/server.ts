import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Live, MemoryStore, syncHandler, type HubStore, type Who } from "@decks/hub";
import { nodeHandler } from "@decks/hub/node";
import { LIVE_BOARD_HEADERS, libFile } from "@decks/board-host";
import { WebSocketServer } from "ws";

/**
 * The whole server. People and harnesses are known by a key each; a real site has accounts and
 * signs people in, and only `who` below changes. Every canvas route is the hub's.
 */
export interface SiteOptions {
	/** Each person by their key: `{ "ada-key": { id: "ada", name: "Ada" } }`. */
	people: Record<string, { id: string; name: string }>;
	/** Each harness by its key, and whose it is: `{ "ada-mini": { person: "ada", name: "Mac mini" } }`. */
	harnesses?: Record<string, { person: string; name: string }>;
	/** Where canvases are kept. Default: in memory, gone on restart. */
	store?: HubStore;
	/** Everyone sees every canvas, as owner of their own and editor of the rest. Default: true. */
	everyoneEdits?: boolean;
}

export async function startSite(o: SiteOptions, port = 0): Promise<{ server: Server; url: string; store: HubStore; live: Live; close(): void }> {
	const memory = new MemoryStore();
	const store = o.store ?? memory;
	const live = new Live(store);
	const people = new Map(Object.entries(o.people));
	const harnesses = new Map(Object.entries(o.harnesses ?? {}));
	for (const p of people.values()) memory.name(p.id, p.name);

	/** Who a key is: a person, or a person through one of their harnesses. */
	const whoByKey = (key: string | null | undefined): Who | undefined => {
		if (!key) return undefined;
		const person = people.get(key);
		if (person) return { user: person };
		const h = harnesses.get(key);
		const owner = h && [...people.values()].find((p) => p.id === h.person);
		return h && owner ? { user: owner, harness: { id: key, name: h.name } } : undefined;
	};
	const bearer = (value: string | null | undefined) => value?.replace(/^Bearer\s+/i, "") ?? undefined;

	// In this example everyone may edit everyone's canvases: a new canvas is shared with all.
	if (o.everyoneEdits !== false && store === memory) {
		const create = memory.createCanvas.bind(memory);
		memory.createCanvas = (owner, title, name, pen) => {
			const c = create(owner, title, name, pen);
			for (const p of people.values()) if (p.id !== owner) memory.share(c.id, p.id, "edit");
			return c;
		};
	}

	const sync = nodeHandler(syncHandler({ store, live, harnessesOnly: false, who: (req) => whoByKey(bearer(req.headers.get("authorization"))) }));
	const server = createServer(async (req, res) => {
		try {
			if (await sync(req, res)) return;
			// The board runtime, for boards on the canvas (`../lib/board.css`).
			if (req.url?.startsWith("/lib/")) {
				const f = libFile(decodeURIComponent(req.url.slice(5).split("?")[0]!));
				if (f) return res.writeHead(200, { ...LIVE_BOARD_HEADERS, "Content-Type": f.type }).end(f.bytes);
			}
			res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Not found." }));
		} catch (e) {
			res.writeHead(500).end(String(e));
		}
	});
	// The live socket: a harness sends its key as a header, a page in the address (a browser cannot set headers on a socket).
	const wss = new WebSocketServer({ noServer: true });
	server.on("upgrade", (req, socket, head) => {
		const url = new URL(req.url ?? "/", "http://site");
		const who = url.pathname === "/sync/v1/live" ? whoByKey(bearer(req.headers.authorization) ?? url.searchParams.get("key")) : undefined;
		if (!who) return socket.destroy();
		wss.handleUpgrade(req, socket, head, (ws) => live.add(ws, who));
	});
	await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return { server, url, store, live, close: () => (server.closeAllConnections(), server.close()) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const pairs = (text: string | undefined, fallback: string) => (text ?? fallback).split(",").map((p) => p.split(":"));
	const people = Object.fromEntries(pairs(process.env.PEOPLE, "ada-key:ada:Ada,bob-key:bob:Bob").map(([key, id, name]) => [key!, { id: id!, name: name ?? id! }]));
	const harnesses = Object.fromEntries(pairs(process.env.HARNESSES, "ada-mini:ada:Mac mini").map(([key, person, name]) => [key!, { person: person!, name: name ?? key! }]));
	const site = await startSite({ people, harnesses }, Number(process.env.PORT ?? 4900));
	console.log(`share-site on ${site.url}: people ${Object.keys(people).join(", ")}; harnesses ${Object.keys(harnesses).join(", ")}`);
}
