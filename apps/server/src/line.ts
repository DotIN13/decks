import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { LineClientMessage, Presence, PresenceBy, ServerMessage } from "@decks/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import type { App } from "./app.ts";
import { verifyOn } from "./auth/guard.ts";
import { isCanvasPass } from "./auth/passes.ts";
import type { Principal } from "./auth/principal.ts";
import { cardRefusedFor, DOC_CALLS, onCanvas, runVerb } from "./verbs/router.ts";
import { settleStage } from "./wire/deck.ts";

/** How long a new socket has to say `hello` before it is closed. */
export const HELLO_MS = 5_000;
/** How often a line's token is checked again while it is open: a pass run out, signed out or unshared ends it. */
const RECHECK_MS = 5_000;

/** The colours lines are told apart by, one per line by its number: the canvas's own agent palette is a different set. */
const COLORS = ["#2563eb", "#d946ef", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#0ea5e9", "#f97316"];

/** Who a line is, and what it hears. */
interface LineState {
	/** This line's id, what its presence is known by (`PresenceBy.id`). */
	id: string;
	color: string;
	principal?: Principal;
	/** Where this line said it is, per canvas (`presence.set`), for whoever starts watching later and for the leave. */
	present: Map<string, Presence>;
	token?: string;
	/** The canvases this line hears: their changes and their cards', apps' and documents' messages. */
	watched: Set<string>;
	/** Every broadcast, as the event stream gives it (the person's or a paired site's line that asked). */
	all: boolean;
	headers: IncomingMessage["headers"];
	remote?: string;
	hello?: NodeJS.Timeout;
	recheck?: NodeJS.Timeout;
}

/**
 * The line: `/api/v1/socket`, one duplex connection for whoever holds a token, in one envelope
 * (`LineClientMessage` in, `ServerMessage` out). The canvas frame is its first client: its calls as
 * the person on its one canvas, the canvas's changes as `canvas.changed`, its cards', apps' and
 * documents' messages, and its own small messages (a card read, a card measured, a document's edits,
 * the answer to an agent's view call), where it had a stream to read and five routes to post to.
 *
 * The token comes in `hello`, the first message, never in the address: a sandboxed page has no header
 * to put one in, and an address is logged and copied where a message is not. Until `hello` nothing is
 * heard, and a line that does not say it in `HELLO_MS` is closed. A canvas pass hears only its canvas
 * and calls only what a canvas frame may (`refusedForCanvas`); the person's and a paired site's token
 * may watch any canvas, or everything (`all`).
 */
export class Line {
	private readonly server: WebSocketServer;
	private readonly sockets = new Map<WebSocket, LineState>();
	private lines = 0;
	/**
	 * Hears every presence a line says, and every leave, as `presence.changed` goes to the others: the
	 * harness forwards a shared canvas's up to Studio (`studio/index.ts`).
	 */
	onPresence?: (message: Extract<ServerMessage, { type: "presence.changed" }>) => void;
	/** What others on each canvas said, from elsewhere (Studio's harnesses and browsers), by their key: shown to a line that starts watching. */
	private readonly elsewhere = new Map<string, Map<string, Extract<ServerMessage, { type: "presence.changed" }>>>();

	constructor(private readonly app: App) {
		this.server = new WebSocketServer({ noServer: true, perMessageDeflate: { threshold: 1024, serverNoContextTakeover: true, clientNoContextTakeover: true } });
		this.server.on("connection", (socket, request) => this.accept(socket, request as IncomingMessage));
		app.listen((message) => this.hear(message));
	}

	/** The `/api/v1/socket` upgrade, from the router in `index.ts`. */
	handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
		this.server.handleUpgrade(request, socket, head, (ws) => this.server.emit("connection", ws, request));
	}

	private accept(socket: WebSocket, request: IncomingMessage): void {
		this.lines += 1;
		const state: LineState = { id: `l${this.lines.toString(36)}`, color: COLORS[this.lines % COLORS.length]!, present: new Map(), watched: new Set(), all: false, headers: request.headers, remote: request.socket.remoteAddress };
		this.sockets.set(socket, state);
		state.hello = setTimeout(() => socket.close(4401, "Say hello with a token first."), HELLO_MS);
		state.hello.unref?.();
		socket.on("message", (data) => {
			let message: LineClientMessage;
			try {
				message = JSON.parse(String(data)) as LineClientMessage;
			} catch (error) {
				send(socket, { type: "error", text: `Unreadable message: ${(error as Error).message}` });
				return;
			}
			void this.handle(socket, state, message).catch((error) => {
				console.error("[decks] line", (message as { type?: string }).type, error);
				send(socket, { type: "error", text: error instanceof Error ? error.message : String(error) });
			});
		});
		const gone = () => {
			if (!this.sockets.delete(socket)) return;
			clearTimeout(state.hello);
			clearInterval(state.recheck);
			if (state.principal?.kind === "canvas") this.app.canvasFrames -= 1;
			// Gone from every canvas it was present on.
			for (const canvas of state.present.keys()) this.said({ type: "presence.changed", canvas, by: this.by(state), gone: true }, socket);
		};
		socket.on("close", gone);
		socket.on("error", gone);
	}

	/** The token checked as a request's is (`auth/guard.ts`): the principal, or why not. */
	private verify(state: LineState, token: string): Principal | undefined {
		// A canvas pass (`auth/passes.ts`): the canvas frame, on its one canvas, checked against the token it was made with and the role on the canvas now.
		if (isCanvasPass(token)) {
			const pass = this.app.passes.openCanvas(token);
			return pass && pass.canvas ? { kind: "canvas", canvas: pass.canvas, role: pass.role } : undefined;
		}
		const seen = verifyOn(this.app, token, state.headers);
		if (!seen.ok) return undefined;
		const kind = seen.principal.kind;
		return kind === "canvas" || kind === "person" || kind === "site" || kind === "agent" ? seen.principal : undefined;
	}

	private async handle(socket: WebSocket, state: LineState, message: LineClientMessage): Promise<void> {
		if (!state.principal) {
			if (message.type !== "hello" || typeof message.token !== "string") {
				socket.close(4401, "Say hello with a token first.");
				return;
			}
			const principal = this.verify(state, message.token);
			if (!principal) {
				socket.close(4401, "That token does not open the line.");
				return;
			}
			clearTimeout(state.hello);
			state.principal = principal;
			state.token = message.token;
			state.all = message.all === true && (principal.kind === "person" || principal.kind === "site");
			if (principal.kind === "canvas") this.app.canvasFrames += 1;
			// Checked again while open, as the stream checks its pass before each message and each beat.
			state.recheck = setInterval(() => {
				if (!state.token || !this.verify(state, state.token)) socket.close(4401, "The token no longer opens the line.");
			}, RECHECK_MS);
			state.recheck.unref?.();
			send(socket, { type: "hello", who: principal.kind as "person" | "site" | "agent" | "canvas", ...(principal.kind === "canvas" ? { canvas: principal.canvas, role: principal.role } : {}) });
			for (const one of message.watch ?? []) this.watch(socket, state, one.canvas, one.since);
			return;
		}
		const principal = state.principal;
		switch (message.type) {
			case "hello":
			case "token": {
				// A renewed token: it must open the line as the same one did.
				const next = this.verify(state, message.token);
				if (!next || next.kind !== principal.kind || (next.kind === "canvas" && principal.kind === "canvas" && next.canvas !== principal.canvas)) {
					socket.close(4401, "That token does not open this line.");
					return;
				}
				state.principal = next;
				state.token = message.token;
				return;
			}
			case "canvas.watch":
				this.watch(socket, state, message.canvas, message.since);
				return;
			case "canvas.unwatch":
				state.watched.delete(message.canvas);
				return;
			case "call": {
				const headers = { ...state.headers, ...(message.edit ? { "x-decks-edit": message.edit } : {}), ...(message.stage ? { "x-decks-stage": message.stage } : {}), ...(message.agent ? { "x-decks-agent": message.agent } : {}) };
				const { answer } = await runVerb(this.app, principal, headers, String(message.verb ?? ""), message.args, state.remote);
				send(socket, { type: "answer", id: String(message.id), ok: answer.ok, ...(answer.value !== undefined ? { value: answer.value } : {}), ...(answer.error ? { error: answer.error } : {}), ...(answer.notes?.length ? { notes: answer.notes } : {}) });
				return;
			}
			case "stage.result": {
				if (typeof message.id !== "string") return;
				settleStage(this.app.pendingStage, { id: message.id, value: message.value, ...(typeof message.error === "string" ? { error: message.error } : {}) });
				return;
			}
			case "doc": {
				const doc = message.message as { type?: unknown; path?: unknown } | undefined;
				if (!doc || typeof doc.type !== "string" || !DOC_CALLS.has(doc.type) || typeof doc.path !== "string") {
					send(socket, { type: "error", text: "Send { type: \"doc\", message }, a document message for a file on a watched canvas." });
					return;
				}
				// A canvas frame opens only the files the document items on its canvas name; the person any watched canvas's.
				const canvases = principal.kind === "canvas" ? [principal.canvas] : [...state.watched];
				if (!canvases.some((canvas) => this.app.documentsOn(canvas).has(doc.path as string))) {
					send(socket, { type: "error", text: `${doc.path} is not a document on this canvas.` });
					return;
				}
				this.app.docs.handle(message.message as never, (answer) => send(socket, answer as ServerMessage));
				return;
			}
			case "card.seen":
			case "card.extent": {
				const refused = cardRefusedFor(this.app, principal, String(message.path ?? ""));
				if (refused) {
					send(socket, { type: "error", text: refused.error });
					return;
				}
				if (message.type === "card.seen") {
					this.app.boards.seen(message.path);
					return;
				}
				const num = (key: string) => (typeof message[key] === "number" && Number.isFinite(message[key]) ? (message[key] as number) : undefined);
				const rev = num("rev");
				const w = num("w");
				const h = num("h");
				if (rev === undefined || w === undefined || h === undefined) {
					send(socket, { type: "error", text: "Send { path, rev, w, h }, and what else was measured." });
					return;
				}
				const extra: Record<string, number> = {};
				for (const key of ["at", "page", "words", "minFont", "overflowX", "cut", "overlaps"]) {
					const value = num(key);
					if (value !== undefined) extra[key] = value;
				}
				this.app.boards.noteExtent(message.path, { rev, w, h, ...extra });
				return;
			}
			case "presence.set": {
				const { type: _type, canvas, ...presence } = message;
				if (typeof canvas !== "string" || !state.watched.has(canvas)) return;
				const was = state.present.get(canvas) ?? {};
				state.present.set(canvas, { ...was, ...(presence.pointer !== undefined ? { pointer: presence.pointer } : {}), ...(presence.selection ? { selection: presence.selection } : {}), ...(presence.camera !== undefined ? { camera: presence.camera } : {}) });
				this.said({ type: "presence.changed", canvas, by: this.by(state), ...presence }, socket);
				return;
			}
			default:
				send(socket, { type: "notice", level: "warn", text: `The line does not know ${String((message as { type?: unknown }).type)}.` });
		}
	}

	/** Hear a canvas from now on, and catch up from `since` when given: a canvas pass hears its own canvas alone. */
	private watch(socket: WebSocket, state: LineState, canvas: unknown, since: unknown): void {
		if (typeof canvas !== "string" || !canvas) return;
		const principal = state.principal!;
		if (principal.kind === "canvas" && principal.canvas !== canvas) {
			send(socket, { type: "error", text: `This line is ${principal.canvas}'s: it hears no other canvas.` });
			return;
		}
		if (!this.app.pens.has(canvas)) {
			send(socket, { type: "error", text: `There is no canvas called ${canvas}.` });
			return;
		}
		state.watched.add(canvas);
		// Who is on the canvas already: said to the newcomer as they last said it.
		for (const [other, otherState] of this.sockets) if (other !== socket && otherState.principal && otherState.present.has(canvas)) send(socket, { type: "presence.changed", canvas, by: this.by(otherState), ...otherState.present.get(canvas)! });
		for (const one of this.elsewhere.get(canvas)?.values() ?? []) send(socket, one);
		if (typeof since !== "number") return;
		const caught = this.app.pens.caughtUp(canvas, since);
		if (caught) send(socket, caught);
	}

	/** Who a line is, in a presence: the person on it (a canvas pass, the person's own token) or the agent whose token it holds. */
	private by(state: LineState): PresenceBy {
		const principal = state.principal;
		if (principal?.kind === "agent") {
			const agent = this.app.agents.get(principal.id);
			return { kind: "agent", id: principal.id, ...(agent ? { name: agent.name, color: agent.color } : { color: state.color }) };
		}
		return { kind: "person", id: state.id, color: state.color };
	}

	/** A presence said: to every other line watching that canvas, and to whoever listens for the harness (`onPresence`). */
	private said(message: Extract<ServerMessage, { type: "presence.changed" }>, from?: WebSocket): void {
		const text = JSON.stringify(message);
		for (const [socket, state] of this.sockets) if (socket !== from && state.principal && state.watched.has(message.canvas) && socket.readyState === socket.OPEN) socket.send(text);
		if (from) this.onPresence?.(message);
	}

	/**
	 * Someone elsewhere (on Studio, or another harness through it) moved on a canvas kept here: said to
	 * every line watching it, and kept for lines that start watching, until they go.
	 */
	present(message: Extract<ServerMessage, { type: "presence.changed" }>): void {
		const key = `${message.by.harness ?? ""}/${message.by.kind}/${message.by.id}`;
		const on = this.elsewhere.get(message.canvas) ?? new Map();
		if (message.gone) on.delete(key);
		else on.set(key, { ...(on.get(key) ?? {}), ...message });
		this.elsewhere.set(message.canvas, on);
		this.said(message);
	}

	/** A broadcast, to every line it concerns. */
	private hear(message: ServerMessage): void {
		// What was said to one stream alone (a document's answers to a frame on the stream); a line's answers come straight to it.
		if ((message as { frameTo?: unknown }).frameTo !== undefined) return;
		// Per-agent copies of a canvas's change, for a tab's socket; the line hears `canvas.changed`.
		if (message.type === "stage.pen" || message.type === "stage.pen.delta" || message.type === "stage.pen.refused") return;
		let text: string | undefined;
		for (const [socket, state] of this.sockets) {
			if (!state.principal) continue;
			const wanted = state.all || (message.type === "canvas.changed" ? state.watched.has(message.canvas) : [...state.watched].some((canvas) => onCanvas(this.app, message, canvas)));
			if (!wanted) continue;
			text ??= JSON.stringify(message);
			if (socket.readyState === socket.OPEN) socket.send(text);
		}
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
