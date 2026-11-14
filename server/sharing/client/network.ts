import type { LiveLink, Transport } from "./transport.ts";

// The real network, for Decks-local: node's fetch, and node's WebSocket with
// Studio's key in the Authorization header, as Studio's live route asks.

type NodeSocketInit = { headers: Record<string, string> };
type NodeSocket = new (url: string, init: NodeSocketInit) => WebSocket;

export function networkTransport(): Transport {
	return {
		fetch: (req) => fetch(req),
		live: (url, key) => {
			const Socket = globalThis.WebSocket as unknown as NodeSocket;
			const ws = new Socket(url, { headers: { Authorization: `Bearer ${key}` } });
			const link: LiveLink = {
				send: (text) => ws.send(text),
				close: () => ws.close(),
				onMessage: (hear) => ws.addEventListener("message", (e) => hear(String(e.data))),
				onClose: (hear) => ws.addEventListener("close", (e) => hear(e.code, e.reason)),
			};
			return link;
		},
	};
}
