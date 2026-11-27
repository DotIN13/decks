import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { canvasFolder, servedAs } from "@decks/hub/layout";
import { MIRRORED_PARTS, OWN_PARTS, PICTURES, safeSyncPath, secretLooking, type SyncCanvas, type SyncFile } from "@decks/sync-protocol";
import { sha256 as hashOf } from "./hash-cache.ts";
import type { SyncScheduler } from "./scheduler.ts";
import { isShared, readFileSync, writeFileSync, type CanvasState, type SyncOptions, type SyncStore } from "./state.ts";
import type { StudioTransport } from "./transport.ts";

const MIRRORED: readonly string[] = MIRRORED_PARTS;
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

/** `cards/plan.html` kept beside a conflict as `cards/plan.conflict-20261103-0012.html`; a second one the same minute gets the seconds too. */
export function conflictName(path: string, now = new Date()): string {
	const at = path.lastIndexOf("/");
	const file = path.slice(at + 1);
	const dot = file.lastIndexOf(".");
	const stem = dot > 0 ? file.slice(0, dot) : file;
	const ext = dot > 0 ? file.slice(dot) : "";
	const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
	return `${path.slice(0, at + 1)}${stem}.conflict-${stamp}${ext}`;
}

/** A link in a card's text: in quotes, `url(…)` or a markdown link, with a file extension. */
const LINK = /(["'(])((?:\.{1,2}\/)*[A-Za-z0-9_ -￿][^"'()\s<>?#|*:]*\.[A-Za-z0-9]{1,8})(?=[?#"')])/g;

/**
 * A canvas's files, the part of its bundle that is not its drawing: its own `cards/`, `cards/`,
 * `frames/` and `files/`, the deck's `assets/` and `docs/` files its cards point at, and pictures.
 * Each goes whole, by hash, with the version both sides last agreed on: sent, taken, deleted on the
 * side it was not deleted on, or kept beside Studio's as a conflict when both changed.
 */
export class FileSync {
	/** The deck files each canvas's cards point at, by canvas name, and each card's links by its deck path with its size and time. */
	private links = new Map<string, Set<string>>();
	private cardLinks = new Map<string, { size: number; mtimeMs: number; targets: string[] }>();
	/** Each canvas's bundle as the plan read it, so the pass that follows does not walk it again. */
	private planned = new Map<string, Map<string, string>>();

	constructor(
		private readonly o: SyncOptions,
		private readonly log: (line: string) => void,
		private readonly store: SyncStore,
		private readonly transport: StudioTransport,
		private readonly scheduler: SyncScheduler,
		/** The files left out, and the conflicts kept beside their file, by `<canvas>:<path>` (`HarnessSync.skipped`, `.conflicts`). */
		private readonly skipped: Set<string>,
		private readonly conflicts: string[],
	) {}

	/**
	 * What the files of these canvases will cost this pass: every file of a canvas you may write whose
	 * size or time differs from what was last agreed (by the hash cache, without reading it), or that
	 * Studio has not agreed on at all. Read once here, and the pass takes the same bundle.
	 */
	plan(canvases: [string, SyncCanvas][]) {
		for (const [name, c] of canvases) {
			const s = this.store.state.canvases[name];
			if (!s || c.role === "view") continue;
			const local = this.bundle(name);
			this.planned.set(name, local);
			for (const [path, deckPath] of local) {
				const seen = this.store.hashes.peek(join(this.o.deck, deckPath));
				if (!seen || seen.size > MAX_BYTES) continue;
				if (seen.hash && s.files[path]?.hash === seen.hash) continue;
				this.scheduler.owe(`${name}:${path}`, seen.size);
			}
		}
	}

	/** A pass starts: no canvas's bundle is read yet. */
	forgetPlan() {
		this.planned.clear();
	}

	/** A canvas no longer synced: the deck files its cards pointed at no longer matter to it. */
	forget(name: string) {
		this.links.delete(name);
	}

	/** Whether a canvas's cards point at this deck file (`assets/…`, `docs/…`). */
	pointsAt(name: string, path: string): boolean {
		return this.links.get(name)?.has(path) === true;
	}

	/**
	 * Where a file of a canvas's bundle is here, deck-relative: in the canvas's folder, but the deck
	 * files a canvas of this deck points at, which are this deck's own `assets/` and `docs/`.
	 */
	private deckPathOf(name: string, path: string): string {
		const top = path.split("/")[0]!;
		if (!isShared(name) && MIRRORED.includes(top)) return path;
		return `${canvasFolder(name)}/${path}`;
	}

