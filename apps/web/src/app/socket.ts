import type { ClientMessage, ServerMessage } from "@decks/protocol";

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

export function connect(onStateChange: (connected: boolean) => void): Socket {
	const listeners = new Set<(message: ServerMessage) => void>();
	/** Frames sent while the socket was down, delivered when it is up. */
	const queue: ClientMessage[] = [];
	let socket: WebSocket | undefined;
	let attempt = 0;
	let timer: number | undefined;

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
			for (const listener of listeners) listener(message);
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
			if (timer) clearTimeout(timer);
			socket?.close();
		},
	} as Socket;
}
