import { events, Refused, type Caller } from "../../protocol/index.ts";
import type { Deck, DeckPath, Events, Store } from "../kernel/types.ts";
import { remoteOf } from "./links.ts";
import { Queues } from "./queue.ts";
import { loadChanges, saveChanges, skip, type DocChange, type Waiting } from "./records.ts";
import { applyAll, diff, invert, land, type Splice } from "./splice.ts";

// Documents pages have open: typing landed as splices, writes from outside
// turned into changes to review, pauses turned into versions. Rules 2 to 7.

export const EDITABLE = [".md", ".markdown", ".txt", ".tex", ".bib", ".rst", ".org"];
export const PAUSE_MS = 1000;
const LOG = 200;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type DocState = { path: string; rev: number; format: "text"; text: string; changes: DocChange[]; remote?: { url: string; title?: string } };
type Open = {
	path: DeckPath;
	text: string;
	rev: number;
	log: { base: number; rev: number; splices: Splice[] }[];
	changes: Map<string, Waiting>;
	clients: Set<string>;
	pause?: ReturnType<typeof setTimeout>;
	typed?: number;
};
type Sent = { by: string; splices: Splice[]; base: number; client?: string; batch?: string; change?: string; record?: DocChange; settled?: boolean };

export class Documents {
	private open = new Map<string, Open>();
	private queues = new Queues();
	private stopWatch: () => void;

	constructor(
		private deck: Deck,
		private events: Events,
		private store: Store,
		private pauseMs = PAUSE_MS,
	) {
		this.stopWatch = deck.watch((change) => {
			const doc = this.open.get(change.path);
			if (change.kind === "written" && doc) void this.queue(change.path, () => this.absorb(doc, { by: change.by, rev: change.rev, at: change.at }));
		});
	}

	/** One thing at a time per document, in order. */
	private queue<T>(path: string, run: () => Promise<T>): Promise<T> {
		return this.queues.run(path, run);
	}

	/** Whether a page has this document open. */
	isOpen(path: string): boolean {
		return (this.open.get(path)?.clients.size ?? 0) > 0;
	}

	stop(): void {
		this.stopWatch();
		for (const doc of this.open.values()) clearTimeout(doc.pause);
		this.open.clear();
	}

	openDoc(path: DeckPath, client: string): Promise<DocState> {
		return this.queue(path, async () => {
			const doc = this.open.get(path) ?? (await this.load(path));
			await this.absorb(doc);
			doc.clients.add(client);
			const remote = await remoteOf(this.store, path);
			return { ...stateOf(doc), ...(remote ? { remote } : {}) };
		});
	}

	closeDoc(path: DeckPath, client: string): Promise<DocState> {
		return this.queue(path, async () => {
			const doc = this.open.get(path) ?? (await this.load(path));
			doc.clients.delete(client);
			const state = stateOf(doc);
			if (doc.clients.size === 0) this.drop(doc);
			return state;
		});
	}

	splice(path: DeckPath, args: { client: string; rev: number; batch: string; splices: Splice[] }, by: Caller): Promise<{ path: string; rev: number; refused: number[]; text?: string }> {
		return this.queue(path, async () => {
			const doc = this.mustBeOpen(path);
			await this.absorb(doc);
			const all = args.splices.map((_, i) => i);
			if (args.rev > doc.rev) return { path, rev: doc.rev, refused: all, text: doc.text };
			const landed = land(doc.text, args.splices, this.since(doc, args.rev));
			if (landed.applied.length > 0) {
				const base = doc.rev;
				await this.commit(doc, landed.text, landed.applied, by);
				await this.typed(doc);
				this.tell(doc, { by: by.id, splices: landed.applied, base, client: args.client, batch: args.batch });
			}
			return { path, rev: doc.rev, refused: landed.refused, ...(landed.refused.length ? { text: doc.text } : {}) };
		});
	}

	review(path: DeckPath, change: string, accept: boolean, by: Caller): Promise<DocState> {
		return this.queue(path, async () => {
			const doc = this.mustBeOpen(path);
			await this.absorb(doc);
			const ids = change === "*" ? [...doc.changes.keys()].reverse() : doc.changes.has(change) ? [change] : [];
			if (ids.length === 0) throw new Refused("not_found", `No change ${change} waits for review in ${path}.`, "file.open");
			this.flush(doc);
			for (const id of ids) {
				const entry = doc.changes.get(id)!;
				doc.changes.delete(id);
				if (accept) {
					this.tell(doc, { by: by.id, splices: [], base: doc.rev, change: id, settled: true });
					continue;
				}
				const back = invert(entry.change.splices);
				const since = this.since(doc, entry.rev) ?? (applyAll(doc.text, back) === undefined ? undefined : []);
				const landed = land(doc.text, back, since);
				const base = doc.rev;
				if (landed.applied.length) await this.commit(doc, landed.text, landed.applied, by);
				this.tell(doc, { by: by.id, splices: landed.applied, base, change: id, settled: true });
			}
			await saveChanges(this.store, path, doc.changes.values());
			return stateOf(doc);
		});
	}

