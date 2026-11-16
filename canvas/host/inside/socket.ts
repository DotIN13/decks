import { PROTOCOL_VERSION, SOCKET_PATH, type ClientMessage, type ServerMessage } from "@decks/protocol";

// The frame's socket to the server on the protocol (`protocol/wire.ts`): hello with the canvas pass, then
// calls answered in their envelope and the watched canvas's events, coming back after a drop to catch up
// from the revision held, and taking a renewed pass on the open socket.

/** A call's answer: the value and its notes, or a refusal. */
export type Answered = { ok: true; value: unknown; notes: string[] } | { ok: false; error: { code: string; message: string; hint?: string }; notes: string[] };

interface SocketOptions {
	/** The server's origin as the frame reaches it (`http://host:4329`). */
	origin: string;
	/** The canvas pass now: said in every hello, so a renewed one is what the next connection says. */
	token: () => string;
	/** The canvas whose events this socket hears. */
	canvas: string;
	/** The revision held, when there is one: a watch after a drop replays what came after it. */
	since?: () => number | undefined;
	/** The events the frame hears: the watch asks for these alone, not every event the pass may see. */
	events: readonly string[];
	/** An event on the watched canvas. */
	hear: (name: string, payload: Record<string, unknown>) => void;
	/** The socket said hello (`again` after a drop), or closed. */
	onState?: (open: boolean, again: boolean) => void;
}

export interface FrameSocket {
	/** One call by its protocol name, answered once; a socket that drops first answers a refusal. */
	call(name: string, args: Record<string, unknown>): Promise<Answered>;
	/** A renewed pass: said on the open socket, so nothing is closed or missed. */
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
	/** The watch is said once per connection, after its first hello. */
	let watching = false;
	let everOpen = false;
	let stopped = false;
	let wait = 500;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let nextId = 0;
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
				// The hello a renewed pass is answered with changes nothing else.
				if (watching) return;
				watching = true;
				const since = options.since?.();
				ws.send(JSON.stringify({ type: "watch", canvas: options.canvas, events: [...options.events], ...(since !== undefined && since >= 0 ? { since } : {}) } satisfies ClientMessage));
				options.onState?.(true, everOpen);
				everOpen = true;
				while (queue.length) ws.send(JSON.stringify(queue.shift()));
			} else if (message.type === "answer") {
				const done = pending.get(message.id);
				pending.delete(message.id);
				done?.(message.envelope as Answered);
			} else if (message.type === "event") options.hear(message.name, (message.payload ?? {}) as Record<string, unknown>);
		};
		ws.onclose = (event) => {
			if (socket === ws) socket = undefined;
			ready = false;
			watching = false;
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
			// The server stops telling events once the old pass runs out; a socket not open says the new one in its hello.
			if (socket && ready) socket.send(JSON.stringify({ type: "token", token: options.token() } satisfies ClientMessage));
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
