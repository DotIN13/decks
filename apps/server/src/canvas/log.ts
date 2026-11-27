import type { ChangeAuthor } from "@decks/protocol";
import { watch } from "node:fs";
import { emptyDocument, ids, PenError, read, serialize, type PenDocument, type PenEdit, diff } from "@decks/pen";
import type { ServerMessage } from "@decks/protocol";
import { fileUrl } from "../deck/roots.ts";
import { penEditBy, penOrigin, penWriter, type PenEntry, type CanvasPens } from "./pens.ts";

/**
 * What was written to each canvas, and by whom.
 *
 * Every write of a drawing is one record: its revision, its author (the person, an agent, or
 * Studio bringing another harness's change down), and the edits that made it. Three readers use
 * them. An agent is told what others changed on its canvases since its last message. The person's
 * own edits can be taken back and put back, until someone else has drawn since. And a page is sent
 * what changed since the revision it has, as edits when the log holds them all, else the drawing whole.
 */

/** Who wrote a canvas: the person (an edit from a page), an agent (its own call), or the file itself. */
export type Author = { kind: "person" } | { kind: "agent"; id: string } | { kind: "file" } | { kind: "studio"; id: string };

/**
 * One write of a canvas: its revision, its author, the items it touched, and the edits that made it
 * from the revision before (`@decks/pen`'s `diff`), with the names the browser gave its own among them
 * (`made`). The edits are what a browser or another harness holding the revision before is sent.
 */
export interface ChangeRecord {
	rev: number;
	by: Author;
	ids: string[];
	edits: PenEdit[];
	made?: string[];
}

/** A canvas's drawing whole, as a reader over HTTP is given it (`CanvasLog.frame`). */
export interface CanvasFrame {
	canvas: string;
	rev: number;
	doc: PenDocument;
	base: string;
	/** The file on disk does not parse, and `doc` is the last good version. */
	error?: string;
	made?: string[];
	by?: string;
}

/** How many writes of each canvas are kept for the agents' notes (`changesSince`). */
const CHANGE_LOG = 400;
/** How many of a canvas's recent names a drawing sent whole carries. */
const MADE_LATELY = 64;
/** How many of the person's edits each canvas can take back. */
const HISTORY = 100;

export class CanvasLog {
	constructor(private readonly of: CanvasPens) {}

	/**
	 * The store wrote a drawing. Whose write it was is read from what surrounds the call: Studio's
	 * (`penOrigin`), an agent's call (`penWriter`), or else the person's, from a page; and the
	 * person's own name for the edit (`penEditBy`) is kept to send back with the revision that has it.
	 */
	written(name: string, before: PenDocument | undefined, after: PenDocument, rev: number): void {
		const by = penEditBy.getStore();
		if (by) this.made.set(name, [...(this.made.get(name) ?? []), by]);
		const writer = penWriter.getStore();
		this.record(name, before, after, rev, penOrigin.getStore() ?? (writer ? { kind: "agent", id: writer } : { kind: "person" }), by ? [by] : undefined);
		if (writer) this.writers.set(name, writer);
	}

	/** The file changed under the store: pen.dev's save, an agent's own tools, the sync from Studio. */
	fileChanged(name: string, before: PenDocument | undefined, after: PenDocument, rev: number): void {
		this.record(name, before, after, rev, { kind: "file" });
	}

	/** One of the person's own edits, which they can take back: the drawing's text before and after it. */
	undoable(name: string, before: string, after: string): void {
		const history = this.historyOf(name);
		history.undo.push({ before, after });
		if (history.undo.length > HISTORY) history.undo.shift();
		history.redo = [];
	}

	/** A canvas's folder was renamed: what the person can take back follows it. */
	moved(from: string, to: string): void {
		const history = this.history.get(from);
		this.history.delete(from);
		if (history) this.history.set(to, history);
	}

	/** A canvas was deleted. */
	forget(name: string): void {
		this.history.delete(name);
	}

	private readonly history = new Map<string, { undo: Array<{ before: string; after: string }>; redo: Array<{ before: string; after: string }> }>();

	/** The browsers' names for the edits written to each canvas since its drawing was last sent (`penEditBy`). */
	private readonly made = new Map<string, string[]>();

	/** The agent that last wrote each canvas (`penWriter`), since this server started. */
	private readonly writers = new Map<string, string>();

	/**
	 * Each canvas's recent writes, who made them and the items they touched (`agents/canvas-news.ts`): what
	 * an agent is told changed since its last message, and by whom. And the canvases each agent wrote since
	 * it last asked, so it hears about those as well as its home canvas.
	 */
	private readonly changeLogs = new Map<string, ChangeRecord[]>();

	private readonly writtenBy = new Map<string, Set<string>>();

