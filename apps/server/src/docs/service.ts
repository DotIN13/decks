import { randomUUID } from "node:crypto";
import { readFileSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { basename, dirname, extname, relative } from "node:path";
import type { DocChange, DocFormat, ServerMessage, Splice } from "@decks/protocol";
import type { Revisions } from "../boards/snapshots.ts";
import { containedIn, resolveFileRequest, type ResolvedRoots } from "../deck/roots.ts";
import { invert, land, spliceDiff } from "./splice.ts";
import { readEntry, replaceEntry } from "./zip.ts";

/**
 * Documents open as pages: the server side of `@decks/protocol`'s `docs.ts`.
 *
 * **The file on disk is written within a frame of every keystroke**, because a page sends its
 * splices at most every 50 ms and each batch is written as it lands. The time machine is the
 * version store boards already use (`boards/snapshots.ts`): a version is kept when typing pauses
 * for a second, and on both sides of every write from outside, so going back steps over
 * sentences rather than letters.
 *
 * **An agent edits a document with its own tools**, not through this. Its write reaches the file,
 * the watcher here sees it, and the difference goes to every page as splices marked as a change
 * to accept or reject. Rejecting is the reverse splices, landed like anyone's typing.
 */

/** Typing that stops for this long becomes a version. */
export const PAUSE_MS = 1000;
/** A write from outside is read after this much quiet, as the deck watcher waits. */
export const QUIET_MS = 80;
/** How many revisions of splices are kept, to move a late batch past what landed before it. */
const LOG = 200;

const EDITABLE = new Set([".md", ".markdown", ".txt", ".tex", ".bib", ".sty", ".cls", ".rst", ".org", ".docx"]);
const DOCX_PART = "word/document.xml";

interface Open {
	key: string;
	file: string;
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

export interface DocContext {
	roots(): ResolvedRoots;
	revisions: Revisions;
	/** To every browser. */
	send(message: ServerMessage): void;
	/** Who most likely wrote the file just now, when the server can say. */
	writer?(file: string): string | undefined;
}

export class DocService {
	private readonly open = new Map<string, Open>();

	constructor(private readonly context: DocContext) {}

	/** Open a document for a page, or join the pages already on it. */
	opened(path: string, client: string): Extract<ServerMessage, { type: "doc.state" }> {
		let doc: Open;
		try {
			doc = this.load(path);
		} catch (error) {
			return { type: "doc.state", path, rev: 0, format: "text", text: "", changes: [], error: (error as Error).message };
		}
		doc.clients.add(client);
		return {
			type: "doc.state",
			path,
			rev: doc.rev,
			format: doc.format,
			text: doc.text,
			changes: [...doc.changes.values()].map((entry) => entry.change),
			...(doc.writable ? {} : { error: `${path} is in a root that is not writable, so it opens read-only.` }),
		};
	}

	closed(path: string, client: string): void {
		const doc = this.find(path);
		if (!doc) return;
		doc.clients.delete(client);
		if (doc.clients.size === 0) this.dispose(doc);
	}

	/** Land a page's batch, write the file, and tell every page. */
	patch(path: string, client: string, rev: number, batch: string, splices: Splice[]): Extract<ServerMessage, { type: "doc.patched" }> {
		const doc = this.find(path);
		const all = splices.map((_, index) => index);
		if (!doc || !doc.writable || !Array.isArray(splices)) return { type: "doc.patched", path, batch, rev: doc?.rev ?? 0, refused: all };
		// A revision from the future is a page from before a restart: it reopens.
		if (rev > doc.rev) return { type: "doc.patched", path, batch, rev: doc.rev, refused: all };
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
			this.context.send({ type: "doc.changed", path: doc.key, base, rev: doc.rev, splices: landed.applied, client, batch });
		}
		return { type: "doc.patched", path, batch, rev: doc.rev, refused: landed.refused };
	}

	/** Keep a change from outside, or take it back with its reverse splices. */
	review(path: string, change: string, accept: boolean): void {
		const doc = this.find(path);
		const entry = doc?.changes.get(change);
		if (!doc || !entry) return;
		doc.changes.delete(change);
		if (accept) {
			this.context.send({ type: "doc.changed", path: doc.key, base: doc.rev, rev: doc.rev, splices: [], settled: change });
			return;
		}
		this.absorb(doc);
		this.flushVersion(doc);
		const landed = land(doc.text, invert(entry.change.splices), this.since(doc, entry.rev));
		const base = doc.rev;
		if (landed.applied.length > 0) {
			this.commit(doc, landed.text, landed.applied);
			this.context.revisions.record(doc.key, doc.text);
		}
		this.context.send({ type: "doc.changed", path: doc.key, base, rev: doc.rev, splices: landed.applied, settled: change });
		if (landed.refused.length > 0) {
			this.context.send({ type: "notice", level: "warn", text: `Part of that change was typed over since, so ${landed.refused.length} of its pieces were left as they are.` });
		}
	}

	versions(path: string): Extract<ServerMessage, { type: "doc.versions" }> {
		const doc = this.find(path);
		const key = doc?.key ?? this.keyOf(path).key;
		return { type: "doc.versions", path, versions: [...this.context.revisions.entries(key)] };
	}

	/** Put one kept version back, as one edit every page applies. */
	restore(path: string, sha: string): void {
		const doc = this.find(path);
		if (!doc || !doc.writable) return;
		this.absorb(doc);
		const target = this.context.revisions.read(sha);
		const splices = spliceDiff(doc.text, target);
		if (splices.length === 0) return;
		this.flushVersion(doc);
		const base = doc.rev;
		this.commit(doc, target, splices);
		this.context.revisions.record(doc.key, target);
		this.context.send({ type: "doc.changed", path: doc.key, base, rev: doc.rev, splices });
	}

	/** Every open document closed, for a deck switch or a shutdown. */
	closeAll(): void {
		for (const doc of [...this.open.values()]) this.dispose(doc);
	}

	// -- inside --------------------------------------------------------------------------------

	private keyOf(path: string): { file: string; key: string; writable: boolean } {
		const roots = this.context.roots();
		const file = resolveFileRequest(roots, { path });
		if (containedIn(roots.deck, file)) {
			const key = relative(roots.deck, file).split("\\").join("/");
			if (key.startsWith(".decks/")) throw new Error(`${path} is the app's own record, not a document`);
			return { file, key, writable: true };
		}
		const root = roots.roots.find((r) => r.exists && containedIn(r.path, file));
		return { file, key: file, writable: !!root?.writable };
	}

	private find(path: string): Open | undefined {
		try {
			return this.open.get(this.keyOf(path).key);
		} catch {
			return undefined;
		}
	}

	private load(path: string): Open {
		const { file, key, writable } = this.keyOf(path);
		const known = this.open.get(key);
		if (known) return known;
		const ext = extname(file).toLowerCase();
		if (!EDITABLE.has(ext)) throw new Error(`${basename(file)} is not a document this page edits (${[...EDITABLE].join(" ")})`);
		const format: DocFormat = ext === ".docx" ? "docx" : "text";
		const text = readSource(file, format);
		const doc: Open = {
			key,
			file,
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
		this.context.revisions.record(key, text);
		this.watch(doc);
		this.open.set(key, doc);
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
		doc.pause = setTimeout(() => this.flushVersion(doc), PAUSE_MS);
	}

	/** The typing so far as a version, now rather than at the pause. */
	private flushVersion(doc: Open): void {
		clearTimeout(doc.pause);
		doc.pause = undefined;
		if (!doc.unversioned) return;
		doc.unversioned = false;
		this.context.revisions.record(doc.key, doc.text);
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
				}, QUIET_MS);
			});
			// A watcher never keeps the process alive on its own: the server's socket does that.
			doc.watcher.unref();
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
		const from = this.context.revisions.record(doc.key, doc.text);
		const splices = spliceDiff(doc.text, text);
		const base = doc.rev;
		doc.text = text;
		doc.rev = Math.max(doc.rev + 1, Date.now());
		doc.log.push({ base, rev: doc.rev, splices });
		if (doc.log.length > LOG) doc.log.splice(0, doc.log.length - LOG);
		const to = this.context.revisions.record(doc.key, text);
		const change: DocChange = { id: randomUUID(), by: this.context.writer?.(doc.file) ?? "file", at: Date.now(), from, to, splices };
		doc.changes.set(change.id, { change, rev: doc.rev });
		this.context.send({ type: "doc.changed", path: doc.key, base, rev: doc.rev, splices, change });
	}

	private dispose(doc: Open): void {
		this.flushVersion(doc);
		clearTimeout(doc.quiet);
		doc.watcher?.close();
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
