import WebSocket from "ws";
import { LiveEvent, type TokenGiven } from "@decks/sync-protocol";
import type { Bases } from "./bases.ts";
import { sha256 as hashOf } from "./hash-cache.ts";
import type { SyncScheduler } from "./scheduler.ts";
import { cost, type SyncOptions, type SyncStore } from "./state.ts";

/** What a harness says on the live socket about where someone is on a canvas (`HarnessSync.presence`). */
export type PresenceMessage = { by: { kind: "person" | "agent"; id: string; name?: string; color: string }; pointer?: { x: number; y: number } | null; selection?: string[]; camera?: { x: number; y: number; zoom: number } | null; gone?: true };

/**
 * Every word this harness and Studio exchange: the HTTP calls under `/sync/v1/` with the key, the one
 * way files and edits go up (each respecting Studio's waits, `SyncScheduler.hold`), who this key is
 * (`hello`), the app list, and the live socket, which brings Studio's news and carries presence and
 * token answers back.
 */
export class StudioTransport {
	/** This harness's id in Studio, and the account it belongs to: empty until the first `hello`. */
	me = "";
	user = "";
	private ws?: WebSocket;
	/** Files Studio refused for themselves (too large for the space left, a path it will not keep), by canvas and path, with the bytes' hash: not sent again until they change, or until the next full recheck. */
	private refusedFiles = new Map<string, string>();
	/** Whether this connection has told Studio the app list yet: once on connecting, then on a change. */
	private inventorySent = false;

	constructor(
		private readonly o: SyncOptions,
		private readonly log: (line: string) => void,
		private readonly store: SyncStore,
		private readonly bases: Bases,
		private readonly scheduler: SyncScheduler,
	) {}

	// ---- calls ----

	async call(method: string, path: string, body?: unknown, raw?: Uint8Array): Promise<any> {
		const res = await fetch(new URL(path, this.o.studio), { method, headers: { Authorization: `Bearer ${this.o.key}`, "Content-Type": raw ? "application/octet-stream" : "application/json" }, body: raw ? (raw as unknown as ArrayBuffer) : body === undefined ? undefined : JSON.stringify(body) });
		if (path.startsWith("/sync/v1/blobs/")) {
			if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
			const bytes = new Uint8Array(await res.arrayBuffer());
			cost.received += bytes.length;
			return bytes;
		}
		const text = await res.text();
		cost.received += Buffer.byteLength(text);
		const json = JSON.parse(text);
		if (!res.ok) throw Object.assign(new Error(`${method} ${path}: ${res.status} ${json.error ?? ""}`), { status: res.status, retryAfter: Number(res.headers.get("retry-after")) || undefined });
		return json;
	}

	/**
	 * A file up to Studio, the one way every file goes, a canvas's own, a card's picture, a canvas's
	 * picture: not sent while Studio asks for a wait or while it refused these same bytes; a 429 holds
	 * every file until Studio's Retry-After, a refusal of this file alone (any other 4xx but 401) is
	 * said once and skipped, and the pass goes on with what else it has. Studio down, or the key
	 * refused, still ends the pass. Answers what Studio said, or undefined when nothing was sent.
	 */
	async upload(name: string, id: string, path: string, bytes: Uint8Array, hash: string, base?: number): Promise<any | undefined> {
		const key = `${name}:${path}`;
		if (this.scheduler.holding("files") || this.refusedFiles.get(key) === hash) return undefined;
		try {
			this.scheduler.say({ now: { canvas: name, path, up: true } });
			const answer = await this.call("PUT", `/sync/v1/canvases/${id}/files?path=${encodeURIComponent(path)}${base !== undefined ? `&base=${base}` : ""}`, undefined, bytes);
			this.refusedFiles.delete(key);
			this.scheduler.say({ sent: this.scheduler.told.sent + bytes.length });
			return answer;
		} catch (error) {
			const { status, retryAfter } = error as { status?: number; retryAfter?: number };
			if (status === 429) return void this.scheduler.hold("files", retryAfter);
			if (status === undefined || status >= 500 || status === 401) throw error;
			if (this.refusedFiles.get(key) !== hash) this.log(`did not upload ${path} of ${name}: ${(error as Error).message}`);
			this.refusedFiles.set(key, hash);
			return undefined;
		}
	}

	/** The full recheck: files Studio refused are offered again, in case Studio now has room for them. */
	forgetRefusals() {
		this.refusedFiles.clear();
	}

