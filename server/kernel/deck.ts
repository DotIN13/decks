import { watch as fsWatch, type FSWatcher } from "node:fs";
import { lstat, mkdir, readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { layout, Refused, type Caller } from "../../protocol/index.ts";
import { toDeckPath, type Bytes, type Deck, type DeckPath, type Entry, type FileChange, type Revision, type Stop } from "./types.ts";

// The deck on a folder. Every path was checked once by toDeckPath; here it is
// only joined to the root, and a symlink that leads out is refused. A remove
// goes to .decks/trash/. A change made on the disk by anything else is heard
// and announced by "disk". Hidden files are never listed or announced;
// macOS names the root itself when it was just made, which is let pass.

const OWN_MS = 1500;

export class FolderDeck implements Deck {
	private rev = 0;
	private watchers = new Set<(change: FileChange) => void>();
	private watcher: FSWatcher | undefined;
	private own = new Map<string, number>();
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

	async read(path: DeckPath): Promise<Bytes> {
		const full = await this.real(path);
		try {
			return new Uint8Array(await readFile(full));
		} catch (error) {
			throw this.refusal(error, path);
		}
	}

	async write(path: DeckPath, bytes: Bytes, by: Caller): Promise<Revision> {
		const full = await this.real(path);
		if ((await this.kind(full)) === "dir") throw new Refused("conflict", `${path} is a folder.`, "file.list");
		await mkdir(dirname(full), { recursive: true });
		this.mark(path);
		await writeFile(full, bytes);
		return this.tell(path, "written", by.id);
	}

	async list(dir: DeckPath | ""): Promise<Entry[]> {
		const full = dir ? await this.real(dir) : this.root;
		let names: string[];
		try {
			names = await readdir(full);
		} catch (error) {
			throw this.refusal(error, dir || "the deck", "folder");
		}
		const entries: Entry[] = [];
		for (const name of names.filter((one) => !one.startsWith("."))) {
			const info = await stat(join(full, name)).catch(() => undefined);
			if (!info) continue;
			const path = toDeckPath(dir ? `${dir}/${name}` : name);
			entries.push({ path, kind: info.isDirectory() ? "dir" : "file", size: info.isDirectory() ? 0 : info.size, at: info.mtimeMs });
		}
		return entries.sort((a, b) => a.path.localeCompare(b.path));
	}

	watch(on: (change: FileChange) => void): Stop {
		this.watchers.add(on);
		if (!this.watcher) this.watcher = fsWatch(this.root, { recursive: true }, (_kind, name) => name && this.heard(String(name)));
		return () => {
			this.watchers.delete(on);
			if (this.watchers.size === 0) this.close();
		};
	}

	async remove(path: DeckPath, by: Caller): Promise<Revision> {
		const full = await this.real(path);
		const files = await this.filesUnder(path, full);
		if (!files) throw new Refused("not_found", `There is nothing at ${path}.`, "file.list");
		const trash = join(this.root, ".decks", "trash", `${this.clock()}-${this.rev + 1}`, path);
		await mkdir(dirname(trash), { recursive: true });
		for (const one of files) this.mark(one);
		await rename(full, trash);
		return this.tellAll(files.map((one) => [one, "deleted"]), path, by.id);
	}

	async move(from: DeckPath, to: DeckPath, by: Caller): Promise<Revision> {
		const [source, target] = [await this.real(from), await this.real(to)];
		const files = await this.filesUnder(from, source);
		if (!files) throw new Refused("not_found", `There is nothing at ${from}.`, "file.list");
		if (await this.kind(target)) throw new Refused("conflict", `${to} already exists.`, "file.delete");
		const moved = files.map((one) => toDeckPath(to + one.slice(from.length)));
		for (const one of [...files, ...moved]) this.mark(one);
		await mkdir(dirname(target), { recursive: true });
		await rename(source, target);
		const changes: [DeckPath, FileChange["kind"]][] = [...files.map((one) => [one, "deleted"] as [DeckPath, "deleted"]), ...moved.map((one) => [one, "written"] as [DeckPath, "written"])];
		return this.tellAll(changes, to, by.id);
	}

	close(): void {
		this.watcher?.close();
		this.watcher = undefined;
		for (const timer of this.pending.values()) clearTimeout(timer);
		this.pending.clear();
	}

	/** The full path, refused if a symlink on the way leads out of the deck. */
	private async real(path: DeckPath): Promise<string> {
		const full = join(this.root, path);
		let at = this.root;
		for (const part of path.split("/")) {
			at = join(at, part);
			const info = await lstat(at).catch(() => undefined);
			if (!info) break;
			if (info.isSymbolicLink()) await this.checkLink(at, path);
		}
		return full;
	}

	private async checkLink(at: string, path: DeckPath): Promise<void> {
		const target = await realpath(at).catch(() => at);
		const inside = relative(this.root, target);
		if (inside.startsWith("..") || inside.startsWith(sep) || layout.hiddenPart(inside)) throw new Refused("invalid", `${path} leads out of the deck.`, "file.list");
	}

	private async kind(full: string): Promise<"file" | "dir" | undefined> {
		const info = await stat(full).catch(() => undefined);
		return info ? (info.isDirectory() ? "dir" : "file") : undefined;
	}

	private async filesUnder(path: DeckPath, full: string): Promise<DeckPath[] | undefined> {
		const kind = await this.kind(full);
		if (kind === "file") return [path];
		if (!kind) return undefined;
		const out: DeckPath[] = [];
		for (const entry of await readdir(full, { recursive: true, withFileTypes: true })) {
			if (!entry.isFile()) continue;
			const rel = relative(this.root, join(entry.parentPath, entry.name)).split(sep).join("/");
			if (!layout.hiddenPart(rel)) out.push(toDeckPath(rel));
		}
		return out;
	}

	private refusal(error: unknown, path: string, what = "file"): Refused {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") return new Refused("not_found", `There is no ${what} at ${path}.`, "file.list");
		return new Refused("unavailable", `${path} could not be read: ${(error as Error).message}`);
	}

	private mark(path: string): void {
		this.own.set(path, this.clock() + OWN_MS);
	}

	private tell(path: DeckPath, kind: FileChange["kind"], by: string): Revision {
		return this.tellAll([[path, kind]], path, by);
	}

	private tellAll(changes: [DeckPath, FileChange["kind"]][], path: DeckPath, by: string): Revision {
		const rev = ++this.rev;
		const at = this.clock();
		for (const [one, kind] of changes) for (const on of this.watchers) on({ path: one, kind, rev, by, at });
		return { path, rev, by, at };
	}

	/** A change on the disk: ours are let pass; others are announced once settled. */
	private heard(name: string): void {
		const rel = name.split(sep).join("/");
		if (layout.hiddenPart(rel)) return;
		clearTimeout(this.pending.get(rel));
		this.pending.set(rel, setTimeout(() => void this.settle(rel), 60));
	}

	private async settle(rel: string): Promise<void> {
		this.pending.delete(rel);
		const mine = this.own.get(rel);
		if (mine !== undefined && mine > this.clock()) return;
		this.own.delete(rel);
		const kind = await this.kind(join(this.root, rel));
		if (kind === "dir" || (!kind && rel === basename(this.root))) return;
		this.tell(toDeckPath(rel), kind ? "written" : "deleted", "disk");
	}
}
