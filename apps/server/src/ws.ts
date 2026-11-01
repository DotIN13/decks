import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { ClientMessage, ServerMessage } from "@decks/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import { HELLO_MS } from "./line.ts";

/**
 * What one connected browser is looking at.
 *
 * Only the conversation, because that is the one thing the server answers differently per
 * screen: which agent's stage is up decides the arrangement a board list carries and the
 * `focused` an `agents` frame names. Everything else about where a person is lives in that
 * browser's own hash (`web/src/app/route.ts`).
 */
export interface View {
	/** The agent this browser's stage is on. `undefined` until it has said. */
	focused?: string;
}

/**
 * Every connected browser, and the one way to talk to them.
 *
 * A deck is a single-user thing on localhost, but not a single-*window* thing:
 * two tabs on the same deck both get the state and both see a board change, so
 * the hub broadcasts by default and addresses one socket only when it is
 * answering that socket's question.
 */
export class Hub {
	private readonly sockets = new Map<WebSocket, View>();
	private readonly server: WebSocketServer;

	/**
	 * `noServer`, and the upgrade is routed by hand.
	 *
	 * `/ws` is no longer the only websocket on this server: `/api/web/relay` is the user's
	 * Chrome extension calling in (`browser/bridge.ts`). Two `WebSocketServer`s on one HTTP
	 * server each abort any upgrade whose path is not theirs, so the second one broke the
	 * first — the one upgrade listener in `index.ts` looks at the path and hands the socket
	 * to whichever of the two it belongs to.
	 */
	constructor(
		httpServer: Server,
		private readonly onMessage: (message: ClientMessage, reply: (message: ServerMessage) => void, view: View) => void,
		private readonly onConnect: (reply: (message: ServerMessage) => void, view: View) => void,
		/** Whether a token opens a socket for the person (or a paired site), for a `hello` (`auth/guard.ts`, as `socketPrincipal` checks an address). */
		private readonly opens: (token: string, headers: IncomingMessage["headers"]) => boolean = () => false,
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
	}

	/**
	 * The `/ws` upgrade, from the router in `index.ts`. `open` says the address carried a token that checked
	 * out (the older way, for one release); without one the socket waits for `hello` with the token, its first message.
	 */
	handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, open = true): void {
		this.server.handleUpgrade(request, socket, head, (ws) => this.accept(ws, request, open));
	}

	private accept(socket: WebSocket, request: IncomingMessage, open: boolean): void {
		const view: View = {};
		const reply = (message: ServerMessage) => send(socket, message);
		let opened = false;
		// Nothing is heard before the token, and a socket that never says it is closed.
		const deadline = open ? undefined : setTimeout(() => socket.close(4401, "Say hello with a token first."), HELLO_MS);
		deadline?.unref?.();
		const begin = () => {
			opened = true;
			clearTimeout(deadline);
			this.sockets.set(socket, view);
			this.onConnect(reply, view);
		};

		socket.on("message", (data) => {
			let message: ClientMessage;
			try {
				message = JSON.parse(String(data)) as ClientMessage;
			} catch (error) {
				reply({ type: "error", text: `Unreadable frame: ${(error as Error).message}` });
				return;
			}
			if (message.type === "hello") {
				// Checked on a socket already open too (an address's token, an earlier hello): a token that does not open it closes it.
				if (typeof message.token !== "string" || !this.opens(message.token, request.headers)) {
					socket.close(4401, "That token does not open the socket.");
					return;
				}
				if (!opened) begin();
				return;
			}
			if (!opened) {
				socket.close(4401, "Say hello with a token first.");
				return;
			}
			try {
				this.onMessage(message, reply, view);
			} catch (error) {
				// One bad message must not take the socket down with it: the browser
				// gets told, and the next frame is handled as normal.
				const text = error instanceof Error ? error.message : String(error);
				console.error("[decks] handling", message.type, error);
				reply({ type: "error", text });
			}
		});

		socket.on("close", () => {
			clearTimeout(deadline);
			this.sockets.delete(socket);
		});
		socket.on("error", () => this.sockets.delete(socket));

		if (open) begin();
	}

	broadcast(message: ServerMessage): void {
		for (const socket of this.sockets.keys()) send(socket, message);
	}

	/** To every connected browser, each given the message as its own view should see it. */
	each(render: (view: View) => ServerMessage): void {
		for (const [socket, view] of this.sockets) send(socket, render(view));
	}

	get connections(): number {
		return this.sockets.size;
	}

	close(): void {
		for (const socket of this.sockets.keys()) socket.close();
		this.sockets.clear();
		this.server.close();
	}
}

function send(socket: WebSocket, message: ServerMessage): void {
	if (socket.readyState !== socket.OPEN) return;
	socket.send(JSON.stringify(message));
}