	/**
	 * Hears every write of a canvas as it is logged: its revision, the edits that made it and who made
	 * it (`app.ts` forwards them to Studio for a canvas kept there).
	 */
	wrote?: (name: string, change: ChangeRecord) => void;

	/**
	 * A write of a canvas, kept for whoever is told about it next: the edits from the revision before
	 * (worked out once here, for the log, the browsers and Studio alike), with the names the browsers
	 * gave the edits of theirs this revision is the first to have.
	 */
	private record(name: string, before: PenDocument | undefined, after: PenDocument, rev: number, by: Author, made?: string[]): ChangeRecord {
		// A canvas's first write is from nothing.
		const edits = diff(before ?? emptyDocument(), after);
		const ids = [...new Set(edits.flatMap((edit) => ("id" in edit ? [edit.id] : [])))];
		const record: ChangeRecord = { rev, by, ids, edits, ...(made?.length ? { made } : {}) };
		const log = this.changeLogs.get(name) ?? [];
		log.push(record);
		if (log.length > CHANGE_LOG) log.splice(0, log.length - CHANGE_LOG);
		this.changeLogs.set(name, log);
		if (ids.length && by.kind === "agent") {
			const set = this.writtenBy.get(by.id) ?? new Set<string>();
			set.add(name);
			this.writtenBy.set(by.id, set);
		}
		if (edits.length) this.wrote?.(name, record);
		return record;
	}

	/** The writes of a canvas after revision `rev`, oldest first. */
	changesSince(name: string, rev: number): ChangeRecord[] {
		return (this.changeLogs.get(name) ?? []).filter((record) => record.rev > rev);
	}

	/**
	 * The edits that take a canvas from revision `from` to `to` (the current one when left out), from
	 * the log: one list, the revisions' edits in order, with the browsers' names for theirs. `undefined`
	 * when the log does not hold every revision between (one came before this server started, or more
	 * than `CHANGE_LOG` writes ago): the drawing is read whole then.
	 */
	editsSince(name: string, from: number, to = this.of.get(name).rev): { from: number; rev: number; edits: PenEdit[]; made: string[] } | undefined {
		if (to < from) return undefined;
		const records = (this.changeLogs.get(name) ?? []).filter((record) => record.rev > from && record.rev <= to);
		if (records.length !== to - from) return undefined;
		for (let i = 0; i < records.length; i += 1) if (records[i]!.rev !== from + i + 1) return undefined;
		return { from, rev: to, edits: records.flatMap((record) => record.edits), made: records.flatMap((record) => record.made ?? []) };
	}

	/** The canvases this agent wrote since it last asked. */
	takeWritten(agentId: string): string[] {
		const set = this.writtenBy.get(agentId);
		this.writtenBy.delete(agentId);
		return set ? [...set] : [];
	}

	/** The agent that last wrote a canvas, by id: what its placeholder frames are marked with. */
	writerOf(name: string): string | undefined {
		return this.writers.get(name);
	}

	/** The last names sent with each canvas's drawings, for a drawing sent whole to one browser (`frame`). */
	private readonly madeLately = new Map<string, string[]>();

	/**
	 * Take back the person's last edit, or put it back again.
	 *
	 * Only edits made by hand are kept (`undoable`), and only while nothing else has changed the
	 * file since: an agent's edit or a hand edit of the file in between would be taken back with
	 * it, so the step is refused with a sentence instead. The history is the server's memory and
	 * goes with a restart.
	 */
	step(name: string, direction: "undo" | "redo"): PenEntry {
		const history = this.historyOf(name);
		const from = direction === "undo" ? history.undo : history.redo;
		const to = direction === "undo" ? history.redo : history.undo;
		const last = from[from.length - 1];
		if (!last) throw new PenError(direction === "undo" ? "Nothing on this canvas to undo." : "Nothing to redo.");
		const current = this.of.get(name);
		const now = current.text ?? serialize(current.doc);
		const expected = direction === "undo" ? last.after : last.before;
		if (now !== expected) {
			history.undo = [];
			history.redo = [];
			throw new PenError("The drawing has changed since, by an agent or in the file, so there is nothing safe to take back.");
		}
		from.pop();
		const entry = this.of.putBack(name, direction === "undo" ? last.before : last.after);
		to.push(last);
		return entry;
	}

	/** Whether there is a step each way, for the buttons. */
	steps(name: string): { undo: boolean; redo: boolean } {
		const history = this.history.get(name);
		return { undo: !!history?.undo.length, redo: !!history?.redo.length };
	}

	private historyOf(name: string) {
		let history = this.history.get(name);
		if (!history) this.history.set(name, (history = { undo: [], redo: [] }));
		return history;
	}