	/** What a card's text points at, read again only when the card's size or time changed. */
	private linksOf(deckPath: string): string[] {
		const full = join(this.o.deck, deckPath);
		let st;
		try {
			st = statSync(full);
		} catch {
			return [];
		}
		const kept = this.cardLinks.get(deckPath);
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
		this.cardLinks.set(deckPath, one);
		return one.targets;
	}

	/** A canvas's bundle as it is here: its path in the canvas's folder → the file's deck path. */
	bundle(name: string): Map<string, string> {
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
		for (const part of [...OWN_PARTS, ...(isShared(name) ? MIRRORED : [])]) walk(`${folder}/${part}`);
		if (isShared(name)) return out;
		// The deck files this canvas's cards point at: `../assets/x` beside its cards is the deck's assets/x (`deck/layout.ts`).
		const named = new Set<string>();
		for (const [path, deckPath] of [...out]) {
			// A card, or anything in a card's folder that can name a file (`cards/<name>/`, its HTML, styles and scripts).
			if (!(path.startsWith("boards/") || path.startsWith("cards/")) || !/\.(?:x?html?|mdx?|css|m?js)$/i.test(path)) continue;
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
		/*
		 * A canvas with cards takes the deck's own libraries with it (`assets/importmap.json`, `@decks/canvas`
		 * card.ts) and the files the map names beside it: no card names them in its text, it imports them by name.
		 */
		if ([...out.keys()].some((path) => path.startsWith("cards/"))) {
			const map = "assets/importmap.json";
			try {
				const imports = (JSON.parse(readFileSync(join(this.o.deck, map), "utf8")) as { imports?: Record<string, unknown> }).imports ?? {};
				named.add(map);
				out.set(map, map);
				for (const address of Object.values(imports)) {
					if (typeof address !== "string" || /^[a-z][a-z0-9+.-]*:|^\//i.test(address)) continue;
					const target = posix.normalize(posix.join("assets", address));
					if (!target.startsWith("assets/") || secretLooking(target)) continue;
					named.add(target);
					try {
						if (statSync(join(this.o.deck, target)).isFile()) out.set(target, target);
					} catch {
						/* named but not there */
					}
				}
			} catch {
				/* no map, or not one */
			}
		}
		this.links.set(name, named);
		return out;
	}

	async syncCanvasFiles(name: string, c: SyncCanvas, fresh: boolean): Promise<Map<string, SyncFile> | undefined> {
		const s = this.store.state.canvases[name];
		if (!s) return undefined;
		const writable = c.role !== "view";
		const remote = new Map<string, SyncFile>(((await this.transport.call("GET", `/sync/v1/canvases/${s.id}/files`)).files as SyncFile[]).map((f) => [f.path, f]));
		const local = this.planned.get(name) ?? this.bundle(name);
		this.planned.delete(name);
		const known = s.files;
		// What comes down is known only now, from Studio's list: it joins the work due.
		for (const [path, f] of remote) {
			if (path.startsWith(`${PICTURES}/`) || local.has(path) || f.size > MAX_BYTES || known[path]?.hash === f.hash) continue;
			this.scheduler.owe(`${name}:${path}`, f.size);
		}
		/*
		 * Deleted on one side, from a file both last agreed on: gone from the folder, it is deleted in
		 * Studio (unless Studio's copy is newer, which then comes back); gone from Studio and unchanged
		 * here, it is deleted here. Without this a deleted card came straight back.
		 */
		for (const [path, was] of Object.entries(known)) {
			if (path.startsWith(`${PICTURES}/`)) continue;
			const there = remote.get(path);
			if (!local.has(path)) {
				if (there && there.version !== was.version) continue;
				if (there && writable) {
					const gone = await this.transport.call("DELETE", `/sync/v1/canvases/${s.id}/files?path=${encodeURIComponent(path)}&base=${was.version}`).catch(() => undefined);
					if (!gone) continue;
					remote.delete(path);
					this.log(`deleted ${path} of ${name} in Studio`);
				}
				if (!there || writable) delete known[path];
				continue;
			}
			if (!there) {
				const full = join(this.o.deck, local.get(path)!);
				if (this.store.hashes.hash(full, fresh)?.hash !== was.hash) continue;
				// A deck file the canvas no longer points at stays in the deck; the canvas's own goes.
				if (local.get(path) !== path) {
					rmSync(full, { force: true });
					this.store.hashes.forget(full);
				}
				local.delete(path);
				delete known[path];
				this.log(`deleted ${path} of ${name}, as in Studio`);
			}
		}
		for (const [path, deckPath] of local) {
			// A file Studio's wait kept back is still due: the pass after the wait sends it, and counts it then.
			let dealt = true;
			try {
				dealt = await this.syncLocalFile(name, s, path, deckPath, remote, known, writable, fresh);
			} finally {
				if (dealt) this.scheduler.paid(`${name}:${path}`);
			}
		}
		for (const [path, f] of remote) {
			if (path.startsWith(`${PICTURES}/`) || local.has(path)) continue;
			if (f.size > MAX_BYTES) {
				this.skipped.add(`${name}:${path}`);
				continue;
			}
			try {
				await this.download(name, path, f);
			} finally {
				this.scheduler.paid(`${name}:${path}`);
			}
		}
		this.scheduler.tellSkipped();
		return remote;
	}

	/** One file of a canvas's folder against Studio's list: agreed, taken from Studio, sent, or a conflict; false when Studio's wait kept it back. */
	private async syncLocalFile(name: string, s: CanvasState, path: string, deckPath: string, remote: Map<string, SyncFile>, known: CanvasState["files"], writable: boolean, fresh: boolean): Promise<boolean> {
		const full = join(this.o.deck, deckPath);
		const got = this.store.hashes.hash(full, fresh);
		if (!got) return true;
		const hash = got.hash;
		const was = known[path];
		const there = remote.get(path);
		if (was?.hash === hash && (!there || there.version === was.version)) return true;
		if (there && there.hash === hash) {
			known[path] = { version: there.version, hash };
			return true;
		}
		// Unchanged here and newer there, or a canvas only shared with you to view: Studio's copy comes down.
		if (there && (was?.hash === hash || !writable)) {
			await this.download(name, path, there);
			return true;
		}
		if (!writable) return true;
		if (got.size > MAX_BYTES) {
			this.skipped.add(`${name}:${path}`);
			return true;
		}
		const bytes = got.bytes ?? readFileSync(full);
		/*
		 * Both have the file, differently, and no version was agreed on (a folder adopted, a state lost):
		 * a conflict before anything is sent, Studio's copy staying current. With a base, the put says
		 * whether Studio moved on since: current when not, a conflict when it did.
		 */
		const base = was?.version ?? (there ? 0 : undefined);
		const put = await this.transport.upload(name, s.id, path, bytes, hash, base);
		if (!put) return !this.scheduler.holding("files");
		if (put.current) known[path] = { version: put.version, hash };
		else await this.conflicted(name, s, path, full, bytes, hash, put.version, remote.get(path)!);
		return true;
	}

	/**
	 * A file changed here and in Studio since both last agreed, or never agreed on: Studio's stays
	 * current and comes down; this copy is kept there as a version, and here beside the file as
	 * `<name>.conflict-<when>.<ext>`, a file like any other that goes up on the next pass, so both
	 * copies are seen on every machine and a person chooses. Pictures just take Studio's.
	 */
	private async conflicted(name: string, s: CanvasState, path: string, full: string, bytes: Uint8Array, hash: string, version: number, theirs: SyncFile) {
		if (!path.startsWith(`${PICTURES}/`)) {
			const copy = conflictName(path);
			const landing = landingFor(this.o.deck, this.deckPathOf(name, copy));
			if (!("refused" in landing) && !existsSync(landing.full)) {
				mkdirSync(dirname(landing.full), { recursive: true });
				writeFileSync(landing.full, bytes);
				this.store.hashes.wrote(landing.full, hash);
				this.scheduler.dirtyFiles.add(name);
				this.scheduler.soon(300);
			}
			this.conflicts.push(`${name}:${path}`);
			this.log(`${path} of ${name} changed in Studio too: Studio's stays current, yours is kept there as version ${version} and here as ${copy}`);
		}
		await this.download(name, path, theirs);
		void s;
	}

	private async download(name: string, path: string, f: SyncFile) {
		const target = this.deckPathOf(name, path);
		const landing = safeSyncPath(path) ? landingFor(this.o.deck, target) : { refused: "not a path of a canvas's bundle" };
		if ("refused" in landing || secretLooking(path)) {
			if (!this.skipped.has(`${name}:${path}`)) this.log(`did not download ${JSON.stringify(path)} of ${name}: ${"refused" in landing ? landing.refused : "it looks like a secret"}`);
			this.skipped.add(`${name}:${path}`);
			return;
		}
		this.scheduler.say({ now: { canvas: name, path, up: false } });
		const bytes = await this.transport.call("GET", `/sync/v1/blobs/${encodeURIComponent(f.hash)}`);
		this.scheduler.say({ received: this.scheduler.told.received + bytes.length });
		mkdirSync(dirname(landing.full), { recursive: true });
		writeFileSync(landing.full, bytes);
		this.store.hashes.wrote(landing.full, hashOf(bytes));
		const s = this.store.state.canvases[name];
		if (s) s.files[path] = { version: f.version, hash: f.hash };
		this.log(`downloaded ${path} of ${name}`);
	}
}
