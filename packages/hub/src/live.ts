import { randomUUID } from "node:crypto";
import { HarnessSend, LiveSend, type LiveEvent } from "@decks/sync-protocol";
import type { HubStore, Who } from "./store.ts";

/** One open socket, whatever carries it: `ws`'s WebSocket fits as it is. */
export interface LiveSocket {
	send(text: string): void;
	close(code?: number, reason?: string): void;
	on(event: "message", listener: (data: unknown) => void): unknown;
	on(event: "close", listener: () => void): unknown;
}

/** The most a live message carries of a revision's edits; a bigger revision is fetched (`changes?since=`). */
export const INLINE_MAX = 64 * 1024;

/** How long a harness has to answer an ask (`Live.askToken`). */
export const ASK_MS = 10_000;

/** An ask a harness could not take: it has no socket open, or it did not answer in time. */
export class NotConnected extends Error {}

/**
 * Who is listening, and to what: every socket hears about the canvases its person may see. Pages
 * send where their pointer is, and everyone else on that canvas sees it; harnesses listen, and answer
 * only what they are asked (`askToken`).
 */
export class Live {
	/** Asks sent to a harness and not answered yet, by their id. */
	private readonly asks = new Map<string, { harness: string; done: (answer: { token: string; expires: number } | Error) => void }>();

	/** Whether a socket hears about a canvas: its person may see it, and a socket held to one canvas (`only`, a canvas frame's) hears that one alone. */
	private hears(who: Who & { only?: string }, canvas: string): boolean {
		if (who.only !== undefined && who.only !== canvas) return false;
		return !!this.store.role(who.user.id, canvas);
	}

	private readonly sockets = new Set<{ ws: LiveSocket; who: Who & { only?: string } }>();

	constructor(private readonly store: HubStore) {}

	/** A socket; `only` holds it to one canvas, for a canvas frame, which hears that canvas and sends no cursor. */
	add(ws: LiveSocket, who: Who & { only?: string }): void {
		const store = this.store;
		const entry = { ws, who };
		this.sockets.add(entry);
		/** The canvases this page has shown a cursor on, so the others hear when it leaves. */
		const pointed = new Set<string>();
		ws.on("message", (raw) => {
			if (who.harness) return this.answered(who.harness.id, raw);
			if (who.only !== undefined) return;
			let got: LiveSend;
			try {
				got = LiveSend.parse(JSON.parse(String(raw)));
			} catch {
				return;
			}
			if (!store.role(who.user.id, got.canvas)) return;
			pointed.add(got.canvas);
			const event: LiveEvent = { type: "cursor", canvas: got.canvas, user: who.user.id, name: who.user.name, x: got.x, y: got.y };
			for (const s of this.sockets) if (s !== entry && !s.who.harness && this.hears(s.who, got.canvas)) s.ws.send(JSON.stringify(event));
		});
		ws.on("close", () => {
			this.sockets.delete(entry);
			// A harness gone with asks unanswered, and no other socket of it open: they fail now, not at the timeout.
			const harness = who.harness?.id;
			if (harness && ![...this.sockets].some((s) => s.who.harness?.id === harness)) for (const ask of [...this.asks.values()]) if (ask.harness === harness) ask.done(new NotConnected("That harness went away."));
			for (const canvas of pointed) for (const s of this.sockets) if (!s.who.harness && this.hears(s.who, canvas)) s.ws.send(JSON.stringify({ type: "cursor.gone", canvas, user: who.user.id } satisfies LiveEvent));
		});
		ws.send(JSON.stringify({ type: "hello", user: who.user.id, ...(who.harness ? { harness: who.harness.id } : {}) } satisfies LiveEvent));
	}

	/** To every socket of one person. */
	toUser(user: string, event: LiveEvent): void {
		const text = JSON.stringify(event);
		// Not to a socket held to one canvas: what is said to a person is about all of theirs.
		for (const s of this.sockets) if (s.who.user.id === user && (s.who as { only?: string }).only === undefined) s.ws.send(text);
	}

	/** To everyone who may see a canvas. */
	toCanvas(canvas: string, event: LiveEvent): void {
		const text = JSON.stringify(event);
		for (const s of this.sockets) if (this.hears(s.who, canvas)) s.ws.send(text);
	}

	/**
	 * A new revision of a canvas, to everyone who may see it, with its edits inside when they are
	 * small enough (`INLINE_MAX`); bigger ones say only that it changed, and are fetched.
	 */
	canvasChanged(change: { id: string; rev: number; base: number; by: string; client?: string; changes: unknown[] }): void {
		const { changes, ...rest } = change;
		const inline = JSON.stringify({ type: "canvas", ...rest, changes });
		const text = new TextEncoder().encode(inline).length <= INLINE_MAX ? inline : JSON.stringify({ type: "canvas", ...rest });
		for (const s of this.sockets) if (this.hears(s.who, change.id)) s.ws.send(text);
	}

	/**
	 * Ask a harness, over the socket its key opened, for a harness token for one person's browser at
	 * `origin`: what lets a browser signed in here reach it without pairing (the harness issues it,
	 * bound to that origin, for an hour unused). Whoever calls this has checked that the person may use
	 * the harness. Rejects with `NotConnected` when no socket of the harness is open or it does not
	 * answer within `ASK_MS`, and with the harness's own sentence when it refuses.
	 */
	askToken(harness: string, user: { id: string; name: string }, origin: string, ms = ASK_MS): Promise<{ token: string; expires: number }> {
		// The newest socket: one being replaced after a drop may not have closed yet.
		const socket = [...this.sockets].reverse().find((s) => s.who.harness?.id === harness);
		if (!socket) return Promise.reject(new NotConnected("That harness is not connected."));
		const id = randomUUID();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.asks.delete(id);
				reject(new NotConnected("That harness did not answer."));
			}, ms);
			timer.unref?.();
			this.asks.set(id, {
				harness,
				done: (answer) => {
					clearTimeout(timer);
					this.asks.delete(id);
					if (answer instanceof Error) reject(answer);
					else resolve(answer);
				},
			});
			socket.ws.send(JSON.stringify({ type: "token.ask", id, user: { id: user.id, name: user.name }, origin } satisfies LiveEvent));
		});
	}

	/** A harness's answer to an ask: taken only from the harness it was asked of. */
	private answered(harness: string, raw: unknown): void {
		let got: HarnessSend;
		try {
			got = HarnessSend.parse(JSON.parse(String(raw)));
		} catch {
			return;
		}
		const ask = this.asks.get(got.id);
		if (!ask || ask.harness !== harness) return;
		if (got.token && typeof got.expires === "number") ask.done({ token: got.token, expires: got.expires });
		else ask.done(new Error(got.error || "The harness would not give a token."));
	}

	/** Close a harness's sockets: its key was revoked. */
	dropHarness(id: string): void {
		for (const s of this.sockets) if (s.who.harness?.id === id) s.ws.close(4001, "revoked");
	}

	get size(): number {
		return this.sockets.size;
	}
}
