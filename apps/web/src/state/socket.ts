import type { ClientMessage, ServerMessage } from "@decks/protocol";
import { connect, type Socket } from "../app/socket.ts";

/**
 * The one connection to the server, and the frames that go down it.
 *
 * Layer 0 of the state split, beside `selection` and `deck`: this module imports nothing
 * from the others, and most of them import it.
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
