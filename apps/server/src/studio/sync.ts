import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, watch, type FSWatcher } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { diff, parse, serialize, type PenDocument } from "@decks/pen";
import WebSocket from "ws";

/** What Studio's sync API lists (decks-studio's packages/sync). */
interface SyncCanvas { id: string; name: string; title: string; rev: number; role: "owner" | "edit" | "view"; owner: string }
interface SyncFile { path: string; version: number; hash: string; size: number; at: number }
type LiveEvent = { type: string; by?: string };

/**
 * Keeps this harness's deck folder and Decks Studio in step, once Studio has given it an API key.
 *
 * Nothing else in the harness knows: it goes on reading and writing its folder, and so do its
 * agents, and this watches the same folder from inside the same process. A canvas's drawing is pushed as edits (`diff` against the
 * last version both sides agreed on) and merged item by item in Studio; boards, assets and board
 * pictures are whole files with versions. What Studio has that the folder lacks is written in.
 *
 * What it remembers between runs is in `<deck>/.decks/studio-sync.json`.
 */
export interface SyncOptions {
	deck: string;
	studio: string;
	key: string;
	/** Files bigger than this wait until something opens them (not yet: they are skipped and listed). */
	eagerBytes?: number;
	log?: (line: string) => void;
}

interface State {
	studio: string;
	/** The Studio account this state belongs to: a key for another account starts afresh. */
	user?: string;
	canvases: Record<string, { id: string; rev: number; pen: string }>;
	files: Record<string, { version: number; hash: string }>;
}

const SYNCED = ["boards", "assets"];
const PICTURES = ".pictures";

export class HarnessSync {
	private state: State;
	private readonly file: string;
	private me = "";
	private user = "";
	private ws?: WebSocket;
	private watchers: FSWatcher[] = [];
	private timer?: NodeJS.Timeout;
	private running = Promise.resolve();
	private stopped = false;
	readonly skipped = new Set<string>();
	readonly conflicts: string[] = [];

