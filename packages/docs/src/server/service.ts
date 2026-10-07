import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { basename, dirname, extname } from "node:path";
import { applySplice, transformSplices, type DocAuthor, type DocChange, type DocClientMessage, type DocFormat, type DocServerMessage, type Splice } from "../index.ts";
import { invert, land, spliceDiff } from "../merge.ts";
import type { DocLibrary } from "./library.ts";
import type { VersionStore } from "./versions.ts";
import { readEntry, replaceEntry } from "./zip.ts";

/**
 * `@decks/docs/server`: the service that owns the documents pages have open.
 *
 * **The file on disk is written within a frame of every keystroke**, because a page sends its
 * splices at most every 50 ms and each batch is written as it lands. The time machine is the
 * `VersionStore` it is given: a version is kept when typing pauses for a second, and on both sides
 * of every write from outside, so going back steps over sentences rather than letters.
 *
 * **An agent edits a document with its own tools**, not through this. Its write reaches the file,
 * the watcher here sees it, and the difference goes to every page as splices marked as a change
 * to accept or reject. Rejecting is the reverse splices, landed like anyone's typing.
 */

/** Typing that stops for this long becomes a version. */
export const PAUSE_MS = 1000;
/** A write from outside is read after this much quiet on the file. */
export const QUIET_MS = 80;
/** How many revisions of splices are kept, to move a late batch past what landed before it. */
const LOG = 200;

/** What opens by default: text formats people write in, and Word. */
export const EDITABLE = [".md", ".markdown", ".txt", ".tex", ".bib", ".sty", ".cls", ".rst", ".org", ".docx"] as const;
const DOCX_PART = "word/document.xml";

interface Open {
	key: string;
	file: string;
	/** Where its versions go, and the name they are kept under there. */
	versions: VersionStore;
	vkey: string;
	/** For a working copy in a library: the original, which it is written back to. */
	source?: { file: string; writable: boolean; watcher?: FSWatcher; quiet?: ReturnType<typeof setTimeout> };
	format: DocFormat;
	text: string;
	rev: number;
	/** Each landed batch: the revision it was made on, the one it made, and its splices. */
	log: Array<{ base: number; rev: number; splices: Splice[] }>;
	changes: Map<string, { change: DocChange; rev: number }>;
	clients: Set<string>;
	watcher?: FSWatcher;
	quiet?: ReturnType<typeof setTimeout>;
	pause?: ReturnType<typeof setTimeout>;
	/** Typing has moved the text past the last kept version. */
	unversioned: boolean;
	writable: boolean;
	/** The file's size and time as this service last wrote or read it, to notice a write from outside. */
	seen?: { size: number; mtime: number };
}

/** Where a page's path points: the file, the name versions are kept under, and whether it may be written. */
export interface Resolved {
	file: string;
	key: string;
	writable: boolean;
}

export interface DocServiceOptions {
	/**
	 * A page's path -> the file it means. **This is the security boundary**: throw for anything a
	 * page must not open. `key` names the document in `doc.changed` and in the version store, so it
	 * should be the same for every spelling of one file.
	 */
	resolve(path: string): Resolved;
	versions: VersionStore;
	/**
	 * Where documents are copied to be worked on (`library.ts`). When there is one, opening a file
	 * outside it opens a copy inside it instead, and its history and suggestions are kept there.
	 */
	library?: () => DocLibrary | undefined;
	/** To every page. */
	send(message: DocServerMessage): void;
	/** Who most likely wrote the file just now, when the host can tell (an agent's name). */
	writer?(file: string): string | undefined;
	/** File extensions that open, with the dot; `EDITABLE` by default. */
	editable?: readonly string[];
	pauseMs?: number;
	quietMs?: number;
}

export class DocService {
	private readonly open = new Map<string, Open>();
	private readonly editable: ReadonlySet<string>;
	private readonly pauseMs: number;
	private readonly quietMs: number;

	constructor(private readonly context: DocServiceOptions) {
		this.editable = new Set((context.editable ?? EDITABLE).map((ext) => ext.toLowerCase()));
		this.pauseMs = context.pauseMs ?? PAUSE_MS;
		this.quietMs = context.quietMs ?? QUIET_MS;
	}

