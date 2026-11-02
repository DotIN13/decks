import { randomUUID } from "node:crypto";
import { HarnessSend, LiveSend, type LiveEvent, type PresenceBy } from "@decks/sync-protocol";
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
 * What one Live says to the Lives in other processes, over whatever carries it (`LiveBus`): an event
 * for a person or a canvas, presence, an ask for a harness token and its answer, a drop. Each names the
 * node it came from, so a node ignores its own; `text` is the message as the sockets get it.
 */
export type LiveBusMessage =
	| { kind: "user"; node: string; user: string; text: string }
	| { kind: "canvas"; node: string; canvas: string; text: string }
	| { kind: "presence"; node: string; event: PresenceEvent }
	| { kind: "ask"; node: string; id: string; harness: string; user: { id: string; name: string }; origin: string }
	| { kind: "answer"; node: string; to: string; id: string; token?: string; expires?: number; error?: string }
	| { kind: "drop"; node: string; harness?: string; user?: string };

/**
 * Between processes: publish what this one says, hear what the others do. One process needs none; two
 * need one (Redis's PUBLISH and SUBSCRIBE, Postgres's NOTIFY, anything that carries a line). `MemoryBus`
 * is the one for tests and for several Lives in one process.
 */
export interface LiveBus {
	publish(message: LiveBusMessage): void;
	subscribe(handler: (message: LiveBusMessage) => void): void;
}

/** A bus inside one process: every Live on it hears every other, on the next tick. */
export class MemoryBus implements LiveBus {
	private readonly handlers = new Set<(message: LiveBusMessage) => void>();
	publish(message: LiveBusMessage): void {
		const copy = JSON.parse(JSON.stringify(message)) as LiveBusMessage;
		queueMicrotask(() => {
			for (const h of this.handlers) h(copy);
		});
	}
	subscribe(handler: (message: LiveBusMessage) => void): void {
		this.handlers.add(handler);
	}
}

