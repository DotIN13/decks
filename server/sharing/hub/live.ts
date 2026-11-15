import { randomUUID } from "node:crypto";
import type { Envelope } from "../../../protocol/index.ts";
import type { HubStore, Who } from "./store.ts";

// The live socket: each socket hears about the canvases its person may see.
// Pages say where they point and the others on that canvas see it; a harness
// answers only what it is asked.

export interface LiveSocket {
	send(text: string): void;
	close(code?: number, reason?: string): void;
	on(event: "message", listener: (data: unknown) => void): unknown;
	on(event: "close", listener: () => void): unknown;
}

/** The most bytes of edits a live message carries; a bigger revision is fetched. */
export const INLINE_MAX = 64 * 1024;
export const ASK_MS = 10_000;
export const CALL_MS = 30_000;
const COLORS = ["#2563eb", "#d946ef", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6"];

type Entry = { ws: LiveSocket; who: Who };
type Ask = { harness: string; answer: string; done: (got: Sent | Error) => void };
type Sent = Record<string, unknown> & { type?: unknown; canvas?: unknown; id?: unknown };

export class Live {
	private readonly sockets = new Set<Entry>();
	private readonly asks = new Map<string, Ask>();
	private opened = 0;

	constructor(private readonly store: HubStore) {}

	add(ws: LiveSocket, who: Who): void {
		const entry = { ws, who };
		this.sockets.add(entry);
		this.opened += 1;
		const me = { kind: "person", id: `${who.user.id}:${this.opened.toString(36)}`, name: who.user.name, color: COLORS[this.opened % COLORS.length]! };
		const pointed = new Set<string>();
		ws.on("message", (raw) => this.heard(entry, me, pointed, raw));
		ws.on("close", () => this.closed(entry, me, pointed));
		ws.send(JSON.stringify({ type: "hello", user: who.user.id, ...(who.harness ? { harness: who.harness.id } : {}) }));
	}

	private heard(entry: Entry, me: Record<string, string>, pointed: Set<string>, raw: unknown): void {
		const got = parse(raw);
		if (!got) return;
		if (entry.who.harness) {
			if (got.type === "token" || got.type === "reply") this.answered(entry.who.harness.id, got);
			return;
		}
		if (got.type !== "presence" || typeof got.canvas !== "string" || !this.store.role(entry.who.user.id, got.canvas)) return;
		pointed.add(got.canvas);
		const { type: _type, ...presence } = got;
		this.fanOut(got.canvas, JSON.stringify({ type: "presence", ...presence, by: me }), entry);
	}

	private closed(entry: Entry, me: Record<string, string>, pointed: Set<string>): void {
		this.sockets.delete(entry);
		const harness = entry.who.harness?.id;
		if (harness && !this.socketOf(harness)) {
			for (const ask of [...this.asks.values()]) if (ask.harness === harness) ask.done(new Error("That harness went away."));
		}
		for (const canvas of pointed) this.fanOut(canvas, JSON.stringify({ type: "presence", canvas, by: me, gone: true }), entry);
	}

	private fanOut(canvas: string, text: string, from?: Entry): void {
		for (const s of this.sockets) if (s !== from && this.store.role(s.who.user.id, canvas)) s.ws.send(text);
	}

	toUser(user: string, event: Sent): void {
		const text = JSON.stringify(event);
		for (const s of this.sockets) if (s.who.user.id === user) s.ws.send(text);
	}

	toCanvas(canvas: string, event: Sent): void {
		this.fanOut(canvas, JSON.stringify(event));
	}

	/** A new revision; its edits ride inside when they are small enough. */
	canvasChanged(change: { id: string; rev: number; base: number; by: string; client?: string; changes: unknown[] }): void {
		const inline = JSON.stringify({ type: "canvas", ...change });
		const { changes: _c, ...rest } = change;
		this.fanOut(change.id, Buffer.byteLength(inline) <= INLINE_MAX ? inline : JSON.stringify({ type: "canvas", ...rest }));
	}

	/** Ask a harness, over its own socket, for a token for a person's browser at origin. */
	askToken(harness: string, user: { id: string; name: string }, origin: string, ms = ASK_MS): Promise<{ token: string; expires: number }> {
		return this.ask(harness, { type: "token.ask", user, origin }, "token", ms, (got) => {
			if (typeof got.token === "string" && typeof got.expires === "number") return { token: got.token, expires: got.expires };
			return new Error(typeof got.error === "string" ? got.error : "The harness would not give a token.");
		});
	}

	/** Pass a person's call to a harness's Decks-local; its envelope comes back as it answered. */
	askCall(harness: string, name: string, args: Record<string, unknown>, caller: { id: string; name: string }, ms = CALL_MS): Promise<Envelope<unknown>> {
		const frame = { type: "ask", name, args, caller: { kind: "person", id: caller.id, name: caller.name } };
		return this.ask(harness, frame, "reply", ms, (got) => (isEnvelope(got.envelope) ? got.envelope : new Error("The harness sent no answer.")));
	}

	/** One request on a harness's socket, answered once by a frame of the given type and id. */
	private ask<T>(harness: string, frame: Sent, answer: string, ms: number, read: (got: Sent) => T | Error): Promise<T> {
		const socket = this.socketOf(harness);
		if (!socket) return Promise.reject(new Error("That harness is not connected."));
		const id = randomUUID();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => (this.asks.delete(id), reject(new Error("That harness did not answer."))), ms);
			timer.unref?.();
			const done = (got: Sent | Error) => {
				clearTimeout(timer);
				this.asks.delete(id);
				const value = got instanceof Error ? got : read(got);
				if (value instanceof Error) reject(value);
				else resolve(value);
			};
			this.asks.set(id, { harness, answer, done });
			socket.ws.send(JSON.stringify({ ...frame, id }));
		});
	}

	/** An answer counts only from the harness that was asked, in the frame it was asked for. */
	private answered(harness: string, got: Sent): void {
		const ask = typeof got.id === "string" ? this.asks.get(got.id) : undefined;
		if (ask && ask.harness === harness && ask.answer === got.type) ask.done(got);
	}

	private socketOf(harness: string): Entry | undefined {
		return [...this.sockets].reverse().find((s) => s.who.harness?.id === harness);
	}

	/** Close a harness's sockets: its key was revoked. */
	dropHarness(id: string): void {
		for (const s of this.sockets) if (s.who.harness?.id === id) s.ws.close(4001, "revoked");
	}
}

function isEnvelope(value: unknown): value is Envelope<unknown> {
	const e = value as { ok?: unknown; notes?: unknown } | undefined;
	return !!e && typeof e.ok === "boolean" && Array.isArray(e.notes);
}

function parse(raw: unknown): Sent | undefined {
	try {
		const got = JSON.parse(String(raw)) as unknown;
		return got && typeof got === "object" ? (got as Sent) : undefined;
	} catch {
		return undefined;
	}
}
