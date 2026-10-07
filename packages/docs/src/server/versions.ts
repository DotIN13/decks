import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DocVersion } from "../index.ts";

/**
 * Where a document's versions are kept: the time machine.
 *
 * Content-addressed, so a return to an old text costs nothing, and keyed by whatever the
 * resolver calls the document. An app that already keeps versions of its files passes its own
 * store (Decks passes the store its boards use); the two here are for everyone else.
 */
export interface VersionStore {
	/** Keep `text` as the newest version of `key` and return its id. Keeping the same text twice is free. */
	record(key: string, text: string): string;
	/** Every version of `key`, oldest first. */
	entries(key: string): readonly DocVersion[];
	read(sha: string): string;
}

const shaOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** Versions in memory, gone with the process: for tests and for a page nobody needs to rewind. */
export class MemoryVersions implements VersionStore {
	private readonly texts = new Map<string, string>();
	private readonly order = new Map<string, DocVersion[]>();

	record(key: string, text: string): string {
		const sha = shaOf(text);
		this.texts.set(sha, text);
		const list = this.order.get(key) ?? [];
		if (list.at(-1)?.sha !== sha) list.push({ sha, at: Date.now() });
		this.order.set(key, list);
		return sha;
	}

	entries(key: string): readonly DocVersion[] {
		return [...(this.order.get(key) ?? [])];
	}

	read(sha: string): string {
		const text = this.texts.get(sha);
		if (text === undefined) throw new Error(`No version ${sha}`);
		return text;
	}
}

/**
 * Versions in a folder: one file per text, named by its hash, and an `index.json` of the order
 * per document, trimmed to the newest `keep` (the texts stay, so an id never stops reading).
 */
export class DirectoryVersions implements VersionStore {
	private readonly order: Record<string, DocVersion[]>;

	constructor(
		private readonly dir: string,
		private readonly keep = 200,
	) {
		try {
			this.order = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as Record<string, DocVersion[]>;
		} catch {
			this.order = {};
		}
	}

	record(key: string, text: string): string {
		const sha = shaOf(text);
		mkdirSync(this.dir, { recursive: true });
		const file = join(this.dir, sha);
		if (!existsSync(file)) writeFileSync(file, text);
		const list = (this.order[key] ??= []);
		if (list.at(-1)?.sha !== sha) {
			list.push({ sha, at: Date.now() });
			if (list.length > this.keep) list.splice(0, list.length - this.keep);
			writeFileSync(join(this.dir, "index.json"), `${JSON.stringify(this.order, null, 1)}\n`);
		}
		return sha;
	}

	entries(key: string): readonly DocVersion[] {
		return [...(this.order[key] ?? [])];
	}

	read(sha: string): string {
		if (!/^[0-9a-f]{6,64}$/.test(sha)) throw new Error(`Not a version id: ${sha}`);
		return readFileSync(join(this.dir, sha), "utf8");
	}
}