	constructor(private readonly o: SyncOptions) {
		this.file = join(o.deck, ".decks", "studio-sync.json");
		const saved = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as State) : undefined;
		this.state = saved && saved.studio === o.studio ? saved : { studio: o.studio, canvases: {}, files: {} };
	}

	private log(line: string) {
		(this.o.log ?? ((l) => console.log(`[decks] studio: ${l}`)))(line);
	}

	private async call(method: string, path: string, body?: unknown, raw?: Uint8Array): Promise<any> {
		const res = await fetch(new URL(path, this.o.studio), { method, headers: { Authorization: `Bearer ${this.o.key}`, "Content-Type": raw ? "application/octet-stream" : "application/json" }, body: raw ? (raw as unknown as BodyInit) : body === undefined ? undefined : JSON.stringify(body) });
		if (path.startsWith("/sync/v1/blobs/")) {
			if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
			return new Uint8Array(await res.arrayBuffer());
		}
		const json = await res.json();
		if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${json.error ?? ""}`);
		return json;
	}

	private save() {
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(this.file, JSON.stringify(this.state));
	}

	/** One pass over everything; passes queue, so two never overlap. */
	sync(): Promise<void> {
		this.running = this.running.then(() => this.pass()).catch((error) => this.log(`pass failed: ${(error as Error).message}`));
		return this.running;
	}

	private async pass() {
		if (!this.me) {
			const hello = await this.call("GET", "/sync/v1/hello");
			this.me = hello.harness.id;
			this.user = hello.user.id;
			if (this.state.user !== this.user) this.state = { studio: this.o.studio, user: this.user, canvases: {}, files: {} };
			this.log(`connected to ${this.o.studio} as ${hello.user.email}, harness "${hello.harness.name}"`);
		}
		await this.syncCanvases();
		await this.syncFiles();
		this.save();
	}

	// ---- canvases ----

	private localCanvases(): string[] {
		const dir = join(this.o.deck, "canvases");
		return existsSync(dir) ? readdirSync(dir).filter((n) => existsSync(join(dir, n, "canvas.pen"))) : [];
	}

	private folderFor(c: SyncCanvas): string {
		return c.owner === this.user ? c.name : `shared-${c.owner.slice(0, 6)}-${c.name}`;
	}

	private async syncCanvases() {
		let remote: SyncCanvas[] = (await this.call("GET", "/sync/v1/canvases")).canvases;
		const known = new Set(Object.values(this.state.canvases).map((c) => c.id));
		// Every local canvas Studio has not seen goes up, the first time this harness connects and after.
		for (const name of this.localCanvases()) {
			if (this.state.canvases[name]) continue;
			const text = readFileSync(join(this.o.deck, "canvases", name, "canvas.pen"), "utf8");
			const title = this.titleOf(name);
			const { canvas } = await this.call("POST", "/sync/v1/canvases", { name, title, pen: parse(text) });
			const full = await this.call("GET", `/sync/v1/canvases/${canvas.id}`);
			this.state.canvases[name] = { id: canvas.id, rev: full.rev, pen: serialize(full.pen) };
			this.writePen(name, full.pen, text);
			known.add(canvas.id);
			this.log(`uploaded canvas ${name}`);
		}
		remote = (await this.call("GET", "/sync/v1/canvases")).canvases;
		const byId = new Map(remote.map((c) => [c.id, c]));
		// Every Studio canvas this folder lacks comes down.
		for (const c of remote) {
			if (known.has(c.id)) continue;
			const name = this.folderFor(c);
			const full = await this.call("GET", `/sync/v1/canvases/${c.id}`);
			this.writePen(name, full.pen);
			this.writeTitle(name, c.title);
			this.state.canvases[name] = { id: c.id, rev: full.rev, pen: serialize(full.pen) };
			this.log(`downloaded canvas ${name}`);
		}
		for (const [name, s] of Object.entries(this.state.canvases)) {
			const c = byId.get(s.id);
			if (!c) {
				this.log(`canvas ${name} is gone from Studio or no longer shared; the local copy stays`);
				delete this.state.canvases[name];
				continue;
			}
			await this.syncCanvas(name, c);
		}
	}

	private async syncCanvas(name: string, remote: SyncCanvas) {
		const s = this.state.canvases[name];
		if (!s) return;
		const path = join(this.o.deck, "canvases", name, "canvas.pen");
		if (!existsSync(path)) return;
		const text = readFileSync(path, "utf8");
		let local: PenDocument;
		try {
			local = parse(text);
		} catch {
			return; // Mid-write, or a hand edit that does not parse yet: next pass.
		}
		const base = parse(s.pen);
		const edits = diff(base, local);
		if (edits.length && remote.role !== "view") {
			const r = await this.call("POST", `/sync/v1/canvases/${s.id}/edits`, { base: s.rev, edits });
			if (r.dropped) this.log(`${name}: ${r.dropped} of your edits touched items someone else removed`);
			this.state.canvases[name] = { id: s.id, rev: r.rev, pen: serialize(r.pen) };
			this.writePen(name, r.pen, text);
		} else if (remote.rev !== s.rev || edits.length) {
			const full = await this.call("GET", `/sync/v1/canvases/${s.id}`);
			this.state.canvases[name] = { id: s.id, rev: full.rev, pen: serialize(full.pen) };
			this.writePen(name, full.pen, text);
		}
	}

	/** Written in place, never renamed over: the harness watches this file. */
	private writePen(name: string, pen: PenDocument, current?: string) {
		const path = join(this.o.deck, "canvases", name, "canvas.pen");
		const text = serialize(pen);
		if (current !== undefined && current === text) return;
		if (existsSync(path) && readFileSync(path, "utf8") === text) return;
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, text);
	}

	private titleOf(name: string): string {
		const meta = join(this.o.deck, "canvases", name, "canvas.json");
		try {
			return JSON.parse(readFileSync(meta, "utf8")).title ?? name;
		} catch {
			return name;
		}
	}

	private writeTitle(name: string, title: string) {
		const meta = join(this.o.deck, "canvases", name, "canvas.json");
		if (!existsSync(meta)) writeFileSync(meta, JSON.stringify({ title, boards: [] }, null, "\t"));
	}

	// ---- files ----

	private localFiles(): Map<string, string> {
		const out = new Map<string, string>();
		const walk = (dir: string) => {
			if (!existsSync(dir)) return;
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const full = join(dir, entry.name);
				if (entry.name.startsWith(".")) continue;
				if (entry.isDirectory()) walk(full);
				else if (entry.isFile()) out.set(relative(this.o.deck, full).split(sep).join("/"), full);
			}
		};
		for (const top of SYNCED) walk(join(this.o.deck, top));
		return out;
	}

	private async syncFiles() {
		const remote = new Map<string, SyncFile>(((await this.call("GET", "/sync/v1/files")).files as SyncFile[]).map((f) => [f.path, f]));
		const local = this.localFiles();
		const eager = this.o.eagerBytes ?? 1024 * 1024;
		for (const [path, full] of local) {
			const bytes = readFileSync(full);
			const hash = sha256(bytes);
			const known = this.state.files[path];
			const there = remote.get(path);
			if (known?.hash === hash && (!there || there.version === known.version)) continue;
			if (known?.hash === hash && there && there.version !== known.version) {
				await this.download(path, there);
				continue;
			}
			if (there && there.hash === hash) {
				this.state.files[path] = { version: there.version, hash };
				continue;
			}
			if (bytes.length > 50 * 1024 * 1024) {
				this.skipped.add(path);
				continue;
			}
			const base = known?.version ?? there?.version;
			const put = await this.call("PUT", `/sync/v1/files?path=${encodeURIComponent(path)}${base !== undefined ? `&base=${base}` : ""}`, undefined, bytes);
			if (put.current) this.state.files[path] = { version: put.version, hash };
			else {
				this.conflicts.push(path);
				this.log(`${path} changed in Studio too: Studio's stays current, yours is kept there as version ${put.version}`);
				await this.download(path, remote.get(path)!);
			}
		}
		for (const [path, f] of remote) {
			if (path.startsWith(`${PICTURES}/`) || local.has(path)) continue;
			if (f.size > eager && !path.startsWith("boards/")) {
				this.skipped.add(path);
				continue;
			}
			await this.download(path, f);
		}
		await this.syncPictures(remote);
	}

	private async download(path: string, f: SyncFile) {
		const bytes = await this.call("GET", `/sync/v1/blobs/${f.hash}`);
		const full = join(this.o.deck, ...path.split("/"));
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, bytes);
		this.state.files[path] = { version: f.version, hash: f.hash };
		this.log(`downloaded ${path}`);
	}

	/** Each board's newest whole picture, so Studio can show it when no harness can serve the page. */
	private async syncPictures(remote: Map<string, SyncFile>) {
		const dir = join(this.o.deck, ".decks", "thumbs");
		if (!existsSync(dir)) return;
		const thumbs = readdirSync(dir);
		for (const path of this.localFiles().keys()) {
			if (!path.startsWith("boards/") || !path.endsWith(".html")) continue;
			const prefix = createHash("sha1").update(path).digest("hex").slice(0, 16);
			for (const scheme of ["light", "dark"]) {
				const re = new RegExp(`^${prefix}-\\d+-${scheme}-\\d+-whole-l\\d+\\.webp$`);
				const newest = thumbs.filter((t) => re.test(t)).map((t) => ({ t, at: statSync(join(dir, t)).mtimeMs })).sort((a, b) => b.at - a.at)[0];
				if (!newest) continue;
				const target = `${PICTURES}/${path}.${scheme}.webp`;
				const bytes = readFileSync(join(dir, newest.t));
				const hash = sha256(bytes);
				if (remote.get(target)?.hash === hash) continue;
				await this.call("PUT", `/sync/v1/files?path=${encodeURIComponent(target)}`, undefined, bytes);
			}
		}
	}

	// ---- staying in step ----

	/** Sync now, then on every change on either side, and every 30 s besides. */
	async start(): Promise<void> {
		await this.sync();
		const live = new URL("/sync/v1/live", this.o.studio);
		live.protocol = live.protocol === "https:" ? "wss:" : "ws:";
		const connect = () => {
			if (this.stopped) return;
			this.ws = new WebSocket(live, { headers: { Authorization: `Bearer ${this.o.key}` } });
			this.ws.on("message", (m) => {
				const e = JSON.parse(String(m)) as LiveEvent;
				if (e.type !== "hello" && (!("by" in e) || e.by !== this.me)) this.soon(50);
			});
			this.ws.on("close", () => setTimeout(connect, 2000));
			this.ws.on("error", () => {});
		};
		connect();
		for (const top of ["canvases", ...SYNCED]) {
			const dir = join(this.o.deck, top);
			if (existsSync(dir)) this.watchers.push(watch(dir, { recursive: true }, () => this.soon(300)));
		}
		this.timer = setInterval(() => this.sync(), 30_000);
	}

	private pending?: NodeJS.Timeout;
	private soon(ms: number) {
		clearTimeout(this.pending);
		this.pending = setTimeout(() => this.sync(), ms);
	}

	async stop() {
		this.stopped = true;
		clearTimeout(this.pending);
		clearInterval(this.timer);
		for (const w of this.watchers) w.close();
		this.ws?.close();
		await this.running;
	}
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}
