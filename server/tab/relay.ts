import type { Route } from "../kernel/types.ts";
import type { TabHub } from "./hub.ts";

// The address the Decks extension dials: /api/web/relay?code=<code>. Rule 1
// and 2 of the README: a wrong code is refused before the line opens.

export const RELAY_PATH = "/api/web/relay";

/** The route that takes the extension's socket and hands it to the hub. */
export function relayRoute(hub: TabHub): Route {
	return {
		method: "GET",
		prefix: RELAY_PATH,
		upgrade(req, socket, _head, door) {
			const code = new URL(req.url ?? "/", "http://decks.local").searchParams.get("code");
			if (!hub.allows(code)) return void socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nThe pairing code is wrong.");
			const line = door.accept();
			if (line) hub.connect(code, line);
			else socket.destroy();
		},
	};
}