	/**
	 * A canvas's drawing whole, with its imports, for a reader over HTTP (the picture page, a bundle):
	 * it says the browsers' recent names and those still to be said, and takes none, since taken they
	 * would never be said to the clients on the line, whose edits then stayed on top of the drawing.
	 */
	frame(name: string): CanvasFrame {
		const entry = this.of.get(name);
		const doc = this.of.files.withImported(name, entry.doc);
		const made = [...(this.madeLately.get(name) ?? []), ...(this.made.get(name) ?? [])];
		const by = this.writers.get(name);
		return { canvas: name, rev: entry.rev, doc, base: `${fileUrl(this.of.folderOf(name))}/`, ...(entry.error ? { error: entry.error } : {}), ...(made.length ? { made } : {}), ...(by ? { by } : {}) };
	}

	/** The browsers' edits written since the drawing was last sent, taken: the next frame or delta says it has them. */
	private takeMade(name: string): string[] {
		const made = this.made.get(name) ?? [];
		this.made.delete(name);
		if (made.length) this.madeLately.set(name, [...(this.madeLately.get(name) ?? []), ...made].slice(-MADE_LATELY));
		return made;
	}

	/** The version of each canvas last said to its clients, whole or as edits: what the next edits are from. */
	private readonly sent = new Map<string, { rev: number; doc: PenDocument }>();

	/** Who made the write that gave a canvas its current revision, from the log; nothing when the log does not say. */
	private authorOf(name: string, rev: number): ChangeAuthor | undefined {
		const record = this.changeLogs.get(name)?.findLast((one) => one.rev === rev);
		return record ? { kind: record.by.kind, ...("id" in record.by ? { id: record.by.id } : {}) } : undefined;
	}

	/** A canvas as `canvas.changed` says it whole: the drawing with its imports, for a client with no revision or one the log no longer reaches. */
	private changedWhole(name: string, entry: PenEntry, made: string[]): ServerMessage {
		const doc = this.of.files.withImported(name, entry.doc);
		const by = this.writers.get(name);
		const author = this.authorOf(name, entry.rev);
		return { type: "canvas.changed", canvas: name, rev: entry.rev, doc, base: `${fileUrl(this.of.folderOf(name))}/`, ...(entry.error ? { error: entry.error } : {}), ...(made.length ? { made } : {}), ...(by ? { by } : {}), ...(author ? { author } : {}) };
	}

	/**
	 * What changed since the version last said, as the one `canvas.changed` every client on the canvas's
	 * line or stream hears; or the whole drawing when nothing was said before or the file does not
	 * read. The edits are the log's whenever it holds every revision since the one said (`editsSince`);
	 * else (a frame of the canvas changed with no revision, a revision from before this server) the two
	 * drawings, imports and all, are compared, so the edits are always right.
	 */
	changes(name: string): ServerMessage {
		const entry = this.of.get(name);
		const before = this.sent.get(name);
		const made = this.takeMade(name);
		if (!before || entry.error) {
			const whole = this.changedWhole(name, entry, made.length ? made : (this.madeLately.get(name) ?? []));
			this.sent.set(name, { rev: entry.rev, doc: (whole as { doc: PenDocument }).doc });
			return whole;
		}
		const doc = this.of.files.withImported(name, entry.doc);
		const edits = (entry.rev > before.rev ? this.editsSince(name, before.rev, entry.rev)?.edits : undefined) ?? diff(before.doc, doc);
		this.sent.set(name, { rev: entry.rev, doc });
		const base = `${fileUrl(this.of.folderOf(name))}/`;
		const by = this.writers.get(name);
		const author = this.authorOf(name, entry.rev);
		return { type: "canvas.changed", canvas: name, rev: entry.rev, from: before.rev, edits, base, ...(made.length ? { made } : {}), ...(by ? { by } : {}), ...(author ? { author } : {}) };
	}

	/**
	 * What a client holding revision `since` of a canvas is sent to catch up (`canvas.watch` on the line):
	 * nothing when it holds the current one; the edits since, with the browsers' names for theirs, when
	 * the log reaches back to it; else the drawing whole.
	 */
	/** The drawing whole, as `canvas.changed` with `doc`, with the browsers' recent edit names: for a client holding nothing yet. */
	whole(name: string): ServerMessage {
		return this.changedWhole(name, this.of.get(name), [...(this.madeLately.get(name) ?? []), ...(this.made.get(name) ?? [])]);
	}

	caughtUp(name: string, since: number): ServerMessage | undefined {
		const entry = this.of.get(name);
		if (!entry.error && entry.rev === since) return undefined;
		const span = entry.error ? undefined : this.editsSince(name, since, entry.rev);
		if (!span) return this.changedWhole(name, entry, []);
		const by = this.writers.get(name);
		const author = this.authorOf(name, entry.rev);
		return { type: "canvas.changed", canvas: name, rev: entry.rev, from: since, edits: span.edits, base: `${fileUrl(this.of.folderOf(name))}/`, ...(span.made.length ? { made: span.made } : {}), ...(by ? { by } : {}), ...(author ? { author } : {}) };
	}
}