	/**
	 * One message from a page, answered on `reply` (that page alone); what changed goes to every
	 * page through `send`. The whole of the protocol for a host that has a socket and nothing else.
	 */
	handle(message: DocClientMessage, reply: (message: DocServerMessage) => void): void {
		try {
			switch (message.type) {
				case "doc.open":
					return reply(this.opened(message.path, message.client));
				case "doc.close":
					return this.closed(message.path, message.client);
				case "doc.patch":
					return reply(this.patch(message.path, message.client, message.rev, message.batch, message.splices));
				case "doc.review":
					return this.review(message.path, message.change, message.accept);
				case "doc.versions":
					return reply(this.versions(message.path));
				case "doc.restore":
					return this.restore(message.path, message.sha);
				case "doc.writeback":
					return reply(this.writeBack(message.path));
			}
		} catch (error) {
			reply({ type: "notice", level: "warn", text: (error as Error).message });
		}
	}

	/**
	 * Open a document for a page, or join the pages already on it. With a library, a file from
	 * anywhere else opens as its working copy, and the answer names the copy as `path`, the path
	 * the page asked for as `asked`, and the original as `source`.
	 */
	opened(path: string, client: string): Extract<DocServerMessage, { type: "doc.state" }> {
		let doc: Open;
		try {
			doc = this.load(this.adopt(path));
		} catch (error) {
			return { type: "doc.state", path, asked: path, client, rev: 0, format: "text", text: "", changes: [], error: (error as Error).message };
		}
		doc.clients.add(client);
		return {
			type: "doc.state",
			path: doc.key,
			asked: path,
			client,
			rev: doc.rev,
			format: doc.format,
			text: doc.text,
			changes: [...doc.changes.values()].map((entry) => entry.change),
			...(doc.source ? { source: doc.source.file } : {}),
			...(doc.writable ? {} : { error: `${path} opens read-only: it is not somewhere this server may write.` }),
		};
	}

	/**
	 * Write the working copy back to its original. A write to the original since the copy last
	 * saw it is merged into the copy first, so writing back never undoes it.
	 */
	writeBack(path: string): Extract<DocServerMessage, { type: "doc.written" }> {
		const doc = this.find(path);
		if (!doc?.source) return { type: "doc.written", path, error: `${path} is not a copy of another file, so there is nothing to write it back to.` };
		if (!doc.source.writable) return { type: "doc.written", path, source: doc.source.file, error: `${doc.source.file} is not somewhere this server may write.` };
		this.absorb(doc);
		this.pull(doc);
		writeSource(doc.source.file, doc.format, doc.text);
		this.context.library?.()?.wroteBack(doc.file, doc.text);
		return { type: "doc.written", path: doc.key, source: doc.source.file };
	}

	closed(path: string, client: string): void {
		const doc = this.find(path);
		if (!doc) return;
		doc.clients.delete(client);
		if (doc.clients.size === 0) this.dispose(doc);
	}

	/** Land a page's batch, write the file, and tell every page. */
	patch(path: string, client: string, rev: number, batch: string, splices: Splice[]): Extract<DocServerMessage, { type: "doc.patched" }> {
		const doc = this.find(path);
		const all = splices.map((_, index) => index);
		if (!doc || !doc.writable || !Array.isArray(splices)) return { type: "doc.patched", path, batch, rev: doc?.rev ?? 0, refused: all };
		// A revision from the future is a page from before a restart: it reopens.
		if (rev > doc.rev) return { type: "doc.patched", path, batch, rev: doc.rev, refused: all, text: doc.text };
		const clean = splices.filter(isSplice);
		if (clean.length !== splices.length) return { type: "doc.patched", path, batch, rev: doc.rev, refused: all };
		// A write from outside that the watcher has not read yet is taken in first, or this write would undo it.
		this.absorb(doc);
		const landed = land(doc.text, clean, this.since(doc, rev));
		if (landed.applied.length > 0) {
			const base = doc.rev;
			this.commit(doc, landed.text, landed.applied);
			doc.unversioned = true;
			this.schedulePause(doc);
			this.context.send({ type: "doc.changed", path: doc.key, base, rev: doc.rev, splices: landed.applied, by: "person", client, batch });
		}
		const answer = { type: "doc.patched" as const, path, batch, rev: doc.rev, refused: landed.refused };
		return landed.refused.length > 0 ? { ...answer, text: doc.text } : answer;
	}

