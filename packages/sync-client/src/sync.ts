import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync as readFileRaw, renameSync, rmSync, statSync, writeFileSync as writeFileRaw, watch, type FSWatcher } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { applyEdits, diff, parse, serialize, type PenDocument, type PenEdit } from "@decks/pen";
import WebSocket from "ws";
import { canvasFolder, ownerFolderBase, plainSegment, servedAs, SHARED_CANVASES, sharedName, sharedParts } from "@decks/hub/layout";
import { HashCache, RECHECK_MS, sha256 as hashOf } from "./hash-cache.ts";

import { LiveEvent, OWN_PARTS, MIRRORED_PARTS, PICTURES, safeCanvasFolder, safeCanvasName, safeSyncPath, secretLooking, type SyncCanvas, type SyncFile } from "@decks/sync-protocol";

// The rules a harness checks what a service sends against, from @decks/sync-protocol.
export { safeCanvasFolder, safeCanvasName, safeSyncPath, secretLooking };
const MIRRORED: readonly string[] = MIRRORED_PARTS;

/**
 * Keeps this harness's canvases and Decks Studio in step, once Studio has given it an API key.
 *
 * Nothing else in the harness knows: it goes on reading and writing its folder, and so do its
 * agents, and this watches the same folder from inside the same process.
 *
 * A canvas is a folder that stands alone (`deck/layout.ts`), and it goes to Studio as one bundle:
 * its drawing, pushed as edits (`diff` against the last version both sides agreed on) and merged item
 * by item in Studio; and its files, whole, with versions, by their path in the canvas's folder —
 * its `boards/`, `frames/` and `files/`, the deck's `assets/` and `docs/` files its boards point at
 * (at their deck paths, `assets/…`, `docs/…`), and pictures (`.pictures/…`). Studio keeps them with
 * the canvas, so sharing a canvas shares that bundle and nothing else of this deck.
 *
 * A canvas a friend shared comes down into `shared/canvases/<their name>/<canvas>/`, bundle and all,
 * the deck files mirrored inside it, so its boards read their own copies and never this deck's. If
 * they let you edit it, your changes go back; if only view, it follows theirs. When they stop sharing
 * it, its folder is moved to `.decks/shared-removed/`, never deleted.
 *
 * It works one canvas at a time: a live message about a canvas syncs that canvas (its edits come in
 * the message, or as the changes since this harness's revision; the whole drawing only when Studio's
 * log no longer reaches back), and a change in a canvas's folder syncs that canvas. A file is hashed
 * again only when its size or time changed (`hash-cache.ts`). A full pass over everything runs on
 * connecting and every 5 minutes, as a backstop; every 10 minutes it hashes every file again.
 *
 * What it remembers between runs is in `<deck>/.decks/`: `studio-sync.json` (each canvas's revision
 * and its files' versions), `sync/<canvas id>.pen` (each canvas's drawing as both sides last agreed
 * on, what local edits are worked out against) and `studio-hashes.json` (the hash cache).
 */
export interface SyncOptions {
	deck: string;
	studio: string;
	key: string;
	log?: (line: string) => void;
	/**
	 * This harness's own address (`http://127.0.0.1:4329`), for a picture of each canvas: Studio
	 * shows it on the canvas's card. Absent: no canvas pictures, only boards'.
	 */
	harness?: string;
	/** A person token for this harness, read per call: what its screenshot call carries (`auth/guard.ts`). */
	harnessToken?: () => string;
	/**
	 * This harness's apps (`apps/service.ts`), told to Studio so it can list them beside the
	 * canvases. Absent: nothing is told.
	 */
	inventory?: () => Array<{ name: string; title: string; kind: string; board: string }>;
}

interface CanvasState {
	id: string;
	rev: number;
	/** The drawing both sides last agreed on, kept here before 2026-10-21; now in `.decks/sync/<id>.pen`. */
	pen?: string;
	/** The canvas's files both sides last agreed on, by their path in the canvas's folder. */
	files: Record<string, { version: number; hash: string }>;
}

interface State {
	studio: string;
	/** The Studio account this state belongs to: a key for another account starts afresh. */
	user?: string;
	/** By the canvas's name here: `plan`, or `shared/<owner>/<canvas>` for a friend's. */
	canvases: Record<string, CanvasState>;
	/** The folder each friend's canvases land in, by their account id: their name, made unique once. */
	owners?: Record<string, string>;
	/** The hash of the app list last told to Studio. */
	inventory?: string;
}

/**
 * What sync costs, counted for the bench (`DECKS_STUDIO_STATS`: a file each pass appends one JSON
 * line to): bytes read from disk, bytes hashed and how many files, bytes written, bytes Studio sent,
 * how many canvases a pass looked at, and the time spent taking canvas pictures (at most one a minute each).
 */
const cost = { read: 0, hashed: 0, files: 0, written: 0, received: 0, canvases: 0, pictureMs: 0 };
const readFileSync = ((...args: Parameters<typeof readFileRaw>) => {
	const out = readFileRaw(...args);
	cost.read += out.length;
	return out;
}) as typeof readFileRaw;
const writeFileSync = ((file: Parameters<typeof writeFileRaw>[0], data: string | Uint8Array, options?: Parameters<typeof writeFileRaw>[2]) => {
	cost.written += typeof data === "string" ? Buffer.byteLength(data) : data.length;
	writeFileRaw(file, data, options);
}) as typeof writeFileRaw;

/** The backstop: a pass over every canvas this often, besides the targeted ones. */
export const FULL_PASS_MS = 5 * 60_000;
/** Files bigger than this are not synced, and are listed in `skipped`. */
const MAX_BYTES = 50 * 1024 * 1024;

/*
 * What Studio sends is not trusted to name places on this disk. A canvas's name becomes a folder
 * under canvases/ or shared/canvases/, an owner's name a folder under shared/canvases/, and a file's
 * path a file in that canvas's folder (or this deck's assets/ and docs/); any of them, unchecked,
 * could be `../../.ssh/authorized_keys`. So a name is one plain segment, a path is in a bundle part
 * with no `..` and no hidden part, and nothing is written through a symbolic link. Anything else is
 * skipped and said in the log.
 */
