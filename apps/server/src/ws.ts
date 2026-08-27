import type { Server } from "node:http";
import type { ClientMessage, ServerMessage } from "@decks/protocol";
import { WebSocketServer, type WebSocket } from "ws";

/**
 * Every connected browser, and the one way to talk to them.
 *
 * A deck is a single-user thing on localhost, but not a single-*window* thing:
 * two tabs on the same deck both get the state and both see a board change, so
 * the hub broadcasts by default and addresses one socket only when it is
 * answering that socket's question.
 */
export class Hub {
	private readonly sockets = new Set<WebSocket>();
	private readonly server: WebSocketServer;

	constructor(
		httpServer: Server,
		private readonly onMessage: (message: ClientMessage, reply: (message: ServerMessage) => void) => void,
		private readonly onConnect: (reply: (message: ServerMessage) => void) => void,
	) {
		this.server = new WebSocketServer({ server: httpServer, path: "/ws" });
		this.server.on("connection", (socket) => this.accept(socket));
	}

	private accept(socket: WebSocket): void {
		this.sockets.add(socket);
		const reply = (message: ServerMessage) => send(socket, message);

		socket.on("message", (data) => {
			let message: ClientMessage;
			try {
				message = JSON.parse(String(data)) as ClientMessage;
			} catch (error) {
				reply({ type: "error", text: `Unreadable frame: ${(error as Error).message}` });
				return;
			}
			try {
				this.onMessage(message, reply);
			} catch (error) {
				// One bad message must not take the socket down with it: the browser
				// gets told, and the next frame is handled as normal.
				const text = error instanceof Error ? error.message : String(error);
				console.error("[decks] handling", message.type, error);
				reply({ type: "error", text });
			}
		});

		socket.on("close", () => this.sockets.delete(socket));
		socket.on("error", () => this.sockets.delete(socket));

		this.onConnect(reply);
	}

	broadcast(message: ServerMessage): void {
		for (const socket of this.sockets) send(socket, message);
	}

	get connections(): number {
		return this.sockets.size;
	}

	close(): void {
		for (const socket of this.sockets) socket.close();
		this.sockets.clear();
		this.server.close();
	}
}

function send(socket: WebSocket, message: ServerMessage): void {
	if (socket.readyState !== socket.OPEN) return;
	socket.send(JSON.stringify(message));
}