	/** Keep a change from outside, or take it back with its reverse splices. */
	review(path: string, change: string, accept: boolean): void {
		const doc = this.find(path);
		const entry = doc?.changes.get(change);
		if (!doc || !entry) return;
		doc.changes.delete(change);
		this.saveChanges(doc);
		if (accept) {
			this.context.send({ type: "doc.changed", path: doc.key, base: doc.rev, rev: doc.rev, splices: [], by: "person", settled: change });
			return;
		}
		this.absorb(doc);
		this.flushVersion(doc);
		const landed = land(doc.text, invert(entry.change.splices), this.since(doc, entry.rev));
		const base = doc.rev;
		if (landed.applied.length > 0) {
			this.commit(doc, landed.text, landed.applied);
			doc.versions.record(doc.vkey, doc.text);
		}
		this.context.send({ type: "doc.changed", path: doc.key, base, rev: doc.rev, splices: landed.applied, by: "person", settled: change });
		if (landed.refused.length > 0) {
			this.context.send({ type: "notice", level: "warn", text: `Part of that change was typed over since, so ${landed.refused.length} of its pieces were left as they are.` });
		}
	}

	versions(path: string): Extract<DocServerMessage, { type: "doc.versions" }> {
		const open = this.find(path);
		const doc = open ?? this.load(this.adopt(path));
		const versions = [...doc.versions.entries(doc.vkey)];
		if (!open) this.dispose(doc);
		return { type: "doc.versions", path, versions };
	}

	/** Put one kept version back, as one edit every page applies. */
	restore(path: string, sha: string): void {
		const doc = this.find(path);
		if (!doc || !doc.writable) return;
		this.absorb(doc);
		const target = doc.versions.read(sha);
		const splices = spliceDiff(doc.text, target);
		if (splices.length === 0) return;
		this.flushVersion(doc);
		const base = doc.rev;
		this.commit(doc, target, splices);
		doc.versions.record(doc.vkey, target);
		this.context.send({ type: "doc.changed", path: doc.key, base, rev: doc.rev, splices, by: "person" });
	}

	/** The file a page asking for `path` would open, or a sentence saying why it cannot: for a host making a page. */
	openable(path: string): string {
		const { file } = this.keyOf(path);
		this.formatOf(file);
		if (!existsSync(file)) throw new Error(`${path} does not exist`);
		return file;
	}

	/** Every open document closed, for a deck switch or a shutdown. */
	closeAll(): void {
		for (const doc of [...this.open.values()]) this.dispose(doc);
	}

	// -- inside --------------------------------------------------------------------------------

	private keyOf(path: string): Resolved {
		return this.context.resolve(path);
	}

	private find(path: string): Open | undefined {
		try {
			return this.open.get(this.keyOf(path).key) ?? [...this.open.values()].find((doc) => doc.source?.file === this.keyOf(path).file);
		} catch {
			return undefined;
		}
	}

	/** The path to open for one a page asked for: its working copy, when there is a library. */
	private adopt(path: string): string {
		const library = this.context.library?.();
		if (!library) return path;
		const { file } = this.keyOf(path);
		if (library.contains(file)) return path;
		const format = this.formatOf(file);
		return library.working(file, format, readSource(file, format)).file;
	}

	private formatOf(file: string): DocFormat {
		const ext = extname(file).toLowerCase();
		if (!this.editable.has(ext)) throw new Error(`${basename(file)} is not a document this page edits (${[...this.editable].join(" ")})`);
		return ext === ".docx" ? "docx" : "text";
	}

