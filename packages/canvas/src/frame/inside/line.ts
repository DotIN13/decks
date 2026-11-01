import type { LineClientMessage, ServerMessage } from "@decks/protocol";

/** The answer to one `call` on the line, as the SDK reads it. */
export type LineAnswer = { ok: boolean; value?: unknown; error?: string; notes?: string[] };

export interface LineOptions {
	/** The harness's `/api` address as the frame reaches it (`http://host:4329/api`). */
	api: string;
	/** The token now: read at every `hello`, so a renewed one is what the next connection says. */
	token: () => string;
	/** What to watch, and from which revision, said in each `hello`: on a reconnect, what was missed comes back as `canvas.changed`. */
	watch: () => Array<{ canvas: string; since?: number }>;
	/** Every message the line brings that is not the answer to a call. */
	hear: (message: ServerMessage) => void;
	/** The line opened (`again` after a drop) or closed. */
	onState?: (open: boolean, again: boolean) => void;
}

export interface LineClient {
	/** A message with no answer, sent now or when the line opens. */
	send(message: LineClientMessage): void;
	/** One verb, answered once; a line that drops first answers with an error. */
	call(verb: string, args: readonly unknown[], edit?: string): Promise<LineAnswer>;
	/** A renewed token: said on the line now, and in every `hello` from here on. */
	setToken(token: string): void;
	/** Close the line for good. */
	stop(): void;
	/** Whether the line is open now. */
	open(): boolean;
}

/**
 * The frame's end of the line (`server/src/line.ts`): one WebSocket to `/api/v1/socket` that carries
 * the frame's calls, the canvas's changes and the frame's own messages, in one envelope. It opens as
 * it is made, says `hello` with the token and what it watches, and comes back after a drop a little
 * later each time (0.5 s to 10 s); messages sent while it is down wait for it. Calls carry an `id` and
 * are answered once under it (`answer`); a call on the line when it drops is answered with an error,
 * never sent again, since the harness may have taken it.
 */
export function openLine(options: LineOptions): LineClient {
	const url = new URL(`${options.api.replace(/\/+$/, "")}/v1/socket`);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	let socket: WebSocket | undefined;
	let stopped = false;
	let wait = 500;
	let everOpen = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const queue: LineClientMessage[] = [];
	const pending = new Map<string, (answer: LineAnswer) => void>();
	let nextId = 0;

	const connect = () => {
		if (stopped) return;
		const ws = new WebSocket(url);
		socket = ws;
		ws.onopen = () => {
			wait = 500;
			ws.send(JSON.stringify({ type: "hello", token: options.token(), watch: options.watch() } satisfies LineClientMessage));
			options.onState?.(true, everOpen);
			everOpen = true;
			while (queue.length) ws.send(JSON.stringify(queue.shift()));
		};
		ws.onmessage = (event) => {
			let message: ServerMessage;
			try {
				message = JSON.parse(String(event.data)) as ServerMessage;
			} catch {
				return;
			}
			if (message.type === "answer") {
				const done = pending.get(message.id);
				pending.delete(message.id);
				done?.({ ok: message.ok, ...(message.value !== undefined ? { value: message.value } : {}), ...(message.error ? { error: message.error } : {}), ...(message.notes ? { notes: message.notes } : {}) });
				return;
			}
			options.hear(message);
		};
		ws.onclose = (event) => {
			if (socket === ws) socket = undefined;
			options.onState?.(false, everOpen);
			for (const done of pending.values()) done({ ok: false, error: `The line to the harness dropped${event.reason ? `: ${event.reason}` : ""}.` });
			pending.clear();
			if (stopped) return;
			// 4401: the token does not open the line; said again with the token as it is now, a little later.
			timer = setTimeout(connect, wait);
			wait = Math.min(wait * 2, 10_000);
		};
		ws.onerror = () => ws.close();
	};
	const ensure = () => {
		if (!socket && !stopped && timer === undefined) connect();
	};
	const send = (message: LineClientMessage) => {
		ensure();
		if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
		else queue.push(message);
	};
	/*
	 * Opened now, not at the first message: a frame on a canvas with nothing on it has nothing to say
	 * (no card to report seen or sized), and a line opened only by a message would never carry the
	 * canvas's changes to it; what an agent put there showed only after a reload.
	 */
	ensure();

	return {
		send,
		call(verb, args, edit) {
			const id = `c${(nextId += 1).toString(36)}`;
			return new Promise<LineAnswer>((resolve) => {
				pending.set(id, resolve);
				send({ type: "call", id, verb, args: [...args], ...(edit ? { edit } : {}) });
			});
		},
		setToken(token) {
			if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "token", token } satisfies LineClientMessage));
		},
		stop() {
			stopped = true;
			clearTimeout(timer);
			socket?.close();
		},
		open: () => socket?.readyState === WebSocket.OPEN,
	};
}
