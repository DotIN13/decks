import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import type { DocChange, DocFormat } from "../index.ts";
import { DirectoryVersions, type VersionStore } from "./versions.ts";

/**
 * A folder of documents being worked on: each one copied in, with its history and its
 * suggestions kept beside it.
 *
 * Opening a file that lives anywhere else copies it into a folder of its own here, and from then
 * on the page and the agents edit the copy. The original is left as it was until somebody writes
 * the copy back. Each folder holds everything that document's work needs, so it travels with the
 * deck and survives a restart:
 *
 *     <dir>/<name>/
 *         paper.tex       the working copy, the file pages and agents edit
 *         doc.json        where it came from, and when it was copied
 *         base            the original's text as last taken in or written back
 *         changes.json    the suggestions still waiting for a yes or a no
 *         versions/       every version, the time machine
 *
 * `base` is what makes the original safe to keep editing elsewhere: a later write to it is
 * merged three ways, base to original against base to copy, so neither side's edits are lost.
 */

export interface DocMeta {
	/** The original's absolute path. */
	source: string;
	/** The working copy's file name inside the folder. */
	file: string;
	format: DocFormat;
	copiedAt: number;
	/** When the copy was last written back to the original. */
	writtenAt?: number;
}

export class DocLibrary {
	private readonly stores = new Map<string, DirectoryVersions>();

	/** `dir` is absolute: the folder all the document folders go in. */
	constructor(readonly dir: string) {}

	/** True for a file inside one of this library's document folders. */
	contains(file: string): boolean {
		const rel = relative(this.dir, file);
		return rel !== "" && !rel.startsWith("..") && rel.split(sep).length >= 2;
	}

	/**
	 * The working copy for a file: the file itself when it already is one, the copy already made
	 * of it when there is one, and a new copy otherwise.
	 */
	working(file: string, format: DocFormat, text: string): { file: string; source?: string } {
		if (this.contains(file)) return { file, ...(this.meta(file) ? { source: this.meta(file)!.source } : {}) };
		for (const folder of this.folders()) {
			const meta = readMeta(folder);
			if (meta?.source === file) return { file: join(folder, meta.file), source: file };
		}
		const folder = this.freshFolder(basename(file, extname(file)));
		mkdirSync(folder, { recursive: true });
		const copy = join(folder, basename(file));
		copyFileSync(file, copy);
		const meta: DocMeta = { source: file, file: basename(file), format, copiedAt: Date.now() };
		writeFileSync(join(folder, "doc.json"), `${JSON.stringify(meta, null, "\t")}\n`);
		writeFileSync(join(folder, "base"), text);
		return { file: copy, source: file };
	}

	/** Where a working copy came from, or undefined for a file made here. */
	meta(working: string): DocMeta | undefined {
		return this.contains(working) ? readMeta(this.folderOf(working)) : undefined;
	}

	/** The working copy has been written back: say so, and take what was written as the new base. */
	wroteBack(working: string, text: string): void {
		const meta = this.meta(working);
		if (!meta) return;
		this.setBase(working, text);
		writeFileSync(join(this.folderOf(working), "doc.json"), `${JSON.stringify({ ...meta, writtenAt: Date.now() }, null, "\t")}\n`);
	}

	/** The original's text as last taken in or written back. */
	base(working: string): string | undefined {
		try {
			return readFileSync(join(this.folderOf(working), "base"), "utf8");
		} catch {
			return undefined;
		}
	}

	setBase(working: string, text: string): void {
		writeFileSync(join(this.folderOf(working), "base"), text);
	}

	/** The folder's own version store, keyed by the working copy's name. */
	versions(working: string): VersionStore {
		const folder = this.folderOf(working);
		let store = this.stores.get(folder);
		if (!store) this.stores.set(folder, (store = new DirectoryVersions(join(folder, "versions"))));
		return store;
	}

	changes(working: string): DocChange[] {
		try {
			const list = JSON.parse(readFileSync(join(this.folderOf(working), "changes.json"), "utf8")) as unknown;
			return Array.isArray(list) ? (list as DocChange[]) : [];
		} catch {
			return [];
		}
	}

	saveChanges(working: string, changes: readonly DocChange[]): void {
		writeFileSync(join(this.folderOf(working), "changes.json"), `${JSON.stringify(changes, null, "\t")}\n`);
	}

	/** The document folder a file inside the library sits in. */
	folderOf(working: string): string {
		const first = relative(this.dir, working).split(sep)[0]!;
		return join(this.dir, first);
	}

	private folders(): string[] {
		if (!existsSync(this.dir)) return [];
		return readdirSync(this.dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(this.dir, entry.name));
	}

	/** A folder name from the file's, made safe and not yet taken. */
	private freshFolder(stem: string): string {
		const clean = stem.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "document";
		let name = clean;
		for (let n = 2; existsSync(join(this.dir, name)); n++) name = `${clean}-${n}`;
		return join(this.dir, name);
	}
}

function readMeta(folder: string): DocMeta | undefined {
	try {
		const meta = JSON.parse(readFileSync(join(folder, "doc.json"), "utf8")) as DocMeta;
		return typeof meta.source === "string" && typeof meta.file === "string" ? meta : undefined;
	} catch {
		return undefined;
	}
}