/** The colours people on Studio's pages are told apart by, one per socket in turn. */
const COLORS = ["#2563eb", "#d946ef", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#0ea5e9", "#f97316"];
type PresenceEvent = Extract<LiveEvent, { type: "presence" }>;

/**
 * Who is listening, and to what: every socket hears about the canvases its person may see. Pages
 * send where their pointer is, and everyone else on that canvas sees it; harnesses listen, and answer
 * only what they are asked (`askToken`). With a `bus`, what is said here is said to the sockets of
 * every other process too, and an ask finds the harness's socket wherever it is.
 */
export class Live {
	/** Asks sent to a harness and not answered yet, by their id. */
	private readonly asks = new Map<string, { harness: string; done: (answer: { token: string; expires: number } | Error) => void }>();
	/** This process, among those on the bus. */
	readonly node = randomUUID();
	private readonly bus: LiveBus | undefined;

	/** Whether a socket hears about a canvas: its person may see it, and a socket held to one canvas (`only`, a canvas frame's) hears that one alone. */
	private hears(who: Who & { only?: string }, canvas: string): boolean {
		if (who.only !== undefined && who.only !== canvas) return false;
		return !!this.store.role(who.user.id, canvas);
	}

	private readonly sockets = new Set<{ ws: LiveSocket; who: Who & { only?: string } }>();
	private opened = 0;

	constructor(
		private readonly store: HubStore,
		options: { bus?: LiveBus } = {},
	) {
		this.bus = options.bus;
		this.bus?.subscribe((m) => this.heard(m));
	}

	/** Who is present, said to every other socket that hears the canvas: pages and harnesses alike, never the sender; and to the other processes. */
	private present(event: PresenceEvent, from: { ws: LiveSocket } | undefined, publish = true): void {
		const text = JSON.stringify(event);
		for (const s of this.sockets) if (s !== from && this.hears(s.who, event.canvas)) s.ws.send(text);
		if (publish) this.bus?.publish({ kind: "presence", node: this.node, event });
	}

	/** What another process said: sent to this one's sockets, and never said again. */
	private heard(m: LiveBusMessage): void {
		if (m.node === this.node) return;
		if (m.kind === "user") this.sendUser(m.user, m.text);
		else if (m.kind === "canvas") this.sendCanvas(m.canvas, m.text);
		else if (m.kind === "presence") this.present(m.event, undefined, false);
		else if (m.kind === "drop") this.drop(m, false);
		else if (m.kind === "answer") {
			if (m.to === this.node) this.answered(undefined, m);
		} else if (m.kind === "ask") {
			// The harness's socket may be here: ask it, and send what it says back to the node that asked.
			const socket = this.socketOf(m.harness);
			if (!socket) return;
			this.askOver(socket, m.id, m.harness, m.user, m.origin, ASK_MS).then(
				(answer) => this.bus?.publish({ kind: "answer", node: this.node, to: m.node, id: m.id, ...answer }),
				(error: Error) => this.bus?.publish({ kind: "answer", node: this.node, to: m.node, id: m.id, error: error.message }),
			);
		}
	}

	private sendUser(user: string, text: string): void {
		// Not to a socket held to one canvas: what is said to a person is about all of theirs.
		for (const s of this.sockets) if (s.who.user.id === user && (s.who as { only?: string }).only === undefined) s.ws.send(text);
	}

	private sendCanvas(canvas: string, text: string): void {
		for (const s of this.sockets) if (this.hears(s.who, canvas)) s.ws.send(text);
	}

	/** A socket; `only` holds it to one canvas, for a canvas frame, which hears that canvas and sends no cursor. */
	add(ws: LiveSocket, who: Who & { only?: string }): void {
		const store = this.store;
		const entry = { ws, who };
		this.sockets.add(entry);
		/** The canvases this page has shown a cursor on, so the others hear when it leaves. */
		const pointed = new Set<string>();
		/** This page's presence identity: the person, told apart from their other pages by the socket's number and colour. */
		this.opened += 1;
		const me: PresenceBy = { kind: "person", id: `${who.user.id}:${this.opened.toString(36)}`, name: who.user.name, color: COLORS[this.opened % COLORS.length]! };
		/** Whom this harness's socket relayed on each canvas (kind and id): said gone when the harness goes. */
		const relayed = new Map<string, Set<string>>();
		ws.on("message", (raw) => {
			if (who.harness) return this.fromHarness(entry, who.harness, raw, relayed);
			if (who.only !== undefined) return;
			let got: LiveSend;
			try {
				got = LiveSend.parse(JSON.parse(String(raw)));
			} catch {
				return;
			}
			if (!store.role(who.user.id, got.canvas)) return;
			pointed.add(got.canvas);
			if (got.type === "cursor") {
				// The older form: said as it was to pages that read it, and as presence to everyone.
				const event: LiveEvent = { type: "cursor", canvas: got.canvas, user: who.user.id, name: who.user.name, x: got.x, y: got.y };
				for (const s of this.sockets) if (s !== entry && !s.who.harness && this.hears(s.who, got.canvas)) s.ws.send(JSON.stringify(event));
				this.present({ type: "presence", canvas: got.canvas, by: me, pointer: { x: got.x, y: got.y } }, entry);
				return;
			}
			const { type: _type, ...presence } = got;
			this.present({ type: "presence", ...presence, by: me }, entry);
		});
		ws.on("close", () => {
			this.sockets.delete(entry);
			// A harness gone with asks unanswered, and no other socket of it open: they fail now, not at the timeout.
			const harness = who.harness?.id;
			if (harness && ![...this.sockets].some((s) => s.who.harness?.id === harness)) for (const ask of [...this.asks.values()]) if (ask.harness === harness) ask.done(new NotConnected("That harness went away."));
			for (const canvas of pointed) {
				for (const s of this.sockets) if (!s.who.harness && this.hears(s.who, canvas)) s.ws.send(JSON.stringify({ type: "cursor.gone", canvas, user: who.user.id } satisfies LiveEvent));
				this.present({ type: "presence", canvas, by: me, gone: true }, entry);
			}
			// Everyone a harness relayed goes with it.
			for (const [canvas, keys] of relayed) for (const key of keys) {
				const at = key.indexOf(":");
				this.present({ type: "presence", canvas, by: { kind: key.slice(0, at) as PresenceBy["kind"], id: key.slice(at + 1), color: "", harness: who.harness!.id }, gone: true }, entry);
			}
		});
		ws.send(JSON.stringify({ type: "hello", user: who.user.id, ...(who.harness ? { harness: who.harness.id } : {}) } satisfies LiveEvent));
	}

	/** To every socket of one person, in every process. */
	toUser(user: string, event: LiveEvent): void {
		const text = JSON.stringify(event);
		this.sendUser(user, text);
		this.bus?.publish({ kind: "user", node: this.node, user, text });
	}

	/** To everyone who may see a canvas, in every process. */
	toCanvas(canvas: string, event: LiveEvent): void {
		const text = JSON.stringify(event);
		this.sendCanvas(canvas, text);
		this.bus?.publish({ kind: "canvas", node: this.node, canvas, text });
	}

	/**
	 * A new revision of a canvas, to everyone who may see it, with its edits inside when they are
	 * small enough (`INLINE_MAX`); bigger ones say only that it changed, and are fetched.
	 */
	canvasChanged(change: { id: string; rev: number; base: number; by: string; client?: string; changes: unknown[] }): void {
		const { changes, ...rest } = change;
		const inline = JSON.stringify({ type: "canvas", ...rest, changes });
		const text = new TextEncoder().encode(inline).length <= INLINE_MAX ? inline : JSON.stringify({ type: "canvas", ...rest });
		this.sendCanvas(change.id, text);
		this.bus?.publish({ kind: "canvas", node: this.node, canvas: change.id, text });
	}

	/**
	 * Ask a harness, over the socket its key opened, for a harness token for one person's browser at
	 * `origin`: what lets a browser signed in here reach it without pairing (the harness issues it,
	 * bound to that origin, for an hour unused). Whoever calls this has checked that the person may use
	 * the harness. Rejects with `NotConnected` when no socket of the harness is open or it does not
	 * answer within `ASK_MS`, and with the harness's own sentence when it refuses.
	 */
	askToken(harness: string, user: { id: string; name: string }, origin: string, ms = ASK_MS): Promise<{ token: string; expires: number }> {
		const socket = this.socketOf(harness);
		const id = randomUUID();
		if (socket) return this.askOver(socket, id, harness, user, origin, ms);
		if (!this.bus) return Promise.reject(new NotConnected("That harness is not connected."));
		// Not here: the other processes are asked; the one with the socket answers over the bus, or nobody does.
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.asks.delete(id);
				reject(new NotConnected("That harness is not connected."));
			}, ms);
			timer.unref?.();
			this.asks.set(id, { harness, done: (answer) => (clearTimeout(timer), this.asks.delete(id), answer instanceof Error ? reject(answer) : resolve(answer)) });
			this.bus!.publish({ kind: "ask", node: this.node, id, harness, user: { id: user.id, name: user.name }, origin });
		});
	}

	/** The newest socket of a harness here: one being replaced after a drop may not have closed yet. */
	private socketOf(harness: string): { ws: LiveSocket; who: Who } | undefined {
		return [...this.sockets].reverse().find((s) => s.who.harness?.id === harness);
	}

	/** The ask itself, over a socket of this process's. */
	private askOver(socket: { ws: LiveSocket }, id: string, harness: string, user: { id: string; name: string }, origin: string, ms: number): Promise<{ token: string; expires: number }> {
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
	/** What a harness says on its socket: an answer to an ask, or where someone on it is (`presence`, relayed with the harness named). */
	private fromHarness(entry: { ws: LiveSocket; who: Who }, harness: { id: string; name: string }, raw: unknown, relayed: Map<string, Set<string>>): void {
		let got: HarnessSend;
		try {
			got = HarnessSend.parse(JSON.parse(String(raw)));
		} catch {
			return;
		}
		if (got.type === "token") return this.answered(harness.id, got);
		if (!this.store.role(entry.who.user.id, got.canvas)) return;
		const { type: _type, by, ...presence } = got;
		const keys = relayed.get(got.canvas) ?? new Set<string>();
		if (got.gone) keys.delete(`${by.kind}:${by.id}`);
		else keys.add(`${by.kind}:${by.id}`);
		relayed.set(got.canvas, keys);
		this.present({ type: "presence", ...presence, by: { ...by, harness: harness.id } }, entry);
	}

	/** An answer: from the harness that was asked over its socket here (`harness` named), or from another process over the bus (undefined: it checked). */
	private answered(harness: string | undefined, got: { id: string; token?: string; expires?: number; error?: string }): void {
		const ask = this.asks.get(got.id);
		if (!ask || (harness !== undefined && ask.harness !== harness)) return;
		if (got.token && typeof got.expires === "number") ask.done({ token: got.token, expires: got.expires });
		else ask.done(new Error(got.error || "The harness would not give a token."));
	}

	/** Close a harness's sockets, in every process: its key was revoked. */
	dropHarness(id: string): void {
		this.drop({ harness: id });
	}

	/** Close every socket of a person's, their harnesses' too, in every process: the account is gone. */
	dropUser(id: string): void {
		this.drop({ user: id });
	}

	private drop(which: { harness?: string; user?: string }, publish = true): void {
		for (const s of this.sockets) {
			if (which.harness !== undefined && s.who.harness?.id === which.harness) s.ws.close(4001, "revoked");
			else if (which.user !== undefined && s.who.user.id === which.user) s.ws.close(4001, "account deleted");
		}
		if (publish) this.bus?.publish({ kind: "drop", node: this.node, ...which });
	}

	get size(): number {
		return this.sockets.size;
	}
}
