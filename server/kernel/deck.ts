import { createHash } from "node:crypto";
import { watch as fsWatch, type FSWatcher } from "node:fs";
import { lstat, mkdir, readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { layout, Refused, type Caller } from "../../protocol/index.ts";
import { toDeckPath, type Bytes, type Deck, type DeckPath, type Entry, type FileChange, type Revision, type Stop } from "./types.ts";

// The deck on a folder. A path is joined to the root; a symlink out of the
// deck is refused. Removes go to .decks/trash/. A change on the disk by
// anything else is told as by "disk"; the server's own writes are known by
// their bytes, not by time. Hidden files never show.

type Where = { full: string; base: string; basePath: string };
const hashOf = (bytes: Bytes | Buffer) => createHash("sha256").update(bytes).digest("hex");
const GONE = "gone";

export class FolderDeck implements Deck {
	private rev = 0;
	private watchers = new Set<(change: FileChange) => void>();
	private fsWatchers = new Map<string, FSWatcher>();
	private own = new Map<string, string>();
	private pending = new Map<string, NodeJS.Timeout>();

	constructor(
		readonly root: string,
		private clock: () => number = Date.now,
	) {
		this.root = resolve(root);
	}

	startAt(rev: number): void {
		this.rev = Math.max(this.rev, rev);
	}

	// The Deck: read, write, list, remove, move, watch.
	async read(path: DeckPath): Promise<Bytes> {
		const { full } = await this.real(path);
		try {
			return new Uint8Array(await readFile(full));
		} catch (error) {
			throw this.refusal(error, path);
		}
	}

	async write(path: DeckPath, bytes: Bytes, by: Caller): Promise<Revision> {
		const { full } = await this.real(path);
		if ((await this.kind(full)) === "dir") throw new Refused("conflict", `${path} is a folder.`, "file.list");
		await mkdir(dirname(full), { recursive: true });
		this.own.set(path, hashOf(bytes));
		await writeFile(full, bytes);
		return this.tellAll([[path, "written"]], path, by.id);
	}

	async list(dir: DeckPath | ""): Promise<Entry[]> {
		const { full } = dir ? await this.real(dir) : { full: this.root };
		let names: string[];
		try {
			names = await readdir(full);
		} catch (error) {
			throw this.refusal(error, dir || "the deck", "folder");
		}
		const entries: Entry[] = [];
		for (const name of names.filter((one) => !one.startsWith("."))) {
			const path = toDeckPath(dir ? `${dir}/${name}` : name);
			const info = await stat(join(full, name)).catch(() => undefined);
			if (info) entries.push({ path, kind: info.isDirectory() ? "dir" : "file", size: info.isDirectory() ? 0 : info.size, at: info.mtimeMs });
		}
		return entries.sort((a, b) => a.path.localeCompare(b.path));
	}

	async remove(path: DeckPath, by: Caller): Promise<Revision> {
		const where = await this.real(path);
		const files = await this.filesUnder(path, where);
		if (!files) throw new Refused("not_found", `There is nothing at ${path}.`, "file.list");
		const trash = join(this.root, ".decks", "trash", `${this.clock()}-${this.rev + 1}`, path);
		await mkdir(dirname(trash), { recursive: true });
		for (const one of files) this.own.set(one, GONE);
		await rename(where.full, trash);
		return this.tellAll(files.map((one) => [one, "deleted"]), path, by.id);
	}

	async move(from: DeckPath, to: DeckPath, by: Caller): Promise<Revision> {
		const [source, target] = [await this.real(from), await this.real(to)];
		const files = await this.filesUnder(from, source);
		if (!files) throw new Refused("not_found", `There is nothing at ${from}.`, "file.list");
		if (await this.kind(target.full)) throw new Refused("conflict", `${to} already exists.`, "file.delete");
		const moved = files.map((one) => toDeckPath(to + one.slice(from.length)));
		for (const one of files) this.own.set(one, GONE);
		await mkdir(dirname(target.full), { recursive: true });
		await rename(source.full, target.full);
		for (const one of moved) this.own.set(one, hashOf(await readFile(this.where(one).full)));
		const changes = [...files.map((one) => [one, "deleted"] as const), ...moved.map((one) => [one, "written"] as const)];
		return this.tellAll(changes, to, by.id);
	}

	watch(on: (change: FileChange) => void): Stop {
		this.watchers.add(on);
		if (!this.fsWatchers.size) this.watchFolder(this.root, "");
		return () => {
			this.watchers.delete(on);
			if (this.watchers.size === 0) this.close();
		};
	}

	close(): void {
		for (const one of this.fsWatchers.values()) one.close();
		this.fsWatchers.clear();
		for (const timer of this.pending.values()) clearTimeout(timer);
		this.pending.clear();
	}

	// Where a path is on the disk.
	private where(path: string): Where {
		return { full: join(this.root, path), base: this.root, basePath: "" };
	}

	/** Where a path is, refused if a symlink on the way leads out of its base. */
	private async real(path: DeckPath): Promise<Where> {
		const where = this.where(path);
		const inner = relative(where.base, where.full);
		let at = where.base;
		for (const part of inner ? inner.split(sep) : []) {
			at = join(at, part);
			const info = await lstat(at).catch(() => undefined);
			if (!info) break;
			if (info.isSymbolicLink()) await this.checkLink(at, where.base, path);
		}
		return where;
	}

	private async checkLink(at: string, base: string, path: DeckPath): Promise<void> {
		const target = await realpath(at).catch(() => at);
		const inside = relative(await realpath(base).catch(() => base), target);
		if (inside.startsWith("..") || inside.startsWith(sep) || layout.hiddenPart(inside)) throw new Refused("invalid", `${path} leads out of the deck.`, "file.list");
	}

	private async kind(full: string): Promise<"file" | "dir" | undefined> {
		const info = await stat(full).catch(() => undefined);
		return info ? (info.isDirectory() ? "dir" : "file") : undefined;
	}

	private async filesUnder(path: DeckPath, where: Where): Promise<DeckPath[] | undefined> {
		const kind = await this.kind(where.full);
		if (kind === "file") return [path];
		if (!kind) return undefined;
		const out: DeckPath[] = [];
		for (const entry of await readdir(where.full, { recursive: true, withFileTypes: true })) {
			if (!entry.isFile()) continue;
			const rel = relative(where.base, join(entry.parentPath, entry.name)).split(sep).join("/");
			if (!layout.hiddenPart(rel)) out.push(toDeckPath(where.basePath ? `${where.basePath}/${rel}` : rel));
		}
		return out;
	}

	private refusal(error: unknown, path: string, what = "file"): Refused {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") return new Refused("not_found", `There is no ${what} at ${path}.`, "file.list");
		return new Refused("unavailable", `${path} could not be read: ${(error as Error).message}`);
	}

	// Telling watchers, and hearing changes made on the disk.
	private tellAll(changes: readonly (readonly [DeckPath, FileChange["kind"]])[], path: DeckPath, by: string): Revision {
		const rev = ++this.rev;
		const at = this.clock();
		for (const [one, kind] of changes) for (const on of this.watchers) on({ path: one, kind, rev, by, at });
		return { path, rev, by, at };
	}

	private watchFolder(folder: string, prefix: string): void {
		if (this.fsWatchers.has(folder)) return;
		try {
			this.fsWatchers.set(folder, fsWatch(folder, { recursive: true }, (_kind, name) => name && this.heard(String(name), prefix, basename(folder))));
		} catch {
			// A deck folder that cannot be watched tells no disk changes.
		}
	}

	/** A change on the disk, settled for 60 ms, then told unless it is the server's own. */
	private heard(name: string, prefix: string, own: string): void {
		const rel = name.split(sep).join("/");
		if (layout.hiddenPart(rel)) return;
		const path = prefix ? `${prefix}/${rel}` : rel;
		clearTimeout(this.pending.get(path));
		this.pending.set(path, setTimeout(() => void this.settle(path, rel === own), 60));
	}

	/** selfName: macOS names a watched folder itself when it was just made; gone, it is let pass. */
	private async settle(path: string, selfName: boolean): Promise<void> {
		this.pending.delete(path);
		const full = this.where(path).full;
		const kind = await this.kind(full);
		if (kind === "dir" || (!kind && selfName)) return;
		const now = kind ? hashOf(await readFile(full).catch(() => Buffer.alloc(0))) : GONE;
		if (this.own.get(path) === now) return void this.own.delete(path);
		this.own.delete(path);
		this.tellAll([[toDeckPath(path), kind ? "written" : "deleted"]], toDeckPath(path), "disk");
	}
}