	private load(path: string): Open {
		const { file, key, writable } = this.keyOf(path);
		const known = this.open.get(key);
		if (known) return known;
		const format = this.formatOf(file);
		const text = readSource(file, format);
		const library = this.context.library?.();
		const kept = library?.contains(file) ? library : undefined;
		const meta = kept?.meta(file);
		const doc: Open = {
			key,
			file,
			versions: kept ? kept.versions(file) : this.context.versions,
			vkey: kept ? basename(file) : key,
			...(meta ? { source: { file: meta.source, writable: this.writableSource(meta.source) } } : {}),
			format,
			text,
			// Dated, so a page holding a revision from before a restart can never match a new one.
			rev: Date.now(),
			log: [],
			changes: new Map(),
			clients: new Set(),
			unversioned: false,
			writable,
		};
		doc.seen = stamp(file);
		// Suggestions still waiting from before: history to move them by is gone, so a rejection finds their words.
		for (const change of kept?.changes(file) ?? []) doc.changes.set(change.id, { change, rev: doc.rev });
		doc.versions.record(doc.vkey, text);
		this.watch(doc);
		this.open.set(key, doc);
		// The original may have moved on while nobody had the copy open.
		this.pull(doc);
		return doc;
	}

	/** The splices that landed after `rev`, sequential, or `undefined` when they were not all kept. */
	private since(doc: Open, rev: number): Splice[] | undefined {
		if (rev === doc.rev) return [];
		const first = doc.log.findIndex((entry) => entry.base === rev);
		if (first === -1) return undefined;
		return doc.log.slice(first).flatMap((entry) => entry.splices);
	}

	private commit(doc: Open, text: string, splices: Splice[]): void {
		const base = doc.rev;
		doc.text = text;
		doc.rev = Math.max(doc.rev + 1, Date.now());
		doc.log.push({ base, rev: doc.rev, splices });
		if (doc.log.length > LOG) doc.log.splice(0, doc.log.length - LOG);
		writeSource(doc.file, doc.format, text);
		doc.seen = stamp(doc.file);
	}

	private schedulePause(doc: Open): void {
		clearTimeout(doc.pause);
		doc.pause = setTimeout(() => this.flushVersion(doc), this.pauseMs);
	}

	/** The typing so far as a version, now rather than at the pause. */
	private flushVersion(doc: Open): void {
		clearTimeout(doc.pause);
		doc.pause = undefined;
		if (!doc.unversioned) return;
		doc.unversioned = false;
		doc.versions.record(doc.vkey, doc.text);
	}

	/**
	 * The directory rather than the file, because a save that writes a new file and renames it
	 * over the old one (most scripts, many editors) leaves a watch on the old inode deaf.
	 */
	private watch(doc: Open): void {
		const name = basename(doc.file);
		try {
			doc.watcher = watch(dirname(doc.file), (_event, changed) => {
				if (changed && String(changed) !== name) return;
				clearTimeout(doc.quiet);
				doc.quiet = setTimeout(() => {
					if (this.open.has(doc.key)) this.absorb(doc);
				}, this.quietMs);
			});
			// A watcher never keeps the process alive on its own: the server's socket does that.
			doc.watcher.unref();
			if (doc.source) {
				const source = doc.source;
				const original = basename(source.file);
				source.watcher = watch(dirname(source.file), (_event, changed) => {
					if (changed && String(changed) !== original) return;
					clearTimeout(source.quiet);
					source.quiet = setTimeout(() => {
						if (this.open.has(doc.key)) this.pull(doc);
					}, this.quietMs);
				});
				source.watcher.unref();
			}
		} catch {
			// No watching on this platform: a write from outside shows when the page opens it again.
		}
	}

	/**
	 * A write from outside, if there was one: the difference becomes a change to review.
	 *
	 * Asked before every write as well as by the watcher. Typing writes every 50 ms, and each of
	 * those writes restarts the watcher's quiet, so an agent's write made mid-typing would be read
	 * only after the typing had already written over it.
	 */
	private absorb(doc: Open): void {
		const now = stamp(doc.file);
		if (!now || (doc.seen && now.size === doc.seen.size && now.mtime === doc.seen.mtime)) return;
		let text: string;
		try {
			text = readSource(doc.file, doc.format);
		} catch {
			// Mid-write, or gone: the next event reads it again.
			return;
		}
		doc.seen = now;
		// Our own write coming back.
		if (text === doc.text) return;
		this.flushVersion(doc);
		const from = doc.versions.record(doc.vkey, doc.text);
		const splices = spliceDiff(doc.text, text);
		const base = doc.rev;
		doc.text = text;
		doc.rev = Math.max(doc.rev + 1, Date.now());
		doc.log.push({ base, rev: doc.rev, splices });
		if (doc.log.length > LOG) doc.log.splice(0, doc.log.length - LOG);
		const to = doc.versions.record(doc.vkey, text);
		const change: DocChange = { id: randomUUID(), by: (this.context.writer?.(doc.file) ?? "outside") as DocAuthor, at: Date.now(), from, to, splices };
		doc.changes.set(change.id, { change, rev: doc.rev });
		this.saveChanges(doc);
		this.context.send({ type: "doc.changed", path: doc.key, base, rev: doc.rev, splices, by: change.by, change });
	}

