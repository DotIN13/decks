import { PROTOCOL_VERSION, SOCKET_PATH } from "../../protocol/index.ts";

// The event stream over the socket: hello, watch, then one event a message.
// Uses the platform's WebSocket, in node 22 and later and in a browser.

export type Heard = { name: string; payload: unknown };
export type Stream = { stop(): void; done: Promise<void> };
export type Watch = { events?: string[]; canvas?: string };

/** Hear every event the caller may see, or those named, until stop(). */
export function listen(url: string, token: string, hear: (event: Heard) => void, watch: Watch = {}): Stream {
	const socket = new WebSocket(socketUrl(url));
	let finish: () => void = () => {};
	let fail: (error: Error) => void = () => {};
	const done = new Promise<void>((resolve, reject) => {
		finish = resolve;
		fail = reject;
	});
	socket.addEventListener("open", () => {
		socket.send(JSON.stringify({ type: "hello", token, protocol: PROTOCOL_VERSION }));
		socket.send(JSON.stringify({ type: "watch", ...watch }));
	});
	socket.addEventListener("message", (message) => {
		const data = JSON.parse(String(message.data)) as { type: string; name?: string; payload?: unknown };
		if (data.type === "event" && data.name) hear({ name: data.name, payload: data.payload });
	});
	socket.addEventListener("close", () => finish());
	socket.addEventListener("error", () => fail(new Error(`The socket to ${url} failed.`)));
	return { stop: () => socket.close(), done };
}

export function socketUrl(url: string): string {
	return `${url.replace(/^http/, "ws")}${SOCKET_PATH}`;
}
