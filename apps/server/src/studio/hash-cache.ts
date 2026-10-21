import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The hash of each file sync has looked at, with the size and modified time it had then, so a file
 * is read and hashed again only when one of them changes (`.decks/studio-hashes.json`).
 *
 * Size and time catch an edit by any ordinary tool. One that writes the same number of bytes and
 * puts the old time back would slip by, so every so often (`RECHECK_MS`) sync asks for a full check,
 * which hashes everything again whatever the cache says.
 */
export const RECHECK_MS = 10 * 60_000;

interface Entry { size: number; mtimeMs: number; hash: string }

export class HashCache {
	private entries = new Map<string, Entry>();
	private changed = false;
	/** Paths looked at since the last `prune`, so files that went are forgotten. */
	private seen = new Set<string>();
	/** What hashing cost, for the bench: bytes and files hashed, and how many hashes were reused. */
	readonly cost = { hashed: 0, files: 0, reused: 0 };

	constructor(private readonly file: string) {
		try {
			const saved = JSON.parse(readFileSync(file, "utf8")) as Record<string, Entry>;
			for (const [path, e] of Object.entries(saved)) if (e && typeof e.hash === "string" && typeof e.size === "number" && typeof e.mtimeMs === "number") this.entries.set(path, e);
		} catch {
			/* none yet, or unreadable: everything is hashed once */
		}
	}

	/**
	 * A file's hash, and its bytes when they had to be read. `fresh` hashes it whatever the cache says
	 * (the full check). Undefined when the file is not there.
	 */
	hash(full: string, fresh = false): { hash: string; size: number; bytes?: Buffer } | undefined {
		let st;
		try {
			st = statSync(full);
		} catch {
			this.forget(full);
			return undefined;
		}
		if (!st.isFile()) return undefined;
		this.seen.add(full);
		const known = this.entries.get(full);
		if (!fresh && known && known.size === st.size && known.mtimeMs === st.mtimeMs) {
			this.cost.reused++;
			return { hash: known.hash, size: known.size };
		}
		let bytes: Buffer;
		try {
			bytes = readFileSync(full);
		} catch {
			return undefined;
		}
		const hash = sha256(bytes);
		this.cost.hashed += bytes.length;
		this.cost.files++;
		// The time from before the read: a write during it shows as a change next time, not as this hash.
		if (!known || known.hash !== hash || known.size !== st.size || known.mtimeMs !== st.mtimeMs) {
			this.entries.set(full, { size: st.size, mtimeMs: st.mtimeMs, hash });
			this.changed = true;
		}
		return { hash, size: bytes.length, bytes };
	}

	/** Remember a file sync has just written itself, so it is not read back to be hashed. */
	wrote(full: string, hash: string) {
		try {
			const st = statSync(full);
			this.entries.set(full, { size: st.size, mtimeMs: st.mtimeMs, hash });
			this.seen.add(full);
			this.changed = true;
		} catch {
			/* gone already */
		}
	}

	forget(full: string) {
		if (this.entries.delete(full)) this.changed = true;
	}

	/** After a full pass: forget every file it did not look at (deleted, or no longer synced). */
	prune() {
		for (const path of this.entries.keys()) if (!this.seen.has(path)) this.forget(path);
		this.seen.clear();
	}

	/** Written when something changed, readable by this account only, like the sync state beside it. */
	save() {
		if (!this.changed) return;
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.entries)), { mode: 0o600 });
		try {
			chmodSync(this.file, 0o600);
		} catch {
			/* a filesystem without modes */
		}
		this.changed = false;
	}

	get size() {
		return this.entries.size;
	}
}

export function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}
