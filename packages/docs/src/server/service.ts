import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { basename, dirname, extname, join, posix } from "node:path";

const posixJoin = posix.join;
import { applySplice, type CompileResult, type DocRemote, type GitResult, type GitStatus, type DocAuthor, type DocChange, type DocClientMessage, type DocFormat, type DocServerMessage, type Splice } from "../index.ts";
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
 * the watcher here sees it, and the difference goes to every page as splices marked as a change,
 * which the page highlights until a person accepts it or rejects it. Rejecting is the reverse
 * splices, landed like anyone's typing.
 *
 * **The file is edited where it is.** A paper in its repository stays there and is written in
 * place; what is kept about it (its versions, the changes waiting for review, its PDF) goes in a
 * folder of its own in the library (`library.ts`), so the repository gets no new files.
 */

/** How many writes from outside wait for review at most; the oldest is taken as accepted past it. */
const KEEP_CHANGES = 200;

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
	/** The library folder its records are kept in, when there is a library. */
	folder?: string;
	format: DocFormat;
	text: string;
	rev: number;
	/** Each landed batch: the revision it was made on, the one it made, and its splices. */
	log: Array<{ base: number; rev: number; splices: Splice[] }>;
	/** Writes from outside waiting to be accepted or rejected. */
	changes: Map<string, { change: DocChange; rev: number }>;
	clients: Set<string>;
	watcher?: FSWatcher;
	quiet?: ReturnType<typeof setTimeout>;
	pause?: ReturnType<typeof setTimeout>;
	/** Typing has moved the text past the last kept version. */
	unversioned: boolean;
	writable: boolean;
	/** The git pull or push running now, which the next one waits for. */
	syncing?: Promise<unknown>;
	/** Who a write from outside is credited to while a pull runs: the remote, not the watcher's guess. */
	pulling?: DocAuthor;
	/** The typesetting running now, which the next one waits for. */
	compiling?: Promise<unknown>;
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
	 * Where each document's records are kept (`library.ts`): its versions, the changes waiting for
	 * review, and its PDF. Without one, versions go to `versions` and nothing else is kept.
	 */
	library?: () => DocLibrary | undefined;
	/** To every page. */
	send(message: DocServerMessage): void;
	/** Who most likely wrote the file just now, when the host can tell (an agent's name). */
	writer?(file: string): string | undefined;
	/**
	 * Typeset a LaTeX file: `file` is the document, `inputs` the folder its pictures and
	 * bibliographies are found in (its own), `out` where the PDF goes (its record folder). Without it, a page
	 * asking for a PDF is told there is no typesetter.
	 */
	compile?(job: { file: string; inputs: string; out: string }): Promise<CompileResult>;
	/**
	 * The git repository a file is in, for syncing with a remote such as Overleaf (`apps/server`'s
	 * `docs/git.ts`). `status` is `undefined` for a file in no repository. `pull` commits what is
	 * not committed and merges the remote's commits; `push` does that and sends them. Each writes
	 * the file only through git, and what that changed in an open document becomes a change to review.
	 */
	git?: {
		status(file: string): Promise<GitStatus | undefined>;
		pull(file: string): Promise<GitResult>;
		push(file: string): Promise<GitResult>;
	};
	/** A page has opened a file (after its `doc.state` is on its way): for a host that has more to tell it. */
	opened?(file: string): void;
	/** Styles a page set on a Google Doc's mirror, as Docs requests at its indices, for the host to send to Google. */
	style?(file: string, requests: unknown[], text?: string): Promise<void>;
	/** A comment a page made on a Google Doc's mirror, for the host to send to Google. */
	comment?(file: string, message: { action: "create" | "reply" | "resolve"; comment?: string; content?: string; quote?: string }): Promise<void>;
	/** What stands behind a file, for the page to show: a Google Doc's address and title. */
	remote?(file: string): DocRemote | undefined;
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
				case "doc.version":
					return reply(this.version(message.path, message.sha));
				case "doc.compile":
					return void this.compile(message.path).then(reply, (error: Error) => reply({ type: "doc.compiled", path: message.path, ok: false, errors: [], at: Date.now(), ms: 0, error: error.message }));
				case "doc.restore":
					return this.restore(message.path, message.sha);
				case "doc.gstyle": {
					// Styles for a Google Doc: the typing before them has landed, since this page waited for it.
					const doc = this.find(message.path);
					if (doc && this.context.style) void this.context.style(doc.file, message.requests, typeof message.text === "string" ? message.text : undefined).catch((error: Error) => reply({ type: "notice", level: "warn", text: error.message }));
					return;
				}
				case "doc.gcomment": {
					const doc = this.find(message.path);
					if (doc && this.context.comment) void this.context.comment(doc.file, message).catch((error: Error) => reply({ type: "notice", level: "warn", text: error.message }));
					return;
				}
				case "doc.git":
					return void this.git(message.path, message.action).then(reply, (error: Error) => reply({ type: "doc.repo", path: message.path, action: message.action, ok: false, message: error.message }));
			}
		} catch (error) {
			reply({ type: "notice", level: "warn", text: (error as Error).message });
		}
	}

	/**
	 * Open a document for a page, or join the pages already on it. The answer names the document
	 * as `path` and what the page sent as `asked`, which differ for a page naming a copy from
	 * before documents were edited in place: it opens the file the copy was made from.
	 */
	opened(path: string, client: string): Extract<DocServerMessage, { type: "doc.state" }> {
		let doc: Open;
		try {
			doc = this.load(this.adopt(path));
		} catch (error) {
			return { type: "doc.state", path, asked: path, client, rev: 0, format: "text", text: "", changes: [], error: (error as Error).message };
		}
		doc.clients.add(client);
		if (this.context.opened) setTimeout(() => this.context.opened?.(doc.file), 0);
		return {
			type: "doc.state",
			path: doc.key,
			asked: path,
			client,
			rev: doc.rev,
			format: doc.format,
			text: doc.text,
			changes: [...doc.changes.values()].map((entry) => entry.change),
			...((remote) => (remote ? { remote } : {}))(this.context.remote?.(doc.file)),
			...(doc.writable ? {} : { error: `${path} opens read-only: it is not somewhere this server may write.` }),
		};
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

	/**
	 * Keep a change from outside, or take it back with its reverse splices; `"*"` is every change
	 * waiting, rejected newest first so each one's words are still where it left them.
	 */
	review(path: string, change: string, accept: boolean): void {
		const doc = this.find(path);
		if (!doc) return;
		const ids = change === "*" ? [...doc.changes.keys()].reverse() : doc.changes.has(change) ? [change] : [];
		if (ids.length === 0) return;
		if (accept) {
			for (const id of ids) doc.changes.delete(id);
			this.saveChanges(doc);
			this.context.send({ type: "doc.changed", path: doc.key, base: doc.rev, rev: doc.rev, splices: [], by: "person", settled: ids });
			return;
		}
		this.absorb(doc);
		this.flushVersion(doc);
		let refused = 0;
		for (const id of ids) {
			const entry = doc.changes.get(id)!;
			doc.changes.delete(id);
			const back = invert(entry.change.splices);
			let since = this.since(doc, entry.rev);
			// History from before a restart is gone; the words are often still exactly where the change left them.
			if (!since && fits(doc.text, back)) since = [];
			const landed = land(doc.text, back, since);
			const base = doc.rev;
			if (landed.applied.length > 0) this.commit(doc, landed.text, landed.applied);
			refused += landed.refused.length;
			this.context.send({ type: "doc.changed", path: doc.key, base, rev: doc.rev, splices: landed.applied, by: "person", settled: [id] });
		}
		this.saveChanges(doc);
		doc.versions.record(doc.vkey, doc.text);
		if (refused > 0) this.context.send({ type: "notice", level: "warn", text: `Part of that was typed over since, so ${refused} of its pieces were left as they are.` });
	}

	/** One kept version's text, for a page to show. */
	version(path: string, sha: string): Extract<DocServerMessage, { type: "doc.version" }> {
		const open = this.find(path);
		const doc = open ?? this.load(this.adopt(path));
		try {
			const at = [...doc.versions.entries(doc.vkey)].find((v) => v.sha === sha)?.at;
			return { type: "doc.version", path, sha, text: doc.versions.read(sha), ...(at ? { at } : {}) };
		} catch (error) {
			return { type: "doc.version", path, sha, error: (error as Error).message };
		} finally {
			if (!open) this.dispose(doc);
		}
	}

	/**
	 * Typeset a document as it stands. One typesetting at a time per document: asked again while
	 * one runs, the next waits for it and then typesets the text as it is by then, so a burst of
	 * typing costs at most one run behind.
	 */
	async compile(path: string): Promise<Extract<DocServerMessage, { type: "doc.compiled" }>> {
		const started = Date.now();
		const answer = (fields: Partial<Extract<DocServerMessage, { type: "doc.compiled" }>>) => ({ type: "doc.compiled" as const, path, ok: false, errors: [], at: Date.now(), ms: Date.now() - started, ...fields });
		const doc = this.find(path);
		if (!doc) return answer({ error: `${path} is not open.` });
		if (!this.context.compile) return answer({ error: "This server has no LaTeX typesetter." });
		if (!/\.(tex|ltx)$/i.test(doc.file)) return answer({ error: "Only a LaTeX file typesets to a PDF." });
		const run = async () => {
			this.absorb(doc);
			const library = this.context.library?.();
			const out = join(doc.folder ?? dirname(doc.file), "build");
			mkdirSync(out, { recursive: true });
			const result = await this.context.compile!({ file: doc.file, inputs: dirname(doc.file), out });
			const at = doc.folder && library ? posixJoin(library.path, library.name(doc.folder)) : dirname(doc.key);
			const pdf = result.pdf ? posixJoin(at, "build", basename(result.pdf)) : undefined;
			return answer({ ok: result.ok, errors: result.errors, ...(pdf ? { pdf } : {}), ...(result.error ? { error: result.error } : {}) });
		};
		const previous = doc.compiling ?? Promise.resolve(undefined);
		const next = previous.then(run, run);
		doc.compiling = next.then(() => undefined);
		return next;
	}

	/**
	 * The document's repository, or a pull or push of it. Everything typed is in the file first,
	 * and what the pull wrote is taken in at once as a change credited to the remote, so a
	 * collaborator's edit on Overleaf is highlighted like an agent's. One at a time per document.
	 */
	async git(path: string, action: "status" | "pull" | "push"): Promise<Extract<DocServerMessage, { type: "doc.repo" }>> {
		const doc = this.find(path);
		const answer = (fields: Partial<Extract<DocServerMessage, { type: "doc.repo" }>>) => ({ type: "doc.repo" as const, path, action, ok: false, ...fields });
		const host = this.context.git;
		if (!doc) return answer({ message: `${path} is not open.` });
		if (!host) return answer({ message: "This server does not sync with git." });
		if (action === "status") {
			const status = await host.status(doc.file);
			return answer({ ok: true, ...(status ? { status } : {}) });
		}
		if (!doc.writable) return answer({ message: `${basename(doc.file)} is read-only here, so it cannot be pulled into.` });
		const run = async () => {
			this.absorb(doc);
			this.flushVersion(doc);
			const before = await host.status(doc.file);
			// What the merge writes is credited to where it came from, rather than to whoever the watcher would guess.
			doc.pulling = before?.label ?? "git pull";
			try {
				const result = await (action === "pull" ? host.pull(doc.file) : host.push(doc.file));
				if (this.open.has(doc.key)) this.absorb(doc);
					return answer({ ok: result.ok, message: result.message, ...(result.status ? { status: result.status } : {}) });
			} finally {
				doc.pulling = undefined;
			}
		};
		const previous = doc.syncing ?? Promise.resolve(undefined);
		const next = previous.then(run, run);
		doc.syncing = next.then(() => undefined);
		return next;
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

	/**
	 * The file's text set to `text` as the person's own edit, not a change to review: for a host that
	 * made the change itself on the person's behalf (a Google Doc's table row, added in Google).
	 */
	rewrite(file: string, text: string): void {
		const doc = [...this.open.values()].find((d) => d.file === file);
		if (!doc) return;
		this.absorb(doc);
		const splices = spliceDiff(doc.text, text);
		if (splices.length === 0) return;
		this.flushVersion(doc);
		const base = doc.rev;
		this.commit(doc, text, splices);
		doc.versions.record(doc.vkey, text);
		this.context.send({ type: "doc.changed", path: doc.key, base, rev: doc.rev, splices, by: "person" });
	}

	/** The files pages have open now. */
	openFiles(): string[] {
		return [...this.open.values()].filter((doc) => doc.clients.size > 0).map((doc) => doc.file);
	}

	/** What a page calls a file it has open, for a message about it. */
	keyOfFile(file: string): string | undefined {
		return [...this.open.values()].find((doc) => doc.file === file)?.key;
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
			return this.open.get(this.keyOf(this.adopt(path)).key);
		} catch {
			return undefined;
		}
	}

	/** The path to open for one a page asked for: the original, for a copy from before documents were edited in place. */
	private adopt(path: string): string {
		const library = this.context.library?.();
		if (!library) return path;
		const { file } = this.keyOf(path);
		return library.meta(file)?.source ?? path;
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
		// A file in the library is a mirror (a Google Doc's) when its folder's record names it, and keeps its records there.
		const folder = !library ? undefined : !library.contains(file) ? library.folder(file, format) : library.meta(file)?.source === file ? library.folderOf(file) : undefined;
		const doc: Open = {
			key,
			file,
			versions: folder ? library!.versions(folder) : this.context.versions,
			vkey: folder ? basename(file) : key,
			...(folder ? { folder } : {}),
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
		// Recent writes from outside, so a page opened later still sees what an agent just did.
		for (const change of folder ? library!.changes(folder) : []) doc.changes.set(change.id, { change, rev: doc.rev });
		doc.versions.record(doc.vkey, text);
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
		} catch {
			// No watching on this platform: a write from outside shows when the page opens it again.
		}
	}

	/**
	 * A write from outside, if there was one: the difference becomes a change pages highlight.
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
		const change: DocChange = { id: randomUUID(), by: doc.pulling ?? ((this.context.writer?.(doc.file) ?? "outside") as DocAuthor), at: Date.now(), from, to, splices };
		doc.changes.set(change.id, { change, rev: doc.rev });
		this.saveChanges(doc);
		this.context.send({ type: "doc.changed", path: doc.key, base, rev: doc.rev, splices, by: change.by, change });
	}


	private saveChanges(doc: Open): void {
		while (doc.changes.size > KEEP_CHANGES) doc.changes.delete(doc.changes.keys().next().value!);
		if (doc.folder) this.context.library?.()?.saveChanges(doc.folder, [...doc.changes.values()].map((entry) => entry.change));
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


/** Sequential splices that each find their old text exactly where they say. */
function fits(text: string, splices: readonly Splice[]): boolean {
	let out = text;
	for (const s of splices) {
		if (out.slice(s.at, s.at + s.before.length) !== s.before) return false;
		out = applySplice(out, s);
	}
	return true;
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
