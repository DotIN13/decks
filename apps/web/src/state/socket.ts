import type { LineClientMessage, ServerMessage } from "@decks/protocol";
import { batch } from "solid-js";
import { BundleBackend } from "../connections/bundle.ts";
import { active, lineUrl, socketToken } from "../connections/connection.ts";
import { sessionStale } from "../lib/session.ts";

/**
 * The one connection to the harness: the line (`/api/v1/socket`), the same socket the canvas frame
 * holds, in the same envelope. Calls go up as `line.call` and come back as `call.answered` under
 * their id; everything else that arrives is an event (`names.ts`), handed to the listeners in one
 * batch per paint. The page says hello with its token and asks to be greeted and to hear everything,
 * as the tab's socket (`/ws`) greeted it; that socket stays one release for pages that still open it.
 *
 * Layer 0 of the state split, beside `selection` and `deck`: this module imports nothing from the
 * others, and most of them import it. `start()` opens it from the app's mount rather than on import,
 * so a unit test can import the module without reaching `location.host`.
 */

export type LineAnswer<T = unknown> = { ok: true; value: T; notes: string[] } | { ok: false; error: string; notes: string[] };

export interface Line {
	/** A verb, called for the person: answered once, by its id. */
	call<T = unknown>(verb: string, args: readonly unknown[], options?: CallOptions): Promise<LineAnswer<T>>;
	/** One of the line's own messages (`card.seen`, `card.extent`, `view.answered`, `presence.set`, `canvas.watch`), not a call. */
	send(message: LineClientMessage): void;
	on(listener: (message: ServerMessage) => void): () => void;
	connected(): boolean;
}

interface CallOptions {
	/** The caller's name for the edit this call makes, which comes back in the `made` of the revision that has it. */
	edit?: string;
	/** The canvas the call acts on, when not the one on screen. */
	canvas?: string;
	/** The agent the call is addressed to, when not the one the person is talking to. */
	agent?: string;
}

