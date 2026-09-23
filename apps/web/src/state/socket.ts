import type { ClientMessage, ServerMessage } from "@decks/protocol";
import { batch } from "solid-js";

/**
 * The one connection to the server, and the frames that go down it.
 *
 * Layer 0 of the state split, beside `selection` and `deck`: this module imports nothing
 * from the others, and most of them import it.
 *
 * ### The reconnecting socket, and why it is not its own file
 *
 * `connect()` below was `app/socket.ts`, on the theory that `app/` is where the wiring lives
 * and this file is the state. It had exactly one caller — this module — so `app/` held a
 * module `App.tsx` never saw, and this file imported *upwards* into the layer above it while
 * its own doc comment claimed it imported nothing. A value with one consumer is private to
 * that consumer; here that also makes the layer claim true rather than approximately true.
 *
 * ### Why `start()` rather than a connection made on import
 *
 * `connect()` opens the WebSocket immediately — `open()` is called before it returns. At
 * module scope that would fire during import, so importing this file from a unit test would
 * try to reach `location.host`. So the module holds the instance and `App.tsx` starts it
 * from its own `onMount`, which is where the connection's lifetime already lived.
 *
 * ### Why `send` before `start` throws
 *
 * The underlying socket already queues: a frame sent while the connection is down is held
 * and delivered when it comes up, so nothing is lost across a reconnect. But *before*
 * `start()` there is no socket to queue into, and the choice is between dropping the frame
 * silently and failing loudly. Loudly — the same call this codebase made for `ensureAgent`,
 * and for the same reason: every one of the forty-odd send sites runs after mount, so a
 * send before start is an ordering mistake worth hearing about rather than a case to
 * tolerate.
 */

/**
 * One socket to the server, reconnecting on its own.
 *
 * A dropped connection is normal — the server restarts on every file save during
 * development — so the interesting behaviour is what happens after: the socket
 * comes back, the server greets it with the deck state, and the UI is correct
 * again without anybody pressing reload. Which means the greeting has to be the
 * whole truth, and it is (`App.greet`).
 */
export interface Socket {
	send(message: ClientMessage): void;
	on(listener: (message: ServerMessage) => void): () => void;
	connected(): boolean;
}

function connect(onStateChange: (connected: boolean) => void): Socket {
	const listeners = new Set<(message: ServerMessage) => void>();
	/** Frames sent while the socket was down, delivered when it is up. */
	const queue: ClientMessage[] = [];
	/** Frames that have arrived and are waiting to be applied together (`wave` below). */
	const arrived: ServerMessage[] = [];
	let socket: WebSocket | undefined;
	let attempt = 0;
	let timer: number | undefined;
	let painting: number | undefined;
	let soon: number | undefined;

	/**
	 * Every frame that has arrived since the last paint, applied as one change.
	 *
	 * A frame is one `setState`, and a `setState` runs the whole reactive graph over it. One
	 * frame at a time, that cost is paid per frame — and the greeting is not one frame. It is
	 * the deck, the chat list and then **seven frames for every conversation on the deck**
	 * (`session.greet`): 240 of them on a deck of 34 chats, sent by the server in 120ms and
	 * once applied by the browser over 44 *seconds*, with the main thread blocked throughout:
	 * the same derived state recomputed 240 times while the page could not paint.
	 *
	 * So frames are collected and handed to the listeners inside one `batch`, once per paint.
	 * Nothing is dropped and nothing is reordered; the greeting lands as two or three waves
	 * instead of 240, and a wave that arrives while the page is busy is bigger, which is the
	 * behaviour you want.
	 *
	 * The timer beside the animation frame is for a tab in the background, which paints
	 * nothing: without it, a hidden window would hold a "finished" frame until it was looked
	 * at, and the banner and the tab badge are exactly what a hidden window is for.
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

	const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

	const open = () => {
		socket = new WebSocket(url);

		socket.onopen = () => {
			attempt = 0;
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
			arrived.push(message);
			if (painting !== undefined || soon !== undefined) return;
			painting = requestAnimationFrame(wave);
			soon = window.setTimeout(wave, 50);
		};

		socket.onclose = () => {
			onStateChange(false);
			// Back off, but not far: this is localhost, and the common cause is a
			// server that is three seconds from being back.
			const delay = Math.min(2000, 150 * 2 ** attempt++);
			timer = window.setTimeout(open, delay);
		};

		socket.onerror = () => socket?.close();
	};

	open();

	return {
		send(message) {
			if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
			else queue.push(message);
		},
		on(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		connected() {
			return socket?.readyState === WebSocket.OPEN;
		},
		[Symbol.dispose]: () => {
			if (painting !== undefined) cancelAnimationFrame(painting);
			if (soon !== undefined) clearTimeout(soon);
			if (timer) clearTimeout(timer);
			socket?.close();
		},
	} as Socket;
}

let live: Socket | undefined;

/**
 * Open the connection. Called once, from the app's mount.
 *
 * `onUp` runs whenever the socket comes up — including on every reconnect, which is the
 * interesting case: a reconnect means whatever the old connection was asked is not coming,
 * so the caller uses it to clear what it was waiting for. It is passed in rather than done
 * here because the things that need clearing belong to other modules, and a layer-0 module
 * reaching up into them would invert the graph this split exists to establish.
 */
export function start(onUp: () => void): Socket {
	live = connect((up) => {
		if (up) onUp();
	});
	return live;
}

/** Send a frame. Queued by the socket itself if the connection is down. */
export function send(message: ClientMessage): void {
	if (!live) throw new Error("socket.send before socket.start — the connection is opened from App's onMount");
	live.send(message);
}

/** Listen for frames. Returns the unsubscribe, as the underlying socket does. */
export function on(listener: (message: ServerMessage) => void): () => void {
	if (!live) throw new Error("socket.on before socket.start — the connection is opened from App's onMount");
	return live.on(listener);
}

/**
 * Whether the connection has been started at all.
 *
 * Not whether it is *up* — the socket answers that itself, and nothing in the app asks.
 * This is for the one caller that has to know whether there is anything to send through
 * yet: `ensureHistory` runs before mount on the first paint.
 */
export const started = (): boolean => live !== undefined;

/** For tests: forget the connection so the next `start` makes a fresh one. */
export function reset(): void {
	live = undefined;
}
