import { PROTOCOL_VERSION, SOCKET_PATH, type ClientMessage, type ServerMessage } from "@decks/protocol";

// The frame's socket to the server on the protocol (`protocol/wire.ts`): hello with the canvas pass, then
// calls answered in their envelope and the watched canvas's events, coming back a little later after a drop.

/** A call's answer: the value and its notes, or a refusal. */
export type Answered = { ok: true; value: unknown; notes: string[] } | { ok: false; error: { code: string; message: string; hint?: string }; notes: string[] };

interface SocketOptions {
	/** The server's origin as the frame reaches it (`http://host:4329`). */
	origin: string;
	/** The canvas pass now: said in every hello, so a renewed one is what the next connection says. */
	token: () => string;
	/** The canvas whose events this socket hears. */
	canvas: string;
	/** An event on the watched canvas. */
	hear: (name: string, payload: Record<string, unknown>) => void;
	/** The socket said hello (`again` after a drop), or closed. */
	onState?: (open: boolean, again: boolean) => void;
}

export interface FrameSocket {
	/** One call by its protocol name, answered once; a socket that drops first answers a refusal. */
	call(name: string, args: Record<string, unknown>): Promise<Answered>;
	/** A renewed pass: the socket says hello again on it. */
	renew(): void;
	stop(): void;
	open(): boolean;
}

/**
 * Opens as it is made. Calls made while it is down wait for its hello; a call on the socket when it
 * drops is answered with a refusal, never sent again, since the server may have made it.
 */
export function openSocket(options: SocketOptions): FrameSocket {
	const url = new URL(SOCKET_PATH, options.origin);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	let socket: WebSocket | undefined;
	let ready = false;
	let everOpen = false;
	let stopped = false;
	let wait = 500;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let nextId = 0;
	/** A renewed pass waiting for the calls on their way: the socket says hello again once they are answered. */
	let renewing = false;
	const queue: ClientMessage[] = [];
	const pending = new Map<string, (answer: Answered) => void>();
	const send = (message: ClientMessage) => {
		if (socket && ready) socket.send(JSON.stringify(message));
		else queue.push(message);
	};
	const connect = () => {
		timer = undefined;
		if (stopped) return;
		const ws = new WebSocket(url);
		socket = ws;
		ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token: options.token(), protocol: PROTOCOL_VERSION } satisfies ClientMessage));
		ws.onmessage = (event) => {
			const message = parsed(String(event.data));
			if (!message) return;
			if (message.type === "hello") {
				ready = true;
				wait = 500;
				ws.send(JSON.stringify({ type: "watch", canvas: options.canvas } satisfies ClientMessage));
				options.onState?.(true, everOpen);
				everOpen = true;
				while (queue.length) ws.send(JSON.stringify(queue.shift()));
			} else if (message.type === "answer") {
				const done = pending.get(message.id);
				pending.delete(message.id);
				done?.(message.envelope as Answered);
				if (renewing && pending.size === 0) {
					renewing = false;
					ws.close(1000, "a renewed pass");
				}
			} else if (message.type === "event") options.hear(message.name, (message.payload ?? {}) as Record<string, unknown>);
		};
		ws.onclose = (event) => {
			if (socket === ws) socket = undefined;
			ready = false;
			options.onState?.(false, everOpen);
			for (const done of pending.values()) done({ ok: false, error: { code: "unavailable", message: `The socket to the server dropped${event.reason ? `: ${event.reason}` : ""}.` }, notes: [] });
			pending.clear();
			if (stopped) return;
			timer = setTimeout(connect, wait);
			wait = Math.min(wait * 2, 10_000);
		};
		ws.onerror = () => ws.close();
	};
	connect();
	return {
		call(name, args) {
			const id = `c${(nextId += 1).toString(36)}`;
			return new Promise<Answered>((resolve) => {
				pending.set(id, resolve);
				send({ type: "call", id, name, args });
			});
		},
		renew() {
			// The server stops telling events once the old pass runs out: say hello again on the new one.
			if (pending.size) renewing = true;
			else socket?.close(1000, "a renewed pass");
		},
		stop() {
			stopped = true;
			clearTimeout(timer);
			socket?.close();
		},
		open: () => ready,
	};
}

/** A message from the server, or nothing for what is not one. */
function parsed(text: string): ServerMessage | undefined {
	try {
		const message = JSON.parse(text) as ServerMessage;
		return message && typeof message === "object" && typeof message.type === "string" ? message : undefined;
	} catch {
		return undefined;
	}
}
