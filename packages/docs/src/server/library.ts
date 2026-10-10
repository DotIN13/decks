import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DocChange, DocFormat } from "../index.ts";
import { DirectoryVersions, type VersionStore } from "./versions.ts";

/**
 * Where each document's records are kept: its history, the changes waiting for review, and its
 * typeset PDF. The document itself stays where it is, in its repository or folder, and is edited
 * there in place; nothing of it is copied here.
 *
 *     <dir>/<name>/
 *         doc.json        which file this folder is the records of
 *         changes.json    recent writes from outside, which pages highlight
 *         versions/       every version, the time machine
 *         build/          the PDF a LaTeX file typesets to, and its log
 *
 * Kept apart from the file so a paper's repository gets no new files in it, and so a deck carries
 * the history of everything worked on from it.
 */

export interface DocMeta {
	/**
	 * The document's absolute path, as `readMeta` hands it back. On disk it is written relative to
	 * the record folder when it is in the same deck, so a deck that moves keeps its records.
	 */
	source: string;
	format: DocFormat;
	openedAt: number;
	/** Set on a folder from before documents were edited in place: the copy it held, now unused. */
	file?: string;
	/**
	 * A Google Doc: the folder holds its markdown mirror as `source`, which the page edits, and
	 * the Doc's own text as last read in `base.md`, so its edits can be told from the page's.
	 */
	google?: { id: string; title: string; url: string };
}

export class DocLibrary {
	private readonly stores = new Map<string, DirectoryVersions>();
	private readonly bySource = new Map<string, string>();

	/**
	 * `dir` is absolute: the folder all the record folders go in. `path` is what a page calls it,
	 * so a PDF typeset into it can be fetched.
	 */
	constructor(
		readonly dir: string,
		readonly path = "docs",
	) {}

	/** True for a file inside one of this library's record folders. */
	contains(file: string): boolean {
		const rel = relative(this.dir, file);
		return rel !== "" && !rel.startsWith("..") && rel.split(sep).length >= 2;
	}

	/** The folder of a document's records, made the first time it is opened. */
	folder(file: string, format: DocFormat): string {
		const known = this.find(file);
		if (known) return known;
		const folder = this.freshFolder(basename(file, extname(file)));
		mkdirSync(folder, { recursive: true });
		const meta: DocMeta = { source: file, format, openedAt: Date.now() };
		this.writeMeta(folder, meta);
		this.bySource.set(file, folder);
		return folder;
	}

	/** A folder for a Google Doc's records and its mirror, made the first time it is linked. */
	googleFolder(id: string, title: string, url: string): { folder: string; mirror: string; fresh: boolean } {
		for (const folder of this.folders()) {
			const meta = readMeta(folder);
			if (meta?.google?.id !== id) continue;
			// A mirror from when Docs were mirrored as markdown: the folder keeps its history, the mirror is made again.
			if (!meta.source.endsWith(".gdoc.txt")) {
				const mirror = join(folder, `${basename(folder)}.gdoc.txt`);
				this.writeMeta(folder, { ...meta, source: mirror });
				return { folder, mirror, fresh: true };
			}
			return { folder, mirror: meta.source, fresh: false };
		}
		const folder = this.freshFolder(title || "google-doc");
		mkdirSync(folder, { recursive: true });
		// Text whose every character is one of the Doc's indices (`gdoc/units.ts`), not something to read by hand.
		const mirror = join(folder, `${basename(folder)}.gdoc.txt`);
		const meta: DocMeta = { source: mirror, format: "text", openedAt: Date.now(), google: { id, title, url } };
		this.writeMeta(folder, meta);
		return { folder, mirror, fresh: true };
	}

	/** Every Google Doc linked here, with its mirror. */
	googleDocs(): Array<{ folder: string; mirror: string; google: NonNullable<DocMeta["google"]> }> {
		return this.folders().flatMap((folder) => {
			const meta = readMeta(folder);
			return meta?.google ? [{ folder, mirror: meta.source, google: meta.google }] : [];
		});
	}

	/**
	 * A folder's record, its source written relative to the folder when the source is in the deck
	 * the library is in (the folder above `dir`), and absolute when it is somewhere else.
	 */
	private writeMeta(folder: string, meta: DocMeta): void {
		const inDeck = !relative(dirname(this.dir), meta.source).startsWith("..") && !isAbsolute(relative(dirname(this.dir), meta.source));
		const source = inDeck ? relative(folder, meta.source).split(sep).join("/") : meta.source;
		writeFileSync(join(folder, "doc.json"), `${JSON.stringify({ ...meta, source }, null, "\t")}\n`);
	}

	/** The folder of a document's records, if it has been opened before. */
	find(file: string): string | undefined {
		const cached = this.bySource.get(file);
		if (cached && readMeta(cached)?.source === file) return cached;
		for (const folder of this.folders()) {
			if (readMeta(folder)?.source !== file) continue;
			this.bySource.set(file, folder);
			return folder;
		}
		return undefined;
	}

	/** Whose records a file inside the library belongs to: for a page still naming an old copy. */
	meta(inside: string): DocMeta | undefined {
		return this.contains(inside) ? readMeta(this.folderOf(inside)) : undefined;
	}

	/** The folder's own version store. */
	versions(folder: string): VersionStore {
		let store = this.stores.get(folder);
		if (!store) this.stores.set(folder, (store = new DirectoryVersions(join(folder, "versions"))));
		return store;
	}

	changes(folder: string): DocChange[] {
		try {
			const list = JSON.parse(readFileSync(join(folder, "changes.json"), "utf8")) as unknown;
			return Array.isArray(list) ? (list as DocChange[]) : [];
		} catch {
			return [];
		}
	}

	saveChanges(folder: string, changes: readonly DocChange[]): void {
		writeFileSync(join(folder, "changes.json"), `${JSON.stringify(changes, null, "\t")}\n`);
	}

	/** A record folder's name, as it sits in `dir`. */
	name(folder: string): string {
		return relative(this.dir, folder).split(sep)[0]!;
	}

	/** The record folder a file inside the library sits in. */
	folderOf(inside: string): string {
		return join(this.dir, relative(this.dir, inside).split(sep)[0]!);
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

/**
 * A folder's record, with its source as an absolute path.
 *
 * Relative sources are the folder's own (`writeMeta`). An absolute one from before that, naming a
 * file in this very folder by where the deck used to be (a Google Doc's mirror, after the deck
 * moved), is found where the folder is now; any other source that is gone is left as it is, and
 * simply matches no file, so opening that file again starts a new record.
 */
function readMeta(folder: string): DocMeta | undefined {
	try {
		const meta = JSON.parse(readFileSync(join(folder, "doc.json"), "utf8")) as DocMeta;
		if (typeof meta.source !== "string") return undefined;
		if (!isAbsolute(meta.source)) return { ...meta, source: resolve(folder, meta.source) };
		if (existsSync(meta.source)) return meta;
		const mark = `/${basename(folder)}/`;
		const at = meta.source.lastIndexOf(mark);
		const here = at >= 0 ? join(folder, meta.source.slice(at + mark.length)) : undefined;
		return here && existsSync(here) ? { ...meta, source: here } : meta;
	} catch {
		return undefined;
	}
}