/**
 * Where a deck-relative path lands, or a sentence saying why it may not: outside the deck, in a
 * hidden folder, or through a symbolic link anywhere on the way (one an agent made would send the
 * write elsewhere).
 */
export function landingFor(deck: string, path: string): { full: string } | { refused: string } {
	if (typeof path !== "string" || !path || path.includes("\\") || path.includes("\0")) return { refused: "not a plain path" };
	const parts = path.split("/");
	if (parts.some((part) => part === "" || part === "." || part === ".." || (part.startsWith(".") && part !== PICTURES))) return { refused: "not a plain path, or in a hidden folder" };
	const full = resolve(deck, ...parts);
	const inside = relative(resolve(deck), full);
	if (!inside || inside.startsWith("..") || isAbsolute(inside)) return { refused: "outside the deck" };
	let at = resolve(deck);
	for (const part of inside.split(sep)) {
		at = join(at, part);
		let link = false;
		try {
			link = lstatSync(at).isSymbolicLink();
		} catch {
			break; // Not there yet: nothing further on can be a link either.
		}
		if (link) return { refused: `${relative(deck, at).split(sep).join("/")} is a symbolic link` };
	}
	return { full };
}

/** A link in a board's text: in quotes, `url(…)` or a markdown link, with a file extension. */
const LINK = /(["'(])((?:\.{1,2}\/)*[A-Za-z0-9_ -￿][^"'()\s<>?#|*:]*\.[A-Za-z0-9]{1,8})(?=[?#"')])/g;

export class HarnessSync {
	private state: State;
	private readonly file: string;
	/** Where each canvas's last agreed drawing is kept: `.decks/sync/<canvas id>.pen`. */
	private readonly bases: string;
	private readonly hashes: HashCache;
	private me = "";
	private user = "";
	private ws?: WebSocket;
	private watchers: FSWatcher[] = [];
	private timer?: NodeJS.Timeout;
	private running = Promise.resolve();
	private stopped = false;
	readonly skipped = new Set<string>();
	/** Canvases whose drawing changed since their picture was last taken, and when each was taken. */
	private pictureDue = new Set<string>();
	private pictureAt = new Map<string, number>();
	readonly conflicts: string[] = [];
	/** Whether this connection has told Studio the app list yet: once on connecting, then on a change. */
	private inventorySent = false;
	/** The state as last written, so an unchanged one is not written again. */
	private written = "";

	// ---- what a targeted pass has to do ----
	/** The last agreed drawing of each canvas, by its Studio id, parsed, with its text. */
	private base = new Map<string, { doc: PenDocument; text: string }>();
	/** Each canvas.pen as this harness last read or wrote it (size, time), by name: one that has not changed since is not read again. */
	private penSeen = new Map<string, { size: number; mtimeMs: number }>();
	/** Studio's canvases as last listed, by id: their role, owner and revision. */
	private remote = new Map<string, SyncCanvas>();
	/** The newest revision Studio has said each canvas is at, by id. */
	private latest = new Map<string, number>();
	/** Edits that came inside live messages and are not applied yet, by canvas id. */
	private inbox = new Map<string, { base: number; rev: number; changes: PenEdit[] }[]>();
	/** Canvases (by id) Studio says changed; canvases (by name) whose drawing, files or board pictures changed here. */
	private pull = new Set<string>();
	private dirtyPens = new Set<string>();
	private dirtyFiles = new Set<string>();
	private dirtyPictures = new Set<string>();
	/** Something only a full pass covers: a new canvas, a share, a lost connection. */
	private fullDue = false;
	/** When every file was last hashed whatever the cache said. */
	private checkedAt = 0;
	/** Whether Studio answers `changes?since=` (one from before 2026-10-21 does not: the whole drawing then). */
	private changesRoute = true;
	/** The deck files each canvas's boards point at, by canvas name, and each board's links by its deck path with its size and time. */
	private links = new Map<string, Set<string>>();
	private boardLinks = new Map<string, { size: number; mtimeMs: number; targets: string[] }>();
	/** Which canvas a board picture in `.decks/thumbs` belongs to, by its file name's prefix. */
	private thumbOwner = new Map<string, string>();

