import { Refused, type Caller } from "../../protocol/index.ts";
import { toDeckPath, type Bytes, type Deck, type DeckPath, type Entry, type FileChange, type Revision, type Stop } from "./types.ts";

// A Deck kept in memory, for tests. Files only: a folder exists while a file
// is under it. Every write and delete gets the next revision of the deck.

type Kept = { bytes: Bytes; rev: number; by: string; at: number };

export class MemoryDeck implements Deck {
	private files = new Map<DeckPath, Kept>();
	private watchers = new Set<(change: FileChange) => void>();
	private rev = 0;
	private clock: () => number;

	constructor(files: Record<string, string | Bytes> = {}, clock: () => number = Date.now) {
		this.clock = clock;
		const seed = { kind: "person", id: "seed", name: "seed" } as const;
		for (const [path, body] of Object.entries(files)) this.put(toDeckPath(path), typeof body === "string" ? new TextEncoder().encode(body) : body, seed);
	}

	async read(path: DeckPath): Promise<Bytes> {
		const kept = this.files.get(path);
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
		for (const [path, kept] of this.files) {
			if (!path.startsWith(prefix)) continue;
			const [head, ...rest] = path.slice(prefix.length).split("/");
			const full = toDeckPath(prefix + head);
			if (rest.length === 0) seen.set(full, { path: full, kind: "file", size: kept.bytes.length, rev: kept.rev, at: kept.at });
			else if (!seen.has(full)) seen.set(full, { path: full, kind: "dir", size: 0, at: kept.at });
		}
		if (dir && seen.size === 0 && !this.files.has(dir as DeckPath)) throw new Refused("not_found", `There is no folder at ${dir}.`, "file.list");
		return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
	}

	watch(on: (change: FileChange) => void): Stop {
		this.watchers.add(on);
		return () => this.watchers.delete(on);
	}

	async remove(path: DeckPath, by: Caller): Promise<Revision> {
		const gone = this.under(path);
		if (gone.length === 0) throw new Refused("not_found", `There is nothing at ${path}.`, "file.list");
		const rev = ++this.rev;
		const at = this.clock();
		for (const one of gone) {
			this.files.delete(one);
			this.tell({ path: one, kind: "deleted", rev, by: by.id, at });
		}
		return { path, rev, by: by.id, at };
	}

	async move(from: DeckPath, to: DeckPath, by: Caller): Promise<Revision> {
		const moving = this.under(from);
		if (moving.length === 0) throw new Refused("not_found", `There is nothing at ${from}.`, "file.list");
		if (this.under(to).length > 0) throw new Refused("conflict", `${to} already exists.`, "file.delete");
		const copies = moving.map((path) => [toDeckPath(to + path.slice(from.length)), this.files.get(path)!.bytes] as const);
		await this.remove(from, by);
		let last: Revision = { path: to, rev: this.rev, by: by.id, at: this.clock() };
		for (const [path, bytes] of copies) last = this.put(path, bytes, by);
		return { ...last, path: to };
	}

	private put(path: DeckPath, bytes: Bytes, by: Caller): Revision {
		const kept = { bytes, rev: ++this.rev, by: by.id, at: this.clock() };
		this.files.set(path, kept);
		this.tell({ path, kind: "written", rev: kept.rev, by: kept.by, at: kept.at });
		return { path, rev: kept.rev, by: kept.by, at: kept.at };
	}

	private under(path: DeckPath): DeckPath[] {
		return [...this.files.keys()].filter((one) => one === path || one.startsWith(`${path}/`));
	}

	private isDir(path: DeckPath): boolean {
		return [...this.files.keys()].some((one) => one.startsWith(`${path}/`));
	}

	private tell(change: FileChange): void {
		for (const on of this.watchers) on(change);
	}
}