	/**
	 * A write to the original of a working copy, merged into the copy as a change to review.
	 *
	 * Three ways: the original's edits since the base, and the copy's since the same base, are
	 * both splices of the base, so the original's are moved past the copy's (`transformSplices`)
	 * and land on the copy exactly, with the copy's own text kept where both touched. The original's
	 * text becomes the new base, so the same edit is never taken in twice.
	 */
	private pull(doc: Open): void {
		const library = this.context.library?.();
		if (!library || !doc.source) return;
		let theirs: string;
		try {
			theirs = readSource(doc.source.file, doc.format);
		} catch {
			// The original is gone or mid-write: the copy carries on, and the next event tries again.
			return;
		}
		const base = library.base(doc.file);
		if (base === undefined || theirs === base) return;
		this.absorb(doc);
		const moved = transformSplices(spliceDiff(base, theirs), spliceDiff(base, doc.text), false).a;
		library.setBase(doc.file, theirs);
		if (moved.length === 0) return;
		let text = doc.text;
		for (const splice of moved) {
			if (text.slice(splice.at, splice.at + splice.before.length) !== splice.before) {
				this.context.send({ type: "notice", level: "warn", text: `${basename(doc.source.file)} changed in a way that could not be merged into its copy; its text is kept as a version.` });
				doc.versions.record(doc.vkey, theirs);
				return;
			}
			text = applySplice(text, splice);
		}
		this.flushVersion(doc);
		const from = doc.versions.record(doc.vkey, doc.text);
		const rev = doc.rev;
		this.commit(doc, text, moved);
		const to = doc.versions.record(doc.vkey, text);
		const change: DocChange = { id: randomUUID(), by: (this.context.writer?.(doc.source.file) ?? "outside") as DocAuthor, at: Date.now(), from, to, splices: moved };
		doc.changes.set(change.id, { change, rev: doc.rev });
		this.saveChanges(doc);
		this.context.send({ type: "doc.changed", path: doc.key, base: rev, rev: doc.rev, splices: moved, by: change.by, change });
	}

	private saveChanges(doc: Open): void {
		const library = this.context.library?.();
		if (library?.contains(doc.file)) library.saveChanges(doc.file, [...doc.changes.values()].map((entry) => entry.change));
	}

	private writableSource(file: string): boolean {
		try {
			return this.keyOf(file).writable;
		} catch {
			return false;
		}
	}

	private dispose(doc: Open): void {
		this.flushVersion(doc);
		clearTimeout(doc.quiet);
		doc.watcher?.close();
		clearTimeout(doc.source?.quiet);
		doc.source?.watcher?.close();
		this.open.delete(doc.key);
	}
}

function stamp(file: string): { size: number; mtime: number } | undefined {
	try {
		const st = statSync(file);
		return { size: st.size, mtime: st.mtimeMs };
	} catch {
		return undefined;
	}
}

function isSplice(value: unknown): value is Splice {
	const s = value as Splice;
	return !!s && Number.isInteger(s.at) && s.at >= 0 && typeof s.before === "string" && typeof s.text === "string";
}

/** The text a page edits: the file, or a `.docx`'s `word/document.xml`. */
export function readSource(file: string, format: DocFormat): string {
	if (format === "text") return readFileSync(file, "utf8");
	const part = readEntry(readFileSync(file), DOCX_PART);
	if (!part) throw new Error(`${basename(file)} has no ${DOCX_PART}, so it is not a Word document`);
	return part.toString("utf8");
}

/** Written in place, so the inode a watcher or another program holds stays the file. */
export function writeSource(file: string, format: DocFormat, text: string): void {
	if (format === "text") {
		writeFileSync(file, text);
		return;
	}
	writeFileSync(file, replaceEntry(readFileSync(file), DOCX_PART, Buffer.from(text, "utf8")));
}
