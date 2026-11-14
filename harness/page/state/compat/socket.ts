import { SOCKET_PATH } from "@decks-next/protocol";

// Today's browser checks hand the page today's socket messages by dispatching
// them on its last WebSocket. The line's socket hears only new events; this
// hears the rest of what arrives there. Goes with compat, after stop 3.

export type Old = { type: string; [key: string]: unknown };

/** Hear every message on the page's line that is not a new event or the greeting. Install before the line opens. */
export function hearOld(hear: (message: Old) => void): void {
	if (typeof window === "undefined" || typeof window.WebSocket !== "function") return;
	const Base = window.WebSocket;
	window.WebSocket = class extends Base {
		constructor(url: string | URL, protocols?: string | string[]) {
			super(url, protocols);
			if (!String(url).endsWith(SOCKET_PATH)) return;
			this.addEventListener("message", (event) => {
				const message = parse(event.data);
				if (message && message.type !== "event" && message.type !== "hello" && message.type !== "answer") hear(message);
			});
		}
	} as typeof WebSocket;
}

function parse(data: unknown): Old | undefined {
	try {
		const value = JSON.parse(String(data)) as Old;
		return value && typeof value.type === "string" ? value : undefined;
	} catch {
		return undefined;
	}
}
