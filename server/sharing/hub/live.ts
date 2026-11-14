import { randomUUID } from "node:crypto";
import type { MemoryHub, Who } from "./store.ts";

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
const COLORS = ["#2563eb", "#d946ef", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6"];

type Entry = { ws: LiveSocket; who: Who };
type Ask = { harness: string; done: (answer: { token: string; expires: number } | Error) => void };
type Sent = Record<string, unknown> & { type?: unknown; canvas?: unknown; id?: unknown };

export class Live {
	private readonly sockets = new Set<Entry>();
	private readonly asks = new Map<string, Ask>();
	private opened = 0;

	constructor(private readonly store: MemoryHub) {}

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
			if (got.type === "token") this.answered(entry.who.harness.id, got);
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
		const socket = this.socketOf(harness);
		if (!socket) return Promise.reject(new Error("That harness is not connected."));
		const id = randomUUID();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => (this.asks.delete(id), reject(new Error("That harness did not answer."))), ms);
			timer.unref?.();
			const done = (answer: { token: string; expires: number } | Error) => {
				clearTimeout(timer);
				this.asks.delete(id);
				if (answer instanceof Error) reject(answer);
				else resolve(answer);
			};
			this.asks.set(id, { harness, done });
			socket.ws.send(JSON.stringify({ type: "token.ask", id, user, origin }));
		});
	}

	/** An answer counts only from the harness that was asked. */
	private answered(harness: string, got: Sent): void {
		const ask = typeof got.id === "string" ? this.asks.get(got.id) : undefined;
		if (!ask || ask.harness !== harness) return;
		if (typeof got.token === "string" && typeof got.expires === "number") ask.done({ token: got.token, expires: got.expires });
		else ask.done(new Error(typeof got.error === "string" ? got.error : "The harness would not give a token."));
	}

	private socketOf(harness: string): Entry | undefined {
		return [...this.sockets].reverse().find((s) => s.who.harness?.id === harness);
	}

	/** Close a harness's sockets: its key was revoked. */
	dropHarness(id: string): void {
		for (const s of this.sockets) if (s.who.harness?.id === id) s.ws.close(4001, "revoked");
	}
}

function parse(raw: unknown): Sent | undefined {
	try {
		const got = JSON.parse(String(raw)) as unknown;
		return got && typeof got === "object" ? (got as Sent) : undefined;
	} catch {
		return undefined;
	}
}
