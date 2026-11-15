import { Refused, type Caller } from "../../protocol/index.ts";
import { Mounts } from "./fence.ts";
import { toDeckPath, type Bytes, type Deck, type DeckPath, type Entry, type FileChange, type Revision, type Stop } from "./types.ts";

// A Deck kept in memory, for tests. Files only: a folder exists while a file
// is under it. Every write and delete gets the next revision of the deck. A
// mounted folder is a second space of files, kept by the folder's name, so
// it outlives an unmount and shows again wherever it is mounted.

type Kept = { bytes: Bytes; rev: number; by: string; at: number };

export class MemoryDeck implements Deck {
	private files = new Map<string, Kept>();
	private watchers = new Set<(change: FileChange) => void>();
	private rev = 0;
	private clock: () => number;
	private mounts = new Mounts();

	constructor(files: Record<string, string | Bytes> = {}, clock: () => number = Date.now) {
		this.clock = clock;
		const seed = { kind: "person", id: "seed", name: "seed" } as const;
		for (const [path, body] of Object.entries(files)) this.put(toDeckPath(path), typeof body === "string" ? new TextEncoder().encode(body) : body, seed);
	}

	mount(prefix: DeckPath, folder: string): void {
		this.mounts.add({ prefix, folder });
	}

	unmount(prefix: DeckPath): void {
		this.mounts.remove(prefix);
	}

	async read(path: DeckPath): Promise<Bytes> {
		const kept = this.files.get(this.key(path));
		if (!kept) throw new Refused("not_found", `There is no file at ${path}.`, "file.list");
		return kept.bytes.slice();
	}

	async write(path: DeckPath, bytes: Bytes, by: Caller): Promise<Revision> {
		if (this.isDir(path)) throw new Refused("conflict", `${path} is a folder.`, "file.list");
		return this.put(path, bytes.slice(), by);
	}

	async list(dir: DeckPath | ""): Promise<Entry[]> {
		const prefix = dir ? `${dir}/` : "";
		const seen = new Map<string, Entry>();
		for (const [path, kept] of this.visible()) {
			if (!path.startsWith(prefix)) continue;
			const [head, ...rest] = path.slice(prefix.length).split("/");
			const full = toDeckPath(prefix + head);
			if (rest.length === 0) seen.set(full, { path: full, kind: "file", size: kept.bytes.length, rev: kept.rev, at: kept.at });
			else if (!seen.has(full)) seen.set(full, { path: full, kind: "dir", size: 0, at: kept.at });
		}
		const dirs = dir === "apps" ? this.mounts.list().map((one) => one.prefix) : dir === "" && this.mounts.list().length ? [toDeckPath("apps")] : [];
		for (const one of dirs) if (!seen.has(one)) seen.set(one, { path: one, kind: "dir", size: 0, at: 0 });
		if (dir && seen.size === 0 && !this.mounts.isMount(dir)) throw new Refused("not_found", `There is no folder at ${dir}.`, "file.list");
		return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
	}

	watch(on: (change: FileChange) => void): Stop {
		this.watchers.add(on);
		return () => this.watchers.delete(on);
	}

	async remove(path: DeckPath, by: Caller): Promise<Revision> {
		if (this.mounts.isMount(path)) throw new Refused("refused", `${path} is an app whose source is outside the deck; it is not deleted through the deck.`, "app.delete");
		const gone = this.under(path);
		if (gone.length === 0) throw new Refused("not_found", `There is nothing at ${path}.`, "file.list");
		const rev = ++this.rev;
		const at = this.clock();
		for (const one of gone) {
			this.files.delete(this.key(one));
			this.tell({ path: one, kind: "deleted", rev, by: by.id, at });
		}
		return { path, rev, by: by.id, at };
	}

	async move(from: DeckPath, to: DeckPath, by: Caller): Promise<Revision> {
		if (this.mounts.isMount(from) || this.mounts.isMount(to)) throw new Refused("refused", "An app mounted from outside the deck is not moved through the deck.", "app.get");
		const moving = this.under(from);
		if (moving.length === 0) throw new Refused("not_found", `There is nothing at ${from}.`, "file.list");
		if (this.under(to).length > 0) throw new Refused("conflict", `${to} already exists.`, "file.delete");
		const copies = moving.map((path) => [toDeckPath(to + path.slice(from.length)), this.files.get(this.key(path))!.bytes] as const);
		await this.remove(from, by);
		let last: Revision = { path: to, rev: this.rev, by: by.id, at: this.clock() };
		for (const [path, bytes] of copies) last = this.put(path, bytes, by);
		return { ...last, path: to };
	}

	/** Where a deck path is kept: itself, or its folder's space when mounted. */
	private key(path: string): string {
		const found = this.mounts.find(path);
		return found ? `${found.mount.folder}\0${found.rest}` : path;
	}

	/** Every file as the deck shows it now, by deck path. */
	private visible(): [DeckPath, Kept][] {
		const out: [DeckPath, Kept][] = [];
		for (const [key, kept] of this.files) {
			const at = key.indexOf("\0");
			if (at < 0) {
				if (!this.mounts.find(key)) out.push([key as DeckPath, kept]);
				continue;
			}
			const [folder, rest] = [key.slice(0, at), key.slice(at + 1)];
			for (const one of this.mounts.list()) if (one.folder === folder) out.push([toDeckPath(`${one.prefix}/${rest}`), kept]);
		}
		return out;
	}

	private put(path: DeckPath, bytes: Bytes, by: Caller): Revision {
		const kept = { bytes, rev: ++this.rev, by: by.id, at: this.clock() };
		this.files.set(this.key(path), kept);
		this.tell({ path, kind: "written", rev: kept.rev, by: kept.by, at: kept.at });
		return { path, rev: kept.rev, by: kept.by, at: kept.at };
	}

	private under(path: DeckPath): DeckPath[] {
		return this.visible().map(([one]) => one).filter((one) => one === path || one.startsWith(`${path}/`));
	}

	private isDir(path: DeckPath): boolean {
		return this.visible().some(([one]) => one.startsWith(`${path}/`));
	}

	private tell(change: FileChange): void {
		for (const on of this.watchers) on(change);
	}
}