	constructor(private readonly o: SyncOptions) {
		this.file = join(o.deck, ".decks", "studio-sync.json");
		this.bases = join(o.deck, ".decks", "sync");
		this.hashes = new HashCache(join(o.deck, ".decks", "studio-hashes.json"));
		let saved: State | undefined;
		try {
			saved = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as State) : undefined;
		} catch {
			saved = undefined;
		}
		this.state = saved && saved.studio === o.studio ? saved : { studio: o.studio, canvases: {} };
		for (const one of Object.values(this.state.canvases)) {
			// A state from before canvases were bundles: each canvas's files are worked out again on the next pass.
			one.files ??= {};
			// A state from before the drawings had files of their own: each moves out to `.decks/sync/<id>.pen`.
			if (typeof one.pen === "string") {
				try {
					this.keepBase(one.id, parse(one.pen), one.pen);
				} catch {
					/* unreadable: the next pass takes Studio's as the base */
				}
				delete one.pen;
			}
		}
		delete (this.state as { files?: unknown }).files;
	}

	private log(line: string) {
		(this.o.log ?? ((l) => console.log(`[decks] studio: ${l}`)))(line);
	}

	private async call(method: string, path: string, body?: unknown, raw?: Uint8Array): Promise<any> {
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
		if (!res.ok) throw Object.assign(new Error(`${method} ${path}: ${res.status} ${json.error ?? ""}`), { status: res.status });
		return json;
	}

	/** The state, only this account's to read, written when it changed: it holds revisions and file versions, no drawings. */
	private save() {
		const text = JSON.stringify(this.state);
		if (text !== this.written) {
			mkdirSync(dirname(this.file), { recursive: true });
			writeFileSync(this.file, text, { mode: 0o600 });
			try {
				chmodSync(this.file, 0o600);
			} catch {
				/* a filesystem without modes */
			}
			this.written = text;
		}
		this.hashes.save();
	}

	/** One pass over everything; passes queue, so two never overlap. */
	sync(): Promise<void> {
		return this.queue(() => this.pass());
	}

	private queue(work: () => Promise<void>): Promise<void> {
		this.running = this.running.then(() => this.measured(work)).catch((error) => this.log(`pass failed: ${(error as Error).message}`));
		return this.running;
	}

	/** A pass, and what it cost, as one line in `DECKS_STUDIO_STATS` when that names a file. */
	private async measured(work: () => Promise<void>) {
		const started = performance.now();
		const was = { ...cost, cacheHashed: this.hashes.cost.hashed, cacheFiles: this.hashes.cost.files };
		await work();
		const file = process.env.DECKS_STUDIO_STATS;
		if (file) {
			const spent = Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, Math.round(v - was[k as keyof typeof cost])]));
			const hashed = this.hashes.cost.hashed - was.cacheHashed;
			spent.hashed! += hashed;
			spent.read! += hashed;
			spent.files! += this.hashes.cost.files - was.cacheFiles;
			appendFileSync(file, `${JSON.stringify({ at: Date.now(), ms: Math.round((performance.now() - started) * 10) / 10, ...spent })}\n`);
		}
	}

	private async hello() {
		if (this.me) return;
		const hello = await this.call("GET", "/sync/v1/hello");
		this.me = hello.harness.id;
		this.user = hello.user.id;
		if (this.state.user !== this.user) {
			this.state = { studio: this.o.studio, user: this.user, canvases: {} };
			this.base.clear();
		}
		this.log(`connected to ${this.o.studio} as ${hello.user.email}, harness "${hello.harness.name}"`);
	}

	/** Everything: every canvas both ways, its files, pictures and the app list. */
	private async pass() {
		await this.hello();
		this.fullDue = false;
		const fresh = Date.now() - this.checkedAt >= RECHECK_MS;
		if (fresh) this.penSeen.clear();
		this.pull.clear();
		this.dirtyPens.clear();
		this.dirtyFiles.clear();
		this.dirtyPictures.clear();
		await this.syncCanvases(fresh);
		await this.syncInventory();
		if (fresh) {
			this.checkedAt = Date.now();
			this.hashes.prune();
		}
		this.save();
		// A change to a friend's canvas that came down in this pass is seen at once, not on the next full pass.
		this.watchFolders();
	}

	/** Only what changed: the canvases Studio named, and those whose folder changed here. */
	private async targeted() {
		if (this.fullDue || !this.me) return this.pass();
		const byId = new Map(Object.entries(this.state.canvases).map(([name, s]) => [s.id, name]));
		const pens = new Set(this.dirtyPens);
		const files = new Set(this.dirtyFiles);
		const pictures = new Set(this.dirtyPictures);
		const pulls = new Set(this.pull);
		this.dirtyPens.clear();
		this.dirtyFiles.clear();
		this.dirtyPictures.clear();
		this.pull.clear();
		for (const id of pulls) {
			const name = byId.get(id);
			if (!name) return this.pass();
			pens.add(name);
		}
		for (const name of new Set([...pens, ...files, ...pictures])) {
			const s = this.state.canvases[name];
			const c = s && this.remote.get(s.id);
			// A canvas Studio has not listed to this harness yet (new here, or just shared): a full pass takes it up.
			if (!c) return this.pass();
			if (pens.has(name)) await this.syncCanvas(name, c);
			if (files.has(name)) await this.syncCanvasFiles(name, c, false);
			else if (pictures.has(name) && c.role !== "view") await this.syncPictures(name, s.id);
		}
		await this.syncCanvasPictures();
		this.save();
	}

	// ---- where things are ----

	/** A canvas's folder here, absolute. */
	private folder(name: string): string {
		return join(this.o.deck, canvasFolder(name));
	}

	/** This deck's own canvases: folders under canvases/ with a drawing. */
	private localCanvases(): string[] {
		const dir = join(this.o.deck, "canvases");
		return existsSync(dir) ? readdirSync(dir).filter((n) => safeCanvasFolder(n) && plainSegment(n) && existsSync(join(dir, n, "canvas.pen"))) : [];
	}

	/**
	 * The folder a friend's canvases land in: their Studio name, as a folder name, made unique once
	 * against another friend of the same name and remembered, so it never moves under them.
	 */
	private ownerFolder(c: SyncCanvas): string | undefined {
		const owners = (this.state.owners ??= {});
		if (owners[c.owner]) return owners[c.owner];
		const id = String(c.owner ?? "");
		if (!/^[A-Za-z0-9_-]+$/.test(id)) return undefined;
		const base = ownerFolderBase(c.ownerName ?? "");
		const taken = new Set(Object.values(owners));
		const name = taken.has(base) ? `${base}-${id.slice(0, 6)}` : base;
		owners[c.owner] = name;
		return name;
	}

	/** The name a Studio canvas has here, or undefined when its name could name somewhere else. */
	private nameFor(c: SyncCanvas): string | undefined {
		if (!safeCanvasName(c.name)) return undefined;
		if (c.owner === this.user) return c.name;
		const owner = this.ownerFolder(c);
		return owner ? sharedName(owner, c.name) : undefined;
	}

	private shared(name: string): boolean {
		return sharedParts(name) !== undefined;
	}

	// ---- the last agreed drawing of each canvas ----

	private basePath(id: string): string {
		return join(this.bases, `${id.replace(/[^A-Za-z0-9_-]/g, "_")}.pen`);
	}

	/** Keep a canvas's last agreed drawing, in memory and in `.decks/sync/<id>.pen`, when it changed. */
	private keepBase(id: string, doc: PenDocument, text = serialize(doc)) {
		if (this.base.get(id)?.text === text) return;
		mkdirSync(this.bases, { recursive: true, mode: 0o700 });
		writeFileSync(this.basePath(id), text, { mode: 0o600 });
		this.base.set(id, { doc, text });
	}

	/** A canvas's last agreed drawing, from memory or its file; undefined when there is none. */
	private baseOf(id: string): { doc: PenDocument; text: string } | undefined {
		const kept = this.base.get(id);
		if (kept) return kept;
		try {
			const text = readFileSync(this.basePath(id), "utf8");
			const one = { doc: parse(text), text };
			this.base.set(id, one);
			return one;
		} catch {
			return undefined;
		}
	}

	private forgetCanvas(name: string) {
		const s = this.state.canvases[name];
		if (s) {
			this.base.delete(s.id);
			this.inbox.delete(s.id);
			rmSync(this.basePath(s.id), { force: true });
		}
		this.penSeen.delete(name);
		this.links.delete(name);
		delete this.state.canvases[name];
	}

	// ---- canvases ----

	private async syncCanvases(fresh: boolean) {
		let remote: SyncCanvas[] = (await this.call("GET", "/sync/v1/canvases")).canvases;
		const known = new Set(Object.values(this.state.canvases).map((c) => c.id));
		// Every canvas of this deck Studio has not seen goes up, the first time this harness connects and after.
		for (const name of this.localCanvases()) {
			if (this.state.canvases[name]) continue;
			const text = readFileSync(join(this.folder(name), "canvas.pen"), "utf8");
			const { canvas } = await this.call("POST", "/sync/v1/canvases", { name, title: this.titleOf(name), pen: parse(text) });
			const full = await this.call("GET", `/sync/v1/canvases/${canvas.id}`);
			this.state.canvases[name] = { id: canvas.id, rev: full.rev, files: {} };
			this.keepBase(canvas.id, full.pen);
			this.writePen(name, this.base.get(canvas.id)!.text, { text });
			this.writeMeta(name, { studio: canvas.id });
			known.add(canvas.id);
			this.pictureDue.add(name);
			this.log(`uploaded canvas ${name}`);
		}
		remote = (await this.call("GET", "/sync/v1/canvases")).canvases;
		const byId = new Map(remote.map((c) => [c.id, c]));
		this.remote = byId;
		// Every Studio canvas this deck lacks comes down: yours to canvases/, a friend's to shared/canvases/.
		for (const c of remote) {
			if (known.has(c.id)) continue;
			const name = this.nameFor(c);
			if (!name) {
				this.log(`skipped Studio canvas ${JSON.stringify(c.name)}: its name is not a plain folder name`);
				continue;
			}
			if (this.state.canvases[name]) continue;
			const full = await this.call("GET", `/sync/v1/canvases/${c.id}`);
			this.keepBase(c.id, full.pen);
			this.writePen(name, this.base.get(c.id)!.text);
			this.writeMeta(name, { title: c.title, studio: c.id, ...(this.shared(name) ? { shared: { owner: c.owner, ownerName: c.ownerName ?? "", role: c.role } } : {}) }, true);
			this.state.canvases[name] = { id: c.id, rev: full.rev, files: {} };
			this.log(this.shared(name) ? `${c.ownerName || "a friend"} shared ${c.title}: it is in ${canvasFolder(name)}` : `downloaded canvas ${name}`);
		}
		for (const [name, s] of Object.entries(this.state.canvases)) {
			const c = byId.get(s.id);
			if (!safeCanvasFolder(name.split("/").at(-1)) || (name.includes("/") && !this.shared(name))) {
				this.log(`forgot canvas ${JSON.stringify(name)}: its name is not a plain folder name`);
				this.forgetCanvas(name);
				continue;
			}
			// A friend's canvas kept where shared canvases came down before (canvases/shared-<id>-<name>): it comes down again to shared/.
			const misplaced = c && c.owner !== this.user && !this.shared(name);
			if (!c || misplaced) {
				this.moveAside(name, !c ? "is gone from Studio or no longer shared" : "is a friend's, and now lives in shared/canvases");
				this.forgetCanvas(name);
				continue;
			}
			if (this.shared(name)) this.writeMeta(name, { title: c.title, shared: { owner: c.owner, ownerName: c.ownerName ?? "", role: c.role } });
			this.latest.set(c.id, Math.max(this.latest.get(c.id) ?? 0, c.rev));
			await this.syncCanvas(name, c);
			await this.syncCanvasFiles(name, c, fresh);
		}
		await this.syncCanvasPictures();
	}

	/**
	 * A canvas gone from Studio, or no longer shared, moved out of the way, never deleted: left where
	 * it is, a canvas of yours would read as a new one and go up again on the next pass.
	 */
	private moveAside(name: string, why: string) {
		const from = this.folder(name);
		const shared = sharedParts(name);
		if (existsSync(from)) {
			const to = shared ? join(this.o.deck, ".decks", "shared-removed", `${shared.owner}-${shared.canvas}-${Date.now()}`) : join(this.o.deck, ".decks", "studio-removed", `${name}-${Date.now()}`);
			mkdirSync(dirname(to), { recursive: true });
			renameSync(from, to);
			this.log(`canvas ${name} ${why}; its folder is moved to ${relative(this.o.deck, to).split(sep).join("/")}`);
		}
	}

	/**
	 * A canvas's drawing as it is here: read and parsed, or, when the file has not changed since this
	 * harness last read or wrote it, the last agreed drawing itself (`same`), with nothing read.
	 */
	private readLocal(name: string, base: { doc: PenDocument; text: string } | undefined): { text: string; doc: PenDocument; same: boolean; size: number; mtimeMs: number } | undefined {
		const path = join(this.folder(name), "canvas.pen");
		let st;
		try {
			st = statSync(path);
		} catch {
			return undefined;
		}
		const seen = this.penSeen.get(name);
		if (base && seen && seen.size === st.size && seen.mtimeMs === st.mtimeMs) return { ...base, same: true, size: st.size, mtimeMs: st.mtimeMs };
		cost.canvases++;
		const text = readFileSync(path, "utf8");
		try {
			const doc = parse(text);
			const same = base !== undefined && text === base.text;
			return { text, doc, same, size: st.size, mtimeMs: st.mtimeMs };
		} catch {
			return undefined; // Mid-write, or a hand edit that does not parse yet: next pass.
		}
	}

	/**
	 * One canvas's drawing both ways: this harness's edits since the last agreed drawing go up, and
	 * Studio's since its revision come down, from live messages, `changes?since=`, or whole.
	 */
	private async syncCanvas(name: string, remote: SyncCanvas) {
		const s = this.state.canvases[name];
		if (!s) return;
		let base = this.baseOf(s.id);
		const local = this.readLocal(name, base);
		if (!local) return;
		if (!base) {
			// No agreed drawing kept (deleted by hand): Studio's as it is now, and this deck's differences go up on it.
			const full = await this.call("GET", `/sync/v1/canvases/${s.id}`);
			this.keepBase(s.id, full.pen);
			s.rev = full.rev;
			base = this.base.get(s.id)!;
		}
		const edits = local.same ? [] : diff(base.doc, local.doc);
		let next: { doc: PenDocument; rev: number } | undefined;
		if (edits.length && remote.role !== "view") {
			this.pictureDue.add(name);
			const r = await this.call("POST", `/sync/v1/canvases/${s.id}/edits`, { base: s.rev, edits, client: this.me });
			if (r.dropped) this.log(`${name}: ${r.dropped} of your edits touched items someone else removed`);
			if (r.pen) next = { doc: r.pen, rev: r.rev }; // A Studio from before edits were answered with changes.
			else if (r.base === s.rev) next = { doc: loosely(base.doc, r.changes ?? []), rev: r.rev };
			else {
				this.latest.set(s.id, Math.max(this.latest.get(s.id) ?? 0, r.rev));
				next = await this.changesSince(s, base.doc);
			}
		} else if (edits.length || (this.latest.get(s.id) ?? s.rev) > s.rev || this.inbox.get(s.id)?.length) {
			next = await this.changesSince(s, base.doc);
			if (next) this.pictureDue.add(name);
		}
		if (!next) {
			// Nothing to do, and the file is what was agreed: not read again until it changes.
			if (local.same || !edits.length) this.penSeen.set(name, { size: local.size, mtimeMs: local.mtimeMs });
			return;
		}
		/*
		 * The file first, then the agreed drawing, then (at the end of the pass) the revision: stopped
		 * between any two, the next pass finds the edits already made, which change nothing again.
		 */
		const text = serialize(next.doc);
		this.writePen(name, text, local);
		this.keepBase(s.id, next.doc, text);
		s.rev = next.rev;
		this.latest.set(s.id, Math.max(this.latest.get(s.id) ?? 0, s.rev));
	}

	/**
	 * Studio's drawing at its newest revision, from the last agreed one: the edits that came in live
	 * messages when they follow on, else `changes?since=`, else (the log no longer reaches back, or an
	 * older Studio) the whole drawing.
	 */
	private async changesSince(s: CanvasState, from: PenDocument): Promise<{ doc: PenDocument; rev: number }> {
		let doc = from;
		let rev = s.rev;
		const waiting = (this.inbox.get(s.id) ?? []).sort((a, b) => a.rev - b.rev);
		this.inbox.delete(s.id);
		try {
			for (const m of waiting) {
				if (m.rev <= rev) continue;
				if (m.base !== rev) break;
				doc = loosely(doc, m.changes);
				rev = m.rev;
			}
		} catch {
			doc = from;
			rev = s.rev;
		}
		if (rev >= (this.latest.get(s.id) ?? 0) && rev !== s.rev) return { doc, rev };
		if (this.changesRoute) {
			try {
				const got = await this.call("GET", `/sync/v1/canvases/${s.id}/changes?since=${rev}`);
				if (!got.tooOld && Array.isArray(got.changes)) {
					for (const edits of got.changes as PenEdit[][]) doc = loosely(doc, edits);
					return { doc, rev: got.rev };
				}
			} catch (error) {
				if ((error as { status?: number }).status === 404 && !(await this.canvasThere(s.id))) throw error;
				if ((error as { status?: number }).status === 404) this.changesRoute = false;
			}
		}
		const full = await this.call("GET", `/sync/v1/canvases/${s.id}`);
		return { doc: full.pen, rev: full.rev };
	}

	/** Whether a 404 was the canvas gone (a full pass deals with that) or Studio without the route. */
	private async canvasThere(id: string): Promise<boolean> {
		try {
			await this.call("GET", `/sync/v1/canvases/${id}?since=${Number.MAX_SAFE_INTEGER}`);
			return true;
		} catch {
			this.fullDue = true;
			return false;
		}
	}

	/**
	 * Written in place, never renamed over: the harness watches this file. `was` is the file as it
	 * was read before Studio was asked; when it changed since (an agent wrote it meanwhile), those
	 * changes are kept on top of Studio's and go up on the next pass.
	 */
	private writePen(name: string, text: string, was?: { text: string; size?: number; mtimeMs?: number }) {
		const path = join(this.folder(name), "canvas.pen");
		let current: string | undefined;
		let st;
		try {
			st = statSync(path);
		} catch {
			st = undefined;
		}
		if (st && was && was.size === st.size && was.mtimeMs === st.mtimeMs) current = was.text;
		else if (st) current = readFileSync(path, "utf8");
		let out = text;
		if (was && current !== undefined && current !== was.text) {
			try {
				const extra = diff(parse(was.text), parse(current));
				out = serialize(loosely(parse(text), extra));
				this.dirtyPens.add(name);
				this.soon(300);
			} catch {
				// What is there does not parse (mid-write): it is left for the next pass.
				return;
			}
		}
		if (current !== out) {
			cost.canvases++;
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, out);
		}
		const after = statSync(path);
		if (out === text) this.penSeen.set(name, { size: after.size, mtimeMs: after.mtimeMs });
	}

	private titleOf(name: string): string {
		try {
			return JSON.parse(readFileSync(join(this.folder(name), "canvas.json"), "utf8")).title ?? name;
		} catch {
			return name;
		}
	}

	/**
	 * What `canvas.json` says about a synced canvas: the Studio canvas it is, and for a friend's, who
	 * shared it and as what (`StagePens.sharing`). `fresh` writes a title too, for one that came down.
	 */
	private writeMeta(name: string, set: { title?: string; studio?: string; shared?: { owner: string; ownerName: string; role: string } }, fresh = false) {
		const file = join(this.folder(name), "canvas.json");
		let meta: Record<string, unknown> = {};
		try {
			meta = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		} catch {
			/* a first record */
		}
		const studio = set.studio ?? (typeof meta.studio === "string" ? meta.studio : undefined);
		const next: Record<string, unknown> = { ...meta, ...((fresh || !meta.title) && set.title ? { title: set.title } : {}), ...(studio ? { studio } : {}), ...(set.shared ? { shared: { ...set.shared, ...(studio ? { studio } : {}) } } : {}) };
		next.boards ??= [];
		if (JSON.stringify(next) === JSON.stringify(meta)) return;
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, `${JSON.stringify(next, null, "\t")}\n`);
	}

	// ---- a canvas's files ----

	/**
	 * Where a file of a canvas's bundle is here, deck-relative: in the canvas's folder, but the deck
	 * files a canvas of this deck points at, which are this deck's own `assets/` and `docs/`.
	 */
	private deckPathOf(name: string, path: string): string {
		const top = path.split("/")[0]!;
		if (!this.shared(name) && MIRRORED.includes(top)) return path;
		return `${canvasFolder(name)}/${path}`;
	}

	/** What a board's text points at, read again only when the board's size or time changed. */
	private linksOf(deckPath: string): string[] {
		const full = join(this.o.deck, deckPath);
		let st;
		try {
			st = statSync(full);
		} catch {
			return [];
		}
		const kept = this.boardLinks.get(deckPath);
		if (kept && kept.size === st.size && kept.mtimeMs === st.mtimeMs) return kept.targets;
		let text: string;
		try {
			text = readFileSync(full, "utf8");
		} catch {
			return [];
		}
		const targets = new Set<string>();
		for (const match of text.matchAll(LINK)) {
			const asked = posix.normalize(posix.join(posix.dirname(deckPath), match[2]!));
			const served = servedAs(asked);
			if (!("path" in served)) continue;
			if (MIRRORED.includes(served.path.split("/")[0]!) && !secretLooking(served.path)) targets.add(served.path);
		}
		const one = { size: st.size, mtimeMs: st.mtimeMs, targets: [...targets] };
		this.boardLinks.set(deckPath, one);
		return one.targets;
	}

	/** A canvas's bundle as it is here: its path in the canvas's folder → the file's deck path. */
	private bundle(name: string): Map<string, string> {
		const out = new Map<string, string>();
		const folder = canvasFolder(name);
		const walk = (dir: string) => {
			let entries;
			try {
				entries = readdirSync(join(this.o.deck, dir), { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
				const path = `${dir}/${entry.name}`;
				if (entry.isDirectory()) walk(path);
				else if (entry.isFile() && !secretLooking(path)) out.set(path.slice(folder.length + 1), path);
			}
		};
		for (const part of [...OWN_PARTS, ...(this.shared(name) ? MIRRORED : [])]) walk(`${folder}/${part}`);
		if (this.shared(name)) return out;
		// The deck files this canvas's boards point at: `../assets/x` beside its boards is the deck's assets/x (`deck/layout.ts`).
		const named = new Set<string>();
		for (const [path, deckPath] of [...out]) {
			if (!path.startsWith("boards/") || !/\.(?:x?html?|mdx?|css)$/i.test(path)) continue;
			for (const target of this.linksOf(deckPath)) {
				named.add(target);
				if (out.has(target)) continue;
				try {
					if (statSync(join(this.o.deck, target)).isFile()) out.set(target, target);
				} catch {
					/* named but not there */
				}
			}
		}
		this.links.set(name, named);
		return out;
	}

	private async syncCanvasFiles(name: string, c: SyncCanvas, fresh: boolean) {
		const s = this.state.canvases[name];
		if (!s) return;
		const writable = c.role !== "view";
		const remote = new Map<string, SyncFile>(((await this.call("GET", `/sync/v1/canvases/${s.id}/files`)).files as SyncFile[]).map((f) => [f.path, f]));
		const local = this.bundle(name);
		const known = s.files;
		/*
		 * Deleted on one side, from a file both last agreed on: gone from the folder, it is deleted in
		 * Studio (unless Studio's copy is newer, which then comes back); gone from Studio and unchanged
		 * here, it is deleted here. Without this a deleted board came straight back.
		 */
		for (const [path, was] of Object.entries(known)) {
			if (path.startsWith(`${PICTURES}/`)) continue;
			const there = remote.get(path);
			if (!local.has(path)) {
				if (there && there.version !== was.version) continue;
				if (there && writable) {
					const gone = await this.call("DELETE", `/sync/v1/canvases/${s.id}/files?path=${encodeURIComponent(path)}&base=${was.version}`).catch(() => undefined);
					if (!gone) continue;
					remote.delete(path);
					this.log(`deleted ${path} of ${name} in Studio`);
				}
				if (!there || writable) delete known[path];
				continue;
			}
			if (!there) {
				const full = join(this.o.deck, local.get(path)!);
				if (this.hashes.hash(full, fresh)?.hash !== was.hash) continue;
				// A deck file the canvas no longer points at stays in the deck; the canvas's own goes.
				if (local.get(path) !== path) {
					rmSync(full, { force: true });
					this.hashes.forget(full);
				}
				local.delete(path);
				delete known[path];
				this.log(`deleted ${path} of ${name}, as in Studio`);
			}
		}
		for (const [path, deckPath] of local) {
			const full = join(this.o.deck, deckPath);
			const got = this.hashes.hash(full, fresh);
			if (!got) continue;
			const hash = got.hash;
			const was = known[path];
			const there = remote.get(path);
			if (was?.hash === hash && (!there || there.version === was.version)) continue;
			if (there && there.hash === hash) {
				known[path] = { version: there.version, hash };
				continue;
			}
			// Unchanged here and newer there, or a canvas only shared with you to view: Studio's copy comes down.
			if (there && (was?.hash === hash || !writable)) {
				await this.download(name, path, there);
				continue;
			}
			if (!writable) continue;
			if (got.size > MAX_BYTES) {
				this.skipped.add(`${name}:${path}`);
				continue;
			}
			const bytes = got.bytes ?? readFileSync(full);
			const base = was?.version ?? there?.version;
			const put = await this.call("PUT", `/sync/v1/canvases/${s.id}/files?path=${encodeURIComponent(path)}${base !== undefined ? `&base=${base}` : ""}`, undefined, bytes);
			if (put.current) known[path] = { version: put.version, hash };
			else {
				this.conflicts.push(`${name}:${path}`);
				this.log(`${path} of ${name} changed in Studio too: Studio's stays current, yours is kept there as version ${put.version}`);
				await this.download(name, path, remote.get(path)!);
			}
		}
		for (const [path, f] of remote) {
			if (path.startsWith(`${PICTURES}/`) || local.has(path)) continue;
			if (f.size > MAX_BYTES) {
				this.skipped.add(`${name}:${path}`);
				continue;
			}
			await this.download(name, path, f);
		}
		if (writable) await this.syncPictures(name, s.id, remote);
	}

	private async download(name: string, path: string, f: SyncFile) {
		const target = this.deckPathOf(name, path);
		const landing = safeSyncPath(path) ? landingFor(this.o.deck, target) : { refused: "not a path of a canvas's bundle" };
		if ("refused" in landing || secretLooking(path)) {
			if (!this.skipped.has(`${name}:${path}`)) this.log(`did not download ${JSON.stringify(path)} of ${name}: ${"refused" in landing ? landing.refused : "it looks like a secret"}`);
			this.skipped.add(`${name}:${path}`);
			return;
		}
		const bytes = await this.call("GET", `/sync/v1/blobs/${encodeURIComponent(f.hash)}`);
		mkdirSync(dirname(landing.full), { recursive: true });
		writeFileSync(landing.full, bytes);
		this.hashes.wrote(landing.full, hashOf(bytes));
		const s = this.state.canvases[name];
		if (s) s.files[path] = { version: f.version, hash: f.hash };
		this.log(`downloaded ${path} of ${name}`);
	}

	/**
	 * A picture of each canvas whose drawing changed, taken by this harness's own `canvas.screenshot`
	 * (native, a few milliseconds), for its card in Studio. At most one a minute per canvas; a canvas
	 * Studio has no picture of yet is taken first.
	 */
	private async syncCanvasPictures() {
		const started = performance.now();
		try {
			await this.takeCanvasPictures();
		} finally {
			cost.pictureMs += performance.now() - started;
		}
	}

	private async takeCanvasPictures() {
		if (!this.o.harness) return;
		for (const name of [...this.pictureDue]) {
			const s = this.state.canvases[name];
			if (!s || Date.now() - (this.pictureAt.get(name) ?? 0) < 60_000) continue;
			this.pictureDue.delete(name);
			this.pictureAt.set(name, Date.now());
			try {
				const res = await fetch(new URL("/api/v1/canvas.screenshot", this.o.harness), {
					method: "POST",
					headers: { "Content-Type": "application/json", ...(this.o.harnessToken ? { Authorization: `Bearer ${this.o.harnessToken()}` } : {}) },
					body: JSON.stringify({ args: [{ canvas: name, format: "jpeg", scheme: "light" }] }),
				});
				const shot = (await res.json()) as { ok?: boolean; value?: { file?: string } };
				if (!shot.ok || !shot.value?.file) continue;
				const file = shot.value.file.startsWith("/") ? shot.value.file : join(this.o.deck, shot.value.file);
				await this.call("PUT", `/sync/v1/canvases/${s.id}/files?path=${encodeURIComponent(`${PICTURES}/canvas.light.jpg`)}`, undefined, readFileSync(file));
			} catch (error) {
				this.log(`no picture of canvas ${name}: ${(error as Error).message}`);
			}
		}
	}

	/** Each board's newest whole picture, so Studio can show it when no harness can serve the page. */
	private async syncPictures(name: string, id: string, remote?: Map<string, SyncFile>) {
		const there = remote ?? new Map<string, SyncFile>(((await this.call("GET", `/sync/v1/canvases/${id}/files`)).files as SyncFile[]).map((f) => [f.path, f]));
		if (!there.has(`${PICTURES}/canvas.light.jpg`)) this.pictureDue.add(name);
		const dir = join(this.o.deck, ".decks", "thumbs");
		if (!existsSync(dir)) return;
		const thumbs = readdirSync(dir);
		const folder = canvasFolder(name);
		for (const path of this.bundle(name).keys()) {
			if (!path.startsWith("boards/") || !path.endsWith(".html")) continue;
			const prefix = createHash("sha1").update(`${folder}/${path}`).digest("hex").slice(0, 16);
			this.thumbOwner.set(prefix, name);
			for (const scheme of ["light", "dark"]) {
				const re = new RegExp(`^${prefix}-\\d+-${scheme}-\\d+-whole-l\\d+\\.webp$`);
				const newest = thumbs.filter((t) => re.test(t)).map((t) => ({ t, at: statSync(join(dir, t)).mtimeMs })).sort((a, b) => b.at - a.at)[0];
				if (!newest) continue;
				const target = `${PICTURES}/${path}.${scheme}.webp`;
				const full = join(dir, newest.t);
				const got = this.hashes.hash(full);
				if (!got || there.get(target)?.hash === got.hash) continue;
				await this.call("PUT", `/sync/v1/canvases/${id}/files?path=${encodeURIComponent(target)}`, undefined, got.bytes ?? readFileSync(full));
			}
		}
	}

	// ---- apps ----

	/** The app list, to `PUT /sync/v1/inventory`, when it changed. A Studio too old to have the route (404) is left alone. */
	private async syncInventory() {
		if (!this.o.inventory) return;
		let apps;
		try {
			apps = this.o.inventory().map(({ name, title, kind, board }) => ({ name, title, kind, board }));
		} catch (error) {
			this.log(`no app list: ${(error as Error).message}`);
			return;
		}
		const body = JSON.stringify({ apps });
		const hash = hashOf(Buffer.from(body));
		if (this.inventorySent && this.state.inventory === hash) return;
		const res = await fetch(new URL("/sync/v1/inventory", this.o.studio), { method: "PUT", headers: { Authorization: `Bearer ${this.o.key}`, "Content-Type": "application/json" }, body });
		await res.arrayBuffer().catch(() => undefined);
		if (!res.ok && res.status !== 404) {
			this.log(`the app list was not taken: ${res.status}`);
			return;
		}
		this.inventorySent = true;
		this.state.inventory = hash;
	}

	// ---- staying in step ----

	/** What a live message asks for: one canvas, its files, or (the list changed) a full pass. */
	private heard(e: LiveEvent) {
		if (e.type === "hello") {
			// Connected again: what was said while away is not known, so everything is looked at.
			this.fullDue = true;
			return this.soon(50);
		}
		if ("by" in e && e.by && e.by === this.me) return;
		switch (e.type) {
			case "canvas": {
				if (!e.id) return;
				if (typeof e.rev === "number") this.latest.set(e.id, Math.max(this.latest.get(e.id) ?? 0, e.rev));
				if (Array.isArray(e.changes) && typeof e.base === "number" && typeof e.rev === "number") {
					const list = this.inbox.get(e.id) ?? [];
					list.push({ base: e.base, rev: e.rev, changes: e.changes as unknown as PenEdit[] });
					// A canvas nobody here looks at for a while keeps at most its last 500 messages; the rest come by `changes?since=`.
					this.inbox.set(e.id, list.slice(-500));
				}
				this.pull.add(e.id);
				return this.soon(50);
			}
			case "file": {
				const name = Object.entries(this.state.canvases).find(([, s]) => s.id === e.canvas)?.[0];
				if (!name) return;
				this.dirtyFiles.add(name);
				return this.soon(50);
			}
			case "canvases":
			case "canvas.gone":
				this.fullDue = true;
				return this.soon(50);
			default:
				return; // Cursors, harnesses and the account's older tree are nothing to sync.
		}
	}

	/** What a change in a watched folder asks for: the canvas it is in, or the canvases that use a deck file. */
	private changed(top: string, filename: string | null) {
		if (!filename) {
			this.fullDue = true;
			return this.soon(300);
		}
		const parts = filename.split(sep).join("/").split("/");
		let name: string | undefined;
		let rest: string[] = [];
		if (top === "canvases") {
			name = parts[0];
			rest = parts.slice(1);
		} else if (top === SHARED_CANVASES) {
			if (parts.length < 2) return;
			name = sharedName(parts[0]!, parts[1]!);
			rest = parts.slice(2);
		} else if (top === THUMBS) {
			const owner = this.thumbOwner.get(parts[0]!.slice(0, 16));
			if (owner) {
				this.dirtyPictures.add(owner);
				this.soon(1000);
			}
			return;
		} else {
			// A deck file: the canvases whose bundles hold it or whose boards point at it.
			const path = `${top}/${parts.join("/")}`;
			for (const [n, s] of Object.entries(this.state.canvases)) if (s.files[path] || this.links.get(n)?.has(path)) this.dirtyFiles.add(n);
			return this.soon(300);
		}
		if (!name) return;
		if (!this.state.canvases[name]) {
			// A canvas made here, or a folder not synced yet: a full pass takes it up.
			if (rest[0] === "canvas.pen") this.fullDue = true;
			else return;
		} else if (rest.length === 0) this.fullDue = true;
		else if (rest.length === 1 && rest[0] === "canvas.pen") this.dirtyPens.add(name);
		else if (rest.length === 1) return; // canvas.json and the like: nothing Studio keeps.
		else this.dirtyFiles.add(name);
		this.soon(300);
	}

	/** Sync now, then on every change on either side, and every 5 minutes besides. */
	async start(): Promise<void> {
		await this.sync();
		const live = new URL("/sync/v1/live", this.o.studio);
		live.protocol = live.protocol === "https:" ? "wss:" : "ws:";
		let first = true;
		const connect = () => {
			if (this.stopped) return;
			this.ws = new WebSocket(live, { headers: { Authorization: `Bearer ${this.o.key}` } });
			this.ws.on("message", (m) => {
				let e: LiveEvent;
				try {
					// A message this harness does not know (from a newer Studio) is nothing to sync.
					const got = LiveEvent.safeParse(JSON.parse(String(m)));
					if (!got.success) return;
					e = got.data;
				} catch {
					return;
				}
				// The first hello follows the first full pass at once: nothing can have been missed but a moment.
				if (e.type === "hello" && first) {
					first = false;
					return;
				}
				this.heard(e);
			});
			this.ws.on("close", () => setTimeout(connect, 2000));
			this.ws.on("error", () => {});
		};
		connect();
		this.started = true;
		this.watchFolders();
		this.timer = setInterval(() => this.sync(), FULL_PASS_MS);
	}

	/** Which of the deck's synced folders are watched: one that comes later (a friend's first share, the first canvas) is watched from then on. */
	private watched = new Set<string>();
	private started = false;
	private watchFolders() {
		if (!this.started || this.stopped) return;
		for (const top of ["canvases", SHARED_CANVASES, ...MIRRORED, THUMBS]) {
			const dir = join(this.o.deck, top);
			if (this.watched.has(top) || !existsSync(dir)) continue;
			this.watched.add(top);
			this.watchers.push(watch(dir, { recursive: top !== THUMBS }, (_event, filename) => this.changed(top, filename === null ? null : String(filename))));
		}
	}

	private pending?: NodeJS.Timeout;
	private soon(ms: number) {
		clearTimeout(this.pending);
		this.pending = setTimeout(() => {
			if (!this.stopped) void this.queue(() => this.targeted());
		}, ms);
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

/** Board pictures the harness keeps, watched so a new one goes up with its canvas. */
const THUMBS = ".decks/thumbs";

/**
 * Edits applied as far as they fit: an insert of an item already there, or an edit to one gone, is
 * left out. Applying a revision twice (the harness stopped between writing the file and its state)
 * so changes nothing.
 */
function loosely(doc: PenDocument, edits: readonly PenEdit[]): PenDocument {
	const ids = new Set<string>();
	const visit = (list: readonly { id: string; children?: unknown }[]) => {
		for (const n of list) {
			ids.add(n.id);
			if (Array.isArray(n.children)) visit(n.children as never);
		}
	};
	if (edits.some((e) => e.op === "insert")) visit(doc.children ?? []);
	const fits = edits.filter((e) => e.op !== "insert" || !ids.has(e.id));
	try {
		return applyEdits(doc, fits);
	} catch {
		let out = doc;
		for (const edit of fits) {
			try {
				out = applyEdits(out, [edit]);
			} catch {
				/* an item gone in Studio's drawing */
			}
		}
		return out;
	}
}
