import { createHash } from "node:crypto";
import { Refused, type Caller } from "../../protocol/index.ts";
import { readJson, writeJson } from "./store.ts";
import { toDeckPath, type Bytes, type Deck, type DeckPath, type Entry, type FileChange, type Revision, type Stop, type Store } from "./types.ts";

// Every write is recorded as a revision, with its bytes kept once by hash,
// so any file at any moment can be read and restored. A change made on the
// disk outside the server (by "disk") is recorded when the deck hears it.
// A file that was there before history began is recorded at revision 0.

type Kept = { path: DeckPath; rev: number; by: string; at: number; kind: "written" | "deleted"; hash?: string };

const hashOf = (bytes: Bytes) => createHash("sha256").update(bytes).digest("hex");
const keyOf = (kept: Kept, seq: number) => `log/${String(kept.rev).padStart(12, "0")}/${seq}`;

export class HistoryDeck implements Deck {
	private log: Kept[] = [];
	private seq = 0;

	constructor(
		private inner: Deck,
		private store: Store,
	) {}

	async load(): Promise<void> {
		const keys = await this.store.keys("log/");
		for (const key of keys) this.log.push(await readJson<Kept>(this.store, key, undefined as never));
		this.seq = keys.length;
	}

	/** The last revision recorded, to start the deck's counter from. */
	lastRev(): number {
		return this.log.reduce((top, one) => Math.max(top, one.rev), 0);
	}

	read(path: DeckPath): Promise<Bytes> {
		return this.inner.read(path);
	}

	list(dir: DeckPath | ""): Promise<Entry[]> {
		return this.inner.list(dir);
	}

	async write(path: DeckPath, bytes: Bytes, by: Caller): Promise<Revision> {
		const done = await this.inner.write(path, bytes, by);
		await this.record({ path, rev: done.rev, by: done.by, at: done.at, kind: "written" }, bytes);
		return done;
	}

	async remove(path: DeckPath, by: Caller): Promise<Revision> {
		const files = await this.baseline(path);
		const done = await this.inner.remove(path, by);
		for (const one of files) await this.record({ path: one, rev: done.rev, by: done.by, at: done.at, kind: "deleted" });
		return done;
	}

	async move(from: DeckPath, to: DeckPath, by: Caller): Promise<Revision> {
		const files = await this.baseline(from);
		const done = await this.inner.move(from, to, by);
		for (const one of files) {
			const hash = this.latest(one, Infinity)?.hash;
			await this.record({ path: one, rev: done.rev, by: done.by, at: done.at, kind: "deleted" });
			await this.record({ path: toDeckPath(to + one.slice(from.length)), rev: done.rev, by: done.by, at: done.at, kind: "written", ...(hash ? { hash } : {}) });
		}
		return done;
	}

	watch(on: (change: FileChange) => void): Stop {
		return this.inner.watch((change) => {
			if (change.by === "disk") void this.hear(change);
			on(change);
		});
	}

	async revisions(path: DeckPath): Promise<Revision[]> {
		return this.log.filter((one) => one.path === path).map(({ path: p, rev, by, at }) => ({ path: p, rev, by, at }));
	}

	async readAt(path: DeckPath, rev: number): Promise<Bytes> {
		const kept = this.latest(path, rev);
		if (!kept || kept.kind === "deleted" || !kept.hash) throw new Refused("not_found", `${path} did not exist at revision ${rev}.`, "file.versions");
		const bytes = await this.store.get(`blob/${kept.hash}`);
		if (!bytes) throw new Refused("not_found", `The bytes of ${path} at revision ${rev} are gone.`);
		return bytes;
	}

	restore(path: DeckPath, rev: number, by: Caller): Promise<Revision> {
		return this.readAt(path, rev).then((bytes) => this.write(path, bytes, by));
	}

	/** The deck's revision at a moment: the last one recorded at or before it. */
	revAt(time: number): number {
		return this.log.filter((one) => one.at <= time).reduce((top, one) => Math.max(top, one.rev), 0);
	}

	/** Put every file back as it was at a revision; files made since go to the trash. */
	async restoreAll(rev: number, by: Caller): Promise<number> {
		const touched = new Set(this.log.filter((one) => one.rev > rev).map((one) => one.path));
		let changed = 0;
		for (const path of touched) {
			const then = this.latest(path, rev);
			const now = this.latest(path, Infinity);
			if (then?.kind === "written" && then.hash !== now?.hash) await this.restore(path, rev, by).then(() => changed++);
			if ((!then || then.kind === "deleted") && now?.kind === "written") await this.remove(path, by).then(() => changed++);
		}
		return changed;
	}

	private latest(path: DeckPath, rev: number): Kept | undefined {
		let found: Kept | undefined;
		for (const one of this.log) if (one.path === path && one.rev <= rev && (!found || one.rev >= found.rev)) found = one;
		return found;
	}

	private async record(kept: Kept, bytes?: Bytes): Promise<void> {
		if (bytes) {
			kept.hash = hashOf(bytes);
			if (!(await this.store.get(`blob/${kept.hash}`))) await this.store.put(`blob/${kept.hash}`, bytes);
		}
		this.log.push(kept);
		await writeJson(this.store, keyOf(kept, this.seq++), kept);
	}

	/** Records, at revision 0, files under a path that history has never seen. */
	private async baseline(path: DeckPath): Promise<DeckPath[]> {
		const files = await this.filesUnder(path);
		for (const one of files) {
			if (this.latest(one, Infinity)) continue;
			await this.record({ path: one, rev: 0, by: "before", at: 0, kind: "written" }, await this.inner.read(one));
		}
		return files;
	}

	private async filesUnder(path: DeckPath): Promise<DeckPath[]> {
		try {
			await this.inner.read(path);
			return [path];
		} catch {
			const entries = await this.inner.list(path).catch(() => []);
			const nested = await Promise.all(entries.map((e) => (e.kind === "file" ? [e.path] : this.filesUnder(e.path))));
			return nested.flat();
		}
	}

	private async hear(change: FileChange): Promise<void> {
		const base = { path: change.path, rev: change.rev, by: change.by, at: change.at };
		if (change.kind === "deleted") return this.record({ ...base, kind: "deleted" });
		const bytes = await this.inner.read(change.path).catch(() => undefined);
		if (bytes) await this.record({ ...base, kind: "written" }, bytes);
	}
}