function connect(onStateChange: (connected: boolean) => void): Line {
	const listeners = new Set<(message: ServerMessage) => void>();
	/** Messages sent while the line was down, delivered when it is up. */
	const queue: LineClientMessage[] = [];
	/** Events that have arrived and are waiting to be applied together (`wave` below). */
	const arrived: ServerMessage[] = [];
	const pending = new Map<string, (answer: LineAnswer) => void>();
	let nextId = 0;
	let socket: WebSocket | undefined;
	let closed = false;
	let attempt = 0;
	let timer: number | undefined;
	let painting: number | undefined;
	let soon: number | undefined;

	/*
	 * Every event that has arrived since the last paint, applied as one change: the greeting is
	 * two or three waves rather than one `setState` per message (see the history of this file).
	 */
	const wave = () => {
		if (painting !== undefined) cancelAnimationFrame(painting);
		if (soon !== undefined) clearTimeout(soon);
		painting = undefined;
		soon = undefined;
		const frames = arrived.splice(0);
		batch(() => {
			for (const message of frames) for (const listener of listeners) listener(message);
		});
	};

	const url = lineUrl();
	const here = active();

	const open = () => {
		socket = here?.kind === "bundle" ? (new BundleBackend(here.id) as unknown as WebSocket) : new WebSocket(url);

		socket.onopen = () => {
			attempt = 0;
			// The token first, in hello: nothing is heard before it. Greeted with the whole truth, and told everything after.
			const token = socketToken();
			socket?.send(JSON.stringify({ type: "line.hello", token: token ?? "", all: true, greet: true } satisfies LineClientMessage));
			onStateChange(true);
			while (queue.length > 0) socket?.send(JSON.stringify(queue.shift()));
		};

		socket.onmessage = (event) => {
			let message: ServerMessage;
			try {
				message = JSON.parse(String(event.data)) as ServerMessage;
			} catch {
				return;
			}
			if (message.type === "call.answered") {
				const done = pending.get(message.id);
				pending.delete(message.id);
				done?.(message.ok ? { ok: true, value: message.value, notes: message.notes ?? [] } : { ok: false, error: message.error ?? "The call failed.", notes: message.notes ?? [] });
				return;
			}
			arrived.push(message);
			if (painting !== undefined || soon !== undefined) return;
			painting = requestAnimationFrame(wave);
			soon = window.setTimeout(wave, 50);
		};

		socket.onclose = (event) => {
			if (closed) return;
			onStateChange(false);
			// A call never answered: the line dropped, and the caller hears so rather than waiting for ever.
			for (const done of pending.values()) done({ ok: false, error: `The line to the harness dropped${event?.reason ? `: ${event.reason}` : ""}.`, notes: [] });
			pending.clear();
			// Back off, but not far: this is localhost, and the common cause is a server that is three seconds from being back.
			const delay = Math.min(2000, 150 * 2 ** attempt++);
			timer = window.setTimeout(open, delay);
			// A server that is back but will not take the line no longer takes this tab's token (`lib/session.ts`). Asked every few tries.
			if (attempt % 4 === 0 && here?.kind === "here") void sessionStale().then((stale) => stale && location.reload());
		};

		socket.onerror = () => socket?.close();
	};

	open();

	const post = (message: LineClientMessage) => {
		if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
		else queue.push(message);
	};

	return {
		call(verb, args, options) {
			const id = `p${(nextId += 1).toString(36)}`;
			return new Promise((resolve) => {
				pending.set(id, resolve as (answer: LineAnswer) => void);
				post({ type: "line.call", id, verb, args: [...args], ...(options?.edit ? { edit: options.edit } : {}), ...(options?.canvas ?? onScreen() ? { stage: options?.canvas ?? onScreen() } : {}), ...(options?.agent ?? talkingTo() ? { agent: options?.agent ?? talkingTo() } : {}) });
			});
		},
		send: post,
		on(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		connected() {
			return socket?.readyState === WebSocket.OPEN;
		},
		[Symbol.dispose]: () => {
			closed = true;
			if (painting !== undefined) cancelAnimationFrame(painting);
			if (soon !== undefined) clearTimeout(soon);
			if (timer) clearTimeout(timer);
			socket?.close();
		},
	} as Line;
}

let live: Line | undefined;

/** Open the line. Called once, from the app's mount; `onUp` runs whenever it comes up, a reconnect included. */
export function start(onUp: () => void): Line {
	live = connect((up) => {
		if (up) onUp();
	});
	return live;
}

/** The canvas on screen and the agent the person is talking to, named by App: what a call acts on unless it says otherwise (`X-Decks-Stage`, `X-Decks-Agent`). */
let onScreen: () => string | undefined = () => undefined;
let talkingTo: () => string | undefined = () => undefined;
export function setOnScreen(stage: () => string | undefined, agent?: () => string | undefined): void {
	onScreen = stage;
	if (agent) talkingTo = agent;
}

const needLine = (what: string): Line => {
	if (!live) throw new Error(`${what} before socket.start — the line is opened from App's onMount`);
	return live;
};

/** Call a verb for the person. The answer says whether it went; a failure is the caller's to show. */
export function call<T = unknown>(verb: string, args: readonly unknown[] = [], options?: CallOptions): Promise<LineAnswer<T>> {
	return needLine("socket.call").call<T>(verb, args, options);
}

/** One of the line's own messages. Queued by the line itself if the connection is down. */
export function send(message: LineClientMessage): void {
	needLine("socket.send").send(message);
}

/** Listen for events. Returns the unsubscribe. */
export function on(listener: (message: ServerMessage) => void): () => void {
	return needLine("socket.on").on(listener);
}

/** Where a failed call's words go: App gives it the notices, so a layer-0 module never imports them. */
let failureSink: (text: string) => void = () => {};
export function setFailureSink(sink: (text: string) => void): void {
	failureSink = sink;
}

/** Show a failed call's error as a notice; the answer comes back unchanged, for a caller that wants it. */
export function warnIfFailed<T>(answer: LineAnswer<T>): LineAnswer<T> {
	if (!answer.ok) failureSink(answer.error);
	return answer;
}

/** Whether the line has been started at all (not whether it is up). */
export const started = (): boolean => live !== undefined;

/** For tests: forget the line so the next `start` makes a fresh one. */
export function reset(): void {
	live = undefined;
}

/** Close the line for good, for a switch to another backend (`connections/switch.ts`). */
export function stop(): void {
	(live as (Line & { [Symbol.dispose]?: () => void }) | undefined)?.[Symbol.dispose]?.();
	live = undefined;
}