	/** Edits up to Studio; undefined, held, when Studio asks for a wait: the file still differs from what was agreed, so the next pass finds them again. */
	async postEdits(id: string, body: unknown): Promise<any | undefined> {
		if (this.scheduler.holding("edits")) return undefined;
		try {
			return await this.call("POST", `/sync/v1/canvases/${id}/edits`, body);
		} catch (error) {
			const { status, retryAfter } = error as { status?: number; retryAfter?: number };
			if (status !== 429) throw error;
			return void this.scheduler.hold("edits", retryAfter);
		}
	}

	/** Who this key is, asked once: a key for another account than the state's starts the state afresh. */
	async hello() {
		if (this.me) return;
		const hello = await this.call("GET", "/sync/v1/hello");
		this.me = hello.harness.id;
		this.user = hello.user.id;
		if (this.store.state.user !== this.user) {
			this.store.state = { studio: this.o.studio, user: this.user, canvases: {} };
			this.bases.clear();
		}
		this.log(`connected to ${this.o.studio} as ${hello.user.email}, harness "${hello.harness.name}"`);
	}

	/** The app list, to `PUT /sync/v1/inventory`, when it changed. A Studio too old to have the route (404) is left alone. */
	async tellInventory() {
		if (!this.o.inventory) return;
		let apps;
		try {
			apps = this.o.inventory().map(({ name, title, kind }) => ({ name, title, kind }));
		} catch (error) {
			this.log(`no app list: ${(error as Error).message}`);
			return;
		}
		const body = JSON.stringify({ apps });
		const hash = hashOf(Buffer.from(body));
		if (this.inventorySent && this.store.state.inventory === hash) return;
		const res = await fetch(new URL("/sync/v1/inventory", this.o.studio), { method: "PUT", headers: { Authorization: `Bearer ${this.o.key}`, "Content-Type": "application/json" }, body });
		await res.arrayBuffer().catch(() => undefined);
		if (!res.ok && res.status !== 404) {
			this.log(`the app list was not taken: ${res.status}`);
			return;
		}
		this.inventorySent = true;
		this.store.state.inventory = hash;
	}

	// ---- the live socket ----

	/** Studio's live socket, opened again 2 s after it closes until sync stops; each message it brings is `heard`. */
	listen(heard: (e: LiveEvent) => void) {
		const live = new URL("/sync/v1/live", this.o.studio);
		live.protocol = live.protocol === "https:" ? "wss:" : "ws:";
		const connect = () => {
			if (this.scheduler.stopped) return;
			const ws = new WebSocket(live, { headers: { Authorization: `Bearer ${this.o.key}` } });
			this.ws = ws;
			ws.on("message", (m) => {
				let e: LiveEvent;
				try {
					// A message this harness does not know (from a newer Studio) is nothing to sync.
					const got = LiveEvent.safeParse(JSON.parse(String(m)));
					if (!got.success) return;
					e = got.data;
				} catch {
					return;
				}
				if (e.type === "token.ask") return this.giveToken(e, ws);
				// Every hello is a catch-up, the first too: a change made between the first full pass and this
				// socket opening was said to nobody, and would wait for the five-minute pass.
				heard(e);
			});
			ws.on("close", (code) => {
				// 4001: Studio revoked this harness's key. What was given through it goes too (`unlinked`).
				if (code === 4001) this.o.unlinked?.("revoked");
				setTimeout(connect, 2000);
			});
			ws.on("error", () => {});
		};
		connect();
	}

	/**
	 * Studio asking, on the socket this harness's key opened, for a token for one of its people's
	 * browsers: issued here (`issueToken`), or refused with a sentence, and answered on the same socket.
	 */
	private giveToken(ask: Extract<LiveEvent, { type: "token.ask" }>, ws: WebSocket) {
		let answer: TokenGiven;
		try {
			if (!this.o.issueToken) throw new Error("This harness gives no tokens through Studio; it needs updating.");
			const { token, expires } = this.o.issueToken({ user: ask.user, origin: ask.origin });
			answer = { type: "token", id: ask.id, token, expires };
		} catch (error) {
			answer = { type: "token", id: ask.id, error: (error as Error).message };
		}
		ws.send(JSON.stringify(answer));
	}

	/**
	 * Where someone on this harness is on a canvas kept on Studio: said up the live socket, naming them
	 * (`by`), for Studio to say to everyone else on the canvas. Nothing when the canvas is not on Studio
	 * or the socket is down: where a pointer was is not news later.
	 */
	presence(name: string, message: PresenceMessage): void {
		const s = this.store.state.canvases[name];
		if (!s || !this.ws || this.ws.readyState !== this.ws.OPEN) return;
		const { by, ...rest } = message;
		this.ws.send(JSON.stringify({ type: "presence", canvas: s.id, by, ...rest }));
	}

	close() {
		this.ws?.close();
	}
}