	/** Put a version back as one edit by the caller; with no page open, a plain write. */
	restore(path: DeckPath, text: string, by: Caller): Promise<{ path: string; rev: number; size: number; by: string; at: number }> {
		return this.queue(path, async () => {
			const doc = this.open.get(path);
			if (!doc) {
				const rev = await this.deck.write(path, encoder.encode(text), by);
				return { path, rev: rev.rev, size: encoder.encode(text).length, by: by.id, at: rev.at };
			}
			await this.absorb(doc);
			this.flush(doc);
			const splices = diff(doc.text, text);
			const base = doc.rev;
			if (splices.length) await this.commit(doc, text, splices, by);
			this.tell(doc, { by: by.id, splices, base });
			return { path, rev: doc.rev, size: encoder.encode(text).length, by: by.id, at: Date.now() };
		});
	}

	private async load(path: DeckPath): Promise<Open> {
		const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
		if (ext === ".docx") throw new Refused("unavailable", "Word documents do not open as pages on this server yet.", "file.read");
		if (!EDITABLE.includes(ext)) throw new Refused("invalid", `${path} is not a document: one of ${EDITABLE.join(" ")} opens as a page.`, "file.read");
		const entry = (await this.deck.list(parent(path))).find((e) => e.path === path);
		if (!entry || entry.kind !== "file") throw new Refused("not_found", `There is no document at ${path}.`, "file.list");
		const doc: Open = { path, text: decoder.decode(await this.deck.read(path)), rev: (await this.deck.revisions?.(path))?.at(-1)?.rev ?? entry.rev ?? 0, log: [], changes: new Map(), clients: new Set() };
		for (const waiting of await loadChanges(this.store, path)) doc.changes.set(waiting.change.id, waiting);
		this.open.set(path, doc);
		return doc;
	}

	private mustBeOpen(path: DeckPath): Open {
		const doc = this.open.get(path);
		if (!doc) throw new Refused("conflict", `${path} is not open: file.open joins it first.`, "file.open");
		return doc;
	}

	private since(doc: Open, rev: number): Splice[] | undefined {
		if (rev === doc.rev) return [];
		const first = doc.log.findIndex((entry) => entry.base === rev);
		return first === -1 ? undefined : doc.log.slice(first).flatMap((entry) => entry.splices);
	}

	/** Write the document's new text through the deck, by the caller. */
	private async commit(doc: Open, text: string, splices: Splice[], by: Caller): Promise<void> {
		const base = doc.rev;
		doc.text = text;
		doc.rev = (await this.deck.write(doc.path, encoder.encode(text), by)).rev;
		doc.log.push({ base, rev: doc.rev, splices });
		if (doc.log.length > LOG) doc.log.splice(0, doc.log.length - LOG);
	}

	/** A keystroke's revision; the one before it is not a version unless typing paused. Rule 5. */
	private async typed(doc: Open): Promise<void> {
		if (doc.typed !== undefined) await skip(this.store, doc.path, doc.typed);
		doc.typed = doc.rev;
		clearTimeout(doc.pause);
		doc.pause = setTimeout(() => this.flush(doc), this.pauseMs);
		doc.pause.unref?.();
	}

	private flush(doc: Open): void {
		clearTimeout(doc.pause);
		doc.pause = undefined;
		doc.typed = undefined;
	}

	/** A write that did not come through the page becomes a change to review. Rule 6. */
	private async absorb(doc: Open, heard?: { by: string; rev: number; at: number }): Promise<void> {
		let text: string;
		try {
			text = decoder.decode(await this.deck.read(doc.path));
		} catch {
			return;
		}
		if (text === doc.text) return;
		this.flush(doc);
		const last = heard ?? (await this.deck.revisions?.(doc.path))?.at(-1);
		const rev = last?.rev ?? doc.rev + 1;
		const splices = diff(doc.text, text);
		const change: DocChange = { id: `c${rev}`, by: last?.by ?? "outside", at: last?.at ?? Date.now(), from: String(doc.rev), to: String(rev), splices };
		const base = doc.rev;
		doc.log.push({ base, rev, splices });
		doc.text = text;
		doc.rev = rev;
		doc.changes.set(change.id, { change, rev });
		await saveChanges(this.store, doc.path, doc.changes.values());
		this.tell(doc, { by: change.by, splices, base, change: change.id, record: change });
	}

	private tell(doc: Open, sent: Sent): void {
		this.events.emit(events.fileChanged, { ids: [doc.path], rev: doc.rev, part: sent.settled && !sent.splices.length ? "review" : "words", ...sent });
	}

	private drop(doc: Open): void {
		this.flush(doc);
		this.open.delete(doc.path);
	}
}

const stateOf = (doc: Open): DocState => ({ path: doc.path, rev: doc.rev, format: "text", text: doc.text, changes: [...doc.changes.values()].map((w) => w.change) });
const parent = (path: DeckPath): DeckPath | "" => (path.includes("/") ? (path.slice(0, path.lastIndexOf("/")) as DeckPath) : "");
