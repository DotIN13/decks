import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
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

	/**
	 * `noServer`, and the upgrade is routed by hand.
	 *
	 * `/ws` is no longer the only websocket on this server: `/api/web/relay` is the user's
	 * Chrome extension calling in (`web/bridge.ts`). Two `WebSocketServer`s on one HTTP
	 * server each abort any upgrade whose path is not theirs, so the second one broke the
	 * first — the one upgrade listener in `index.ts` looks at the path and hands the socket
	 * to whichever of the two it belongs to.
	 */
	constructor(
		httpServer: Server,
		private readonly onMessage: (message: ClientMessage, reply: (message: ServerMessage) => void) => void,
		private readonly onConnect: (reply: (message: ServerMessage) => void) => void,
	) {
		void httpServer;
		this.server = new WebSocketServer({
			noServer: true,
			/*
			 * Compressed, one message at a time. What goes down this socket is JSON —
			 * transcripts, board lists — and it deflates about 3.7× (the live deck's greeting:
			 * 8.2 MB as sent, 2.2 MB deflated frame by frame). Frames under a kilobyte are left
			 * alone, because a token of a reply or a state change costs more to compress than it
			 * saves; and nothing is carried between messages, so a socket holds no compression
			 * window in memory for being compressed.
			 */
			perMessageDeflate: {
				threshold: 1024,
				serverNoContextTakeover: true,
				clientNoContextTakeover: true,
			},
		});
		this.server.on("connection", (socket) => this.accept(socket));
	}

	/** The `/ws` upgrade, from the router in `index.ts`. */
	handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
		this.server.handleUpgrade(request, socket, head, (ws) => this.server.emit("connection", ws, request));
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
