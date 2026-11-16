import { AsyncLocalStorage } from "node:async_hooks";
import type { Author, ChangeRecord } from "../agents/canvas-news.ts";
import type { ChangeAuthor } from "@decks/protocol";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { rustRouter } from "./arrows.ts";
import { CANVAS_DIR, CANVAS_FILE, CANVAS_META } from "./canvas-files.ts";
import { runAtOpen } from "../migrations/index.ts";
import { dirname, join } from "node:path";
import { apply, baseTheme, withDecksColors, emptyDocument, ids, parse, PenError, placements, read, reroute, serialize, themeFrom, walk, type Frame, type Op, type OpResult, type PenDocument, type PenEdit, type PenNode, type Placed, type ReadOptions, diff } from "@decks/pen";

/** What a read may ask for beyond the whole file: one item, a depth, values worked out, in a theme such as { mode: "dark" } (`read.ts`). */
export type ReadMore = Omit<ReadOptions, "theme" | "measure"> & { theme?: Record<string, string> };
import { serverText } from "./text.ts";
import { CanvasCards } from "./cards-on.ts";
import { PenFiles } from "./pen-files.ts";
import type { ServerMessage } from "@decks/protocol";
import { slug } from "@decks/deck-kit";
import { fileUrl } from "../deck/roots.ts";
import { canvasFolder, canvasNameOk, isSharedCanvas, plainSegment, SHARED_CANVASES, sharedName, sharedParts, viewOnlySentence } from "@decks/hub/layout";
import { toDisk, toMemory } from "./canvas-refs.ts";

/**
 * A card on a canvas: pen's own `browser` item, a live web page, pointed at the card's file and
 * tagged in pen's extension field with the card's path, so the server knows which card it is
 * without parsing a URL.
 *
 *     { "type": "browser", "id": "report", "name": "The finding", "url": "cards/report/index.html",
 *       "x": 0, "y": 0, "width": 1000, "height": 700, "metadata": { "type": "decks.card", "path": "cards/report/index.html" } }
 *
 * pen.dev shows it as a web page; Decks draws the card itself in its place, in a shadow root of the
 * canvas's own page (`deck/layout.ts`). A `decks.board` item, left on a friend's canvas by a Decks
 * from before cards, is no page: it is kept in the file as it is, and drawn as an item with nothing in it.
 */
export const CARD_ITEM = "decks.card";

/** The card an item stands for, by its deck path, or undefined when it is not one. */
export function boardOf(node: PenNode): string | undefined {
	if (node.type !== "browser" || !node.metadata || node.metadata.type !== CARD_ITEM) return undefined;
	const path = node.metadata.path;
	return typeof path === "string" && path ? path : undefined;
}

/**
 * Stages as `.pen` files: `stages/<name>/stage.pen` in the deck.
 *
 * A stage's drawing — notes, shapes, arrows, text, frames — is a native pen.dev document, saved as
 * pen.dev saves one, so the folder opens in pen.dev as it is. This service is the one writer the
 * server has: edits come in as pen operations (`@decks/pen`'s `apply`), are checked, and are
 * written whole. An agent may also edit the file with its own tools; the watcher picks that up,
 * and a file that no longer parses is reported rather than drawn half-broken — the last good
 * document stays on screen until the file is fixed.
 *
 * A stage is named when it is first used and keeps that name, so its folder does not move when
 * the agent renames itself.
 */

export interface PenEntry {
	doc: PenDocument;
	/** Bumped on every change the server saw, its own or a hand edit. */
	rev: number;
	/** Why the file on disk is not what is shown, when it does not parse. */
	error?: string;
	/** The layout of `doc`, worked out the first time it is asked for. */
	placed?: Map<string, Placed>;
	/** The file's text as last read or written. */
	text?: string;
}

/**
 * The person's own name for the edit being made, when the browser gave one (`x-decks-edit` on a verb's
 * request, `edit` on the socket's): set around the call that makes it, read when the drawing is written,
 * and sent back with the revision that has it (`made` on `stage.pen.delta` and `stage.pen`). The browser
 * shows its edit at once and keeps it on top of what the server sends until that revision comes
 * (`canvas/src/model/drawing.ts`), so it never draws the drawing as it was before for the round trip.
 */
export const penEditBy = new AsyncLocalStorage<string>();
/** How many writes of each canvas are kept for the agents' notes (`changesSince`). */
const CHANGE_LOG = 400;
/** How many of a stage's recent names a drawing sent whole carries. */
const MADE_LATELY = 64;

/**
 * The agent a write to a drawing is made for, while one of its calls runs (`calls/tool.ts`): each
 * canvas remembers the last, and its placeholder frames are drawn in that agent's colour with its
 * name. A person's own edits leave it as it was.
 */
export const penWriter = new AsyncLocalStorage<string>();

/**
 * Who a write is made for when it is neither the person's nor an agent's call: Studio's, bringing
 * another harness's or browser's change down (`writeFrom`). Read when the drawing is written and kept
 * on the log, so the sync does not send the change back up.
 */
const penOrigin = new AsyncLocalStorage<Author>();

/** Words measured as the page measures them (`text.ts`). */
export const measure = serverText.measure;

const FILE = CANVAS_FILE;
/** How many of the person's edits each stage can take back. */
const HISTORY = 100;

export class StagePens {
	/** The cards on each canvas: placed, moved, sized, taken off, and copied in from another canvas (`cards-on.ts`). */
	readonly cards: CanvasCards = new CanvasCards(this);
	/** Saved frames and any other `.pen` file by its path: read, edited, made, placed by a ref, and watched (`pen-files.ts`). */
	readonly files: PenFiles = new PenFiles(this);
	private readonly cache = new Map<string, PenEntry & { mtime: number; text: string }>();
	/** The folders each canvas had before, since this server started (`rename`). */
	private readonly former = new Map<string, string[]>();

	/** The folders a canvas had before it was moved to this one. */
	formerly(name: string): string[] {
		return this.former.get(name) ?? [];
	}
	private watcher: FSWatcher | undefined;
	/** The friends' canvases, `shared/canvases/`, watched as this deck's own are. */
	private sharedWatcher: FSWatcher | undefined;
	private pending = new Map<string, NodeJS.Timeout>();
	private readonly history = new Map<string, { undo: Array<{ before: string; after: string }>; redo: Array<{ before: string; after: string }> }>();
	/** The browsers' names for the edits written to each stage since its drawing was last sent (`penEditBy`). */
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
	editsSince(name: string, from: number, to = this.get(name).rev): { from: number; rev: number; edits: PenEdit[]; made: string[] } | undefined {
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

	/** The last names sent with each stage's drawings, for a drawing sent whole to one browser (`frame`). */
	private readonly madeLately = new Map<string, string[]>();

	constructor(
		public deckPath: string,
		private readonly changed: (name: string, entry: PenEntry) => void,
	) {
		// Boxes worked out while words were estimated are worked out again once their fonts are here.
		serverText.onFonts(() => {
			for (const entry of this.cache.values()) entry.placed = undefined;
		});
		void serverText.start();
	}

	get dir(): string {
		return join(this.deckPath, CANVAS_DIR);
	}

	fileOf(name: string): string {
		return join(this.folderOf(name), FILE);
	}

	/**
	 * A canvas's folder: `canvases/<name>`, or `shared/canvases/<owner>/<canvas>` for a friend's
	 * (`deck/layout.ts`). Refused for a name that could name anywhere else.
	 */
	folderOf(name: string): string {
		return join(this.deckPath, canvasFolder(name));
	}

	/** Whether a stage of this name exists, without listing them all. */
	has(name: string): boolean {
		return canvasNameOk(name) && existsSync(this.folderOf(name));
	}

	/** Every canvas folder, drawn on or only claimed: this deck's own, then those friends shared, as `shared/<owner>/<canvas>`. */
	names(): string[] {
		// A friend's canvas that came down since the watcher started: watched from now on.
		if (!this.sharedWatcher && this.watcher && existsSync(join(this.deckPath, SHARED_CANVASES))) this.watch();
		const own = existsSync(this.dir)
			? readdirSync(this.dir, { withFileTypes: true })
					.filter((entry) => entry.isDirectory() && plainSegment(entry.name))
					.map((entry) => entry.name)
					.sort()
			: [];
		const shared: string[] = [];
		const from = join(this.deckPath, SHARED_CANVASES);
		if (existsSync(from)) {
			for (const owner of readdirSync(from, { withFileTypes: true })) {
				if (!owner.isDirectory() || !plainSegment(owner.name)) continue;
				for (const canvas of readdirSync(join(from, owner.name), { withFileTypes: true })) {
					if (canvas.isDirectory() && plainSegment(canvas.name)) shared.push(sharedName(owner.name, canvas.name));
				}
			}
		}
		return [...own, ...shared.sort()];
	}

	/** The Studio canvas a canvas of this deck is synced with, when it is (`studio/sync.ts` writes it in `canvas.json`). */
	studioId(name: string): string | undefined {
		try {
			const meta = JSON.parse(readFileSync(join(this.folderOf(name), CANVAS_META), "utf8")) as { studio?: unknown };
			return typeof meta.studio === "string" ? meta.studio : undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * A drawing written from outside (Studio's sync, pen.dev, an agent's own tools) that reaches out of
	 * its canvas's folder for a picture is written again through `toDisk`, which copies the picture into
	 * the canvas's `files/` (`canvas-refs.ts`). Only this deck's own canvases, and only when it would change.
	 */
	private settle(name: string): void {
		if (isSharedCanvas(name)) return;
		const entry = this.cache.get(name);
		if (!entry || entry.error) return;
		try {
			if (serialize(toDisk(name, entry.doc, this.cards.adopt)) !== entry.text) this.write(name, entry.doc);
		} catch {
			/* a board it names cannot be copied in: left as it is, and drawn as missing */
		}
	}

	/** Refused, with a sentence, for a friend's canvas shared with you to view: its drawing follows theirs. */
	mayWrite(name: string): void {
		const shared = this.sharing(name);
		if (shared && shared.role !== "edit") throw new PenError(viewOnlySentence(this.titleOf(name), shared.ownerName ?? shared.owner, name));
	}

	/** Whether a canvas is a friend's, shared with this deck: read here, written back only when they let you edit it. */
	isShared(name: string): boolean {
		return isSharedCanvas(name);
	}

	/**
	 * Who shared a friend's canvas, and as what (`canvas.json`, written by the sync when it came down,
	 * `studio/sync.ts`); undefined for one of this deck's own.
	 */
	/**
	 * Whether a canvas is yours alone, so what is on it may act as you: not a friend's (`shared/…`), and
	 * not one of yours that Studio says someone else may edit (`othersEdit` in its `canvas.json`, written by
	 * the sync). An app placed on it runs inside the canvas frame only then (`auth/passes.ts`).
	 */
	yoursAlone(name: string): boolean {
		if (sharedParts(name)) return false;
		try {
			const meta = JSON.parse(readFileSync(join(this.folderOf(name), CANVAS_META), "utf8")) as { othersEdit?: unknown };
			return meta.othersEdit !== true;
		} catch {
			return true;
		}
	}

	sharing(name: string): { owner: string; ownerName?: string; role: "edit" | "view"; studio?: string } | undefined {
		const parts = sharedParts(name);
		if (!parts) return undefined;
		let meta: { shared?: { ownerName?: unknown; role?: unknown; studio?: unknown } } = {};
		try {
			meta = JSON.parse(readFileSync(join(this.folderOf(name), CANVAS_META), "utf8")) as typeof meta;
		} catch {
			/* no record: read only */
		}
		const role = meta.shared?.role === "edit" ? "edit" : "view";
		return { owner: parts.owner, ...(typeof meta.shared?.ownerName === "string" ? { ownerName: meta.shared.ownerName } : {}), role, ...(typeof meta.shared?.studio === "string" ? { studio: meta.shared.studio } : {}) };
	}

	/**
	 * Take a folder for a new stage, named from a title; made now, so two agents cannot take one name.
	 * The title is kept as given. `provisional` is a name nobody chose for what is on the canvas —
	 * the agent's own, given to the canvas it lands on — which the agent is asked to replace
	 * (`naming`).
	 */
	claim(title: string, options: { provisional?: boolean } = {}): string {
		const name = this.freshName(title);
		mkdirSync(this.folderOf(name), { recursive: true });
		if (title.trim()) this.setTitle(name, title, { provisional: options.provisional === true });
		if (!this.watcher) this.watch();
		return name;
	}

	/**
	 * A stage's name as the person reads it, which is not its folder's.
	 *
	 * The folder is the stage's id — agents open it, board paths run through it, and a camera is
	 * kept under it — so it is a slug made once and never moved. The name beside it, in
	 * `stage.json`, is whatever the person or an agent calls the canvas, spaces, capitals and all,
	 * and changing it touches nothing else. A stage with no `stage.json` is called by its folder.
	 */
	titleOf(name: string): string {
		return this.naming(name).title ?? name;
	}

	/**
	 * How a stage came by its name: the name, whether anybody chose it (`provisional` when it is the
	 * agent's own, given at claim), and the boards it held when it was named — what an agent is
	 * asked about when the canvas has since filled with other things (`canvas/canvas-name.ts`).
	 */
	naming(name: string): { title?: string; provisional: boolean; boards?: string[] } {
		try {
			const parsed = JSON.parse(readFileSync(join(this.folderOf(name), CANVAS_META), "utf8")) as { title?: unknown; provisional?: unknown; boards?: unknown };
			const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : undefined;
			const boards = Array.isArray(parsed.boards) ? parsed.boards.filter((one): one is string => typeof one === "string") : undefined;
			return { ...(title ? { title } : {}), provisional: parsed.provisional === true, ...(boards ? { boards } : {}) };
		} catch {
			/* no canvas.json, or one that does not parse: no name but the folder's */
			return { provisional: false };
		}
	}

	/**
	 * Call a stage something else. Only the name changes; the folder, its boards and its drawing stay
	 * where they are. The boards on it now are written down with the name, as what it was named for.
	 */
	setTitle(name: string, title: string, options: { provisional?: boolean } = {}): string {
		if (!this.names().includes(name)) throw new Error(`No canvas "${name}".`);
		this.mayWrite(name);
		const clean = title.replace(/\s+/g, " ").trim().slice(0, 80);
		if (!clean) throw new Error("A canvas's name cannot be empty.");
		const file = join(this.folderOf(name), CANVAS_META);
		let kept: Record<string, unknown> = {};
		try {
			kept = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		} catch {
			/* a first title */
		}
		const { provisional: _was, ...rest } = kept;
		let boards: string[] = [];
		try {
			boards = this.cards.boards(name).map((one) => one.path);
		} catch {
			/* a stage with no drawing yet holds no boards */
		}
		writeFileSync(file, `${JSON.stringify({ ...rest, title: clean, boards, ...(options.provisional ? { provisional: true } : {}) }, null, "\t")}\n`);
		return clean;
	}

	/**
	 * Move a stage to a new folder name, drawing and all. Board items whose path `repoint` changes
	 * (boards kept in the stage's own folder, which moved with it) are pointed at the new path in
	 * place, so their ids — and any arrow joined to them — stay as they were.
	 */
	rename(from: string, to: string, repoint: (path: string) => string): void {
		if (!this.names().includes(from)) throw new Error(`No canvas "${from}".`);
		if (this.names().includes(to)) throw new Error(`A canvas called "${to}" already exists.`);
		renameSync(this.folderOf(from), this.folderOf(to));
		this.former.set(to, [...(this.former.get(from) ?? []), from]);
		this.former.delete(from);
		this.cache.delete(from);
		const history = this.history.get(from);
		this.history.delete(from);
		if (history) this.history.set(to, history);
		const ops: Op[] = [];
		for (const node of walk(this.get(to).doc.children)) {
			const path = boardOf(node);
			if (!path || repoint(path) === path) continue;
			const next = repoint(path);
			ops.push({ op: "update", id: node.id, set: { url: `../../${next}`, metadata: { ...node.metadata, path: next } } });
		}
		if (ops.length > 0) this.edit(to, ops, undefined, { undoable: false });
	}

	/** Delete a stage: its folder, its drawing and any boards kept in it. */
	remove(name: string): void {
		if (!this.names().includes(name)) throw new Error(`No canvas "${name}".`);
		rmSync(this.folderOf(name), { recursive: true, force: true });
		this.cache.delete(name);
		this.history.delete(name);
	}

	/** A folder name for a new stage, from a title, not already taken by a file or by `alsoTaken`. */
	freshName(title: string, alsoTaken: Iterable<string> = []): string {
		const base = slug(title, 40) || "stage";
		const taken = new Set([...this.names(), ...alsoTaken]);
		if (!taken.has(base)) return base;
		for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
	}

	/** The document as it stands, read from disk when the file changed. A stage with no file is empty. */
	get(name: string): PenEntry {
		const file = this.fileOf(name);
		const cached = this.cache.get(name);
		if (!existsSync(file)) return cached ?? { doc: emptyDocument(), rev: 0 };
		const mtime = statSync(file).mtimeMs;
		if (cached && cached.mtime === mtime) return cached;
		const text = readFileSync(file, "utf8");
		if (cached && cached.text === text) {
			cached.mtime = mtime;
			return cached;
		}
		try {
			const doc = toMemory(name, parse(text));
			const entry = { doc, rev: (cached?.rev ?? 0) + 1, mtime, text };
			this.cache.set(name, entry);
			return entry;
		} catch (error) {
			const why = error instanceof Error ? error.message : String(error);
			const kept = { doc: cached?.doc ?? emptyDocument(), rev: (cached?.rev ?? 0) + 1, mtime, text, error: `${file} does not parse, so the last good version is shown: ${why}` };
			this.cache.set(name, kept);
			return kept;
		}
	}

	/**
	 * Apply edits together, write the file, and say so. Nothing is written if any edit fails.
	 *
	 * Arrows are redrawn after the edits, so one that joins something that moved follows it
	 * (`@decks/pen`'s `reroute`). `boards` finds a board by path, for an arrow that ends on one.
	 */
	edit(name: string, ops: readonly Op[], boards?: (path: string) => Frame | undefined, options?: { undoable?: boolean }): { entry: PenEntry; results: OpResult[] } {
		this.mayWrite(name);
		const current = this.get(name);
		if (current.error) throw new PenError(`${current.error}. Fix the file, or replace it whole, before editing it.`);
		const theme = baseTheme(current.doc, "light");
		/*
		 * Every edit of a canvas comes through here, whoever sends it: an item coloured by a Decks
		 * colour (`$decks-surface`, what the tools make) has it defined in the drawing, light and dark,
		 * when the drawing lacks it. The canvas adds them itself as it edits; an edit sent while no
		 * canvas shows the drawing (a file card dropped then) is the one this catches.
		 */
		const { doc, results } = apply(withColors(current.doc, ops), ops, { theme, measure });
		const placed = placements(this.files.withImported(name, doc), { theme, measure });
		reroute(doc, placed, (path) => boardBox(doc, placed, path) ?? boards?.(path), rustRouter);
		const before = current.text ?? serialize(current.doc);
		const entry = this.write(name, doc);
		if (options?.undoable) {
			const history = this.historyOf(name);
			history.undo.push({ before, after: entry.text! });
			if (history.undo.length > HISTORY) history.undo.shift();
			history.redo = [];
		}
		return { entry, results };
	}

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
		if (!last) throw new PenError(direction === "undo" ? "Nothing on this stage to undo." : "Nothing to redo.");
		const current = this.get(name);
		const now = current.text ?? serialize(current.doc);
		const expected = direction === "undo" ? last.after : last.before;
		if (now !== expected) {
			history.undo = [];
			history.redo = [];
			throw new PenError("The drawing has changed since, by an agent or in the file, so there is nothing safe to take back.");
		}
		from.pop();
		const entry = this.write(name, toMemory(name, parse(direction === "undo" ? last.before : last.after)));
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
	 * Redraw a stage's arrows because something outside the file moved — a board an arrow ends on.
	 * Written only when an arrow actually changed.
	 */
	follow(name: string, boards: (path: string) => Frame | undefined): void {
		const current = this.get(name);
		if (current.error || !existsSync(this.fileOf(name)) || this.sharing(name)?.role === "view") return;
		const doc = structuredClone(current.doc);
		const placed = placements(this.files.withImported(name, doc), { theme: baseTheme(doc, "light"), measure });
		if (reroute(doc, placed, (path) => boardBox(doc, placed, path) ?? boards(path), rustRouter)) this.write(name, doc);
	}

	/** Where everything in a stage is, laid out once per version of the file. */
	placedOf(name: string): Map<string, Placed> {
		const entry = this.get(name);
		entry.placed ??= placements(this.files.withImported(name, entry.doc), { theme: baseTheme(entry.doc, "light"), measure });
		return entry.placed;
	}

	/*
	 * Boards on a stage, changed one at a time in its file. These are the only writes of boards to a
	 * stage: whoever asks, a person on the canvas or an agent on its own stage, names the stage and
	 * the board, and nothing else in the file is touched. There is no copy of the stage anywhere else
	 * to fall out of step with it.
	 */

	/**
	 * What one stage holds, for the manager's list: how many boards, and the words in it.
	 *
	 * The words are what the manager's search matches beyond the name — every board's title and
	 * every note's text — gathered here because this is the only place that reads the file. A
	 * stage with a file that does not parse still answers, from the last good document.
	 */
	summary(name: string): { boards: number; rev: number; words: string } {
		const entry = this.get(name);
		const words: string[] = [];
		let boards = 0;
		for (const node of walk(entry.doc.children)) {
			if (boardOf(node)) boards += 1;
			if (typeof node.name === "string" && node.name) words.push(node.name);
			const content = (node as { content?: unknown }).content;
			if (typeof content === "string" && content) words.push(content);
		}
		return { boards, rev: entry.rev, words: words.join(" ").replace(/\s+/g, " ").slice(0, 600) };
	}

	/** The `stage.pen` frame for one agent looking at this stage. */
	/** A stage's drawing as the page is given it (imports in place) and the folder its fills are read against, without counting as sent. */
	drawingOf(name: string): { doc: PenDocument; base: string } {
		return { doc: this.files.withImported(name, this.get(name).doc), base: `${fileUrl(this.folderOf(name))}/` };
	}

	/**
	 * A drawing sent whole to one browser (asked again, opened, a picture of the stage) says it has the
	 * recent names and those still to be sent, and takes none: taken, they were never sent to the
	 * other browsers, whose edits then stayed on top of the drawing for six seconds.
	 */
	frame(agentId: string, name: string, made = [...(this.madeLately.get(name) ?? []), ...(this.made.get(name) ?? [])]): ServerMessage {
		const entry = this.get(name);
		const doc = this.files.withImported(name, entry.doc);
		this.sent.set(name, { rev: entry.rev, doc });
		const by = this.writers.get(name);
		return { type: "stage.pen", agentId, stage: name, rev: entry.rev, doc, base: `${fileUrl(this.folderOf(name))}/`, ...(entry.error ? { error: entry.error } : {}), ...(made.length ? { made } : {}), ...(by ? { by } : {}) };
	}

	/** The browsers' edits written since the drawing was last sent, taken: the next frame or delta says it has them. */
	private takeMade(name: string): string[] {
		const made = this.made.get(name) ?? [];
		this.made.delete(name);
		if (made.length) this.madeLately.set(name, [...(this.madeLately.get(name) ?? []), ...made].slice(-MADE_LATELY));
		return made;
	}

	/** The version of each stage last sent to browsers, whole or as edits: what the next edits are from. */
	private readonly sent = new Map<string, { rev: number; doc: PenDocument }>();

	/** Who made the write that gave a canvas its current revision, from the log; nothing when the log does not say. */
	private authorOf(name: string, rev: number): ChangeAuthor | undefined {
		const record = this.changeLogs.get(name)?.findLast((one) => one.rev === rev);
		return record ? { kind: record.by.kind, ...("id" in record.by ? { id: record.by.id } : {}) } : undefined;
	}

	/** A canvas as `canvas.changed` says it whole: the drawing with its imports, for a client with no revision or one the log no longer reaches. */
	private changedWhole(name: string, entry: PenEntry, made: string[]): ServerMessage {
		const doc = this.files.withImported(name, entry.doc);
		const by = this.writers.get(name);
		const author = this.authorOf(name, entry.rev);
		return { type: "canvas.changed", canvas: name, rev: entry.rev, doc, base: `${fileUrl(this.folderOf(name))}/`, ...(entry.error ? { error: entry.error } : {}), ...(made.length ? { made } : {}), ...(by ? { by } : {}), ...(author ? { author } : {}) };
	}

	/**
	 * What changed since the version last sent: one `canvas.changed` for every client on the canvas's
	 * line or stream, then the same as `stage.pen.delta` frames for these agents (what a tab's socket
	 * still reads: the Decks iOS app's); or the whole drawing when nothing was sent before or the file does
	 * not read. The edits are the log's whenever it holds every revision since the one sent (`editsSince`);
	 * else (a frame of the canvas changed with no revision, a revision from before this server) the two
	 * drawings, imports and all, are compared, so the edits are always right.
	 */
	changes(agentIds: readonly string[], name: string): ServerMessage[] {
		const entry = this.get(name);
		const before = this.sent.get(name);
		const made = this.takeMade(name);
		if (!before || entry.error) {
			const whole = this.changedWhole(name, entry, made.length ? made : (this.madeLately.get(name) ?? []));
			return [whole, ...agentIds.map((id) => this.frame(id, name, this.madeLately.get(name) ?? made))];
		}
		const doc = this.files.withImported(name, entry.doc);
		const edits = (entry.rev > before.rev ? this.editsSince(name, before.rev, entry.rev)?.edits : undefined) ?? diff(before.doc, doc);
		this.sent.set(name, { rev: entry.rev, doc });
		const base = `${fileUrl(this.folderOf(name))}/`;
		const by = this.writers.get(name);
		const author = this.authorOf(name, entry.rev);
		const changed: ServerMessage = { type: "canvas.changed", canvas: name, rev: entry.rev, from: before.rev, edits, base, ...(made.length ? { made } : {}), ...(by ? { by } : {}), ...(author ? { author } : {}) };
		return [changed, ...agentIds.map((agentId): ServerMessage => ({ type: "stage.pen.delta", agentId, stage: name, from: before.rev, rev: entry.rev, edits, base, ...(made.length ? { made } : {}), ...(by ? { by } : {}) }))];
	}

	/**
	 * What a client holding revision `since` of a canvas is sent to catch up (`canvas.watch` on the line):
	 * nothing when it holds the current one; the edits since, with the browsers' names for theirs, when
	 * the log reaches back to it; else the drawing whole.
	 */
	/** The drawing whole, as `canvas.changed` with `doc`, with the browsers' recent edit names: for a client holding nothing yet. */
	whole(name: string): ServerMessage {
		return this.changedWhole(name, this.get(name), [...(this.madeLately.get(name) ?? []), ...(this.made.get(name) ?? [])]);
	}

	caughtUp(name: string, since: number): ServerMessage | undefined {
		const entry = this.get(name);
		if (!entry.error && entry.rev === since) return undefined;
		const span = entry.error ? undefined : this.editsSince(name, since, entry.rev);
		if (!span) return this.changedWhole(name, entry, []);
		const by = this.writers.get(name);
		const author = this.authorOf(name, entry.rev);
		return { type: "canvas.changed", canvas: name, rev: entry.rev, from: since, edits: span.edits, base: `${fileUrl(this.folderOf(name))}/`, ...(span.made.length ? { made: span.made } : {}), ...(by ? { by } : {}), ...(author ? { author } : {}) };
	}

	/** Replace the document whole, from text that must parse. */
	replace(name: string, text: string): PenEntry {
		return this.write(name, toMemory(name, parse(text)));
	}

	/**
	 * A drawing from Studio, written as it came and recorded as Studio's (`by`), so the sync does not
	 * send it back up and the agents' notes say who. Allowed on a canvas shared with the person to view,
	 * which they may not edit but Studio may change under them.
	 */
	writeFrom(name: string, text: string, by: Author): PenEntry {
		return penOrigin.run(by, () => this.write(name, toMemory(name, parse(text)), { unchecked: true }));
	}

	/** What an agent reads: the file's items, each with its box on the stage. */
	read(name: string, more: ReadMore = {}) {
		const entry = this.get(name);
		const { theme, ...rest } = more;
		return { stage: name, file: this.fileOf(name), ...(entry.error ? { error: entry.error } : {}), ...read(this.files.withImported(name, entry.doc), { theme: themeFrom(entry.doc, theme), measure, ...rest }) };
	}

	private write(name: string, doc: PenDocument, options: { unchecked?: boolean } = {}): PenEntry {
		if (!options.unchecked) this.mayWrite(name);
		const file = this.fileOf(name);
		mkdirSync(this.folderOf(name), { recursive: true });
		if (!this.watcher) this.watch();
		// Named from the canvas's own folder on disk, a board from elsewhere copied in first (`canvas-refs.ts`).
		const text = serialize(toDisk(name, doc, this.cards.adopt));
		writeFileSync(file, text);
		doc = toMemory(name, parse(text));
		const previous = this.cache.get(name);
		const entry = { doc, rev: (previous?.rev ?? 0) + 1, mtime: statSync(file).mtimeMs, text };
		this.cache.set(name, entry);
		const by = penEditBy.getStore();
		if (by) this.made.set(name, [...(this.made.get(name) ?? []), by]);
		// Studio's (`penOrigin`), an agent's call (`penWriter`), or the person's, from a page.
		const writer = penWriter.getStore();
		this.record(name, previous?.doc, doc, entry.rev, penOrigin.getStore() ?? (writer ? { kind: "agent", id: writer } : { kind: "person" }), by ? [by] : undefined);
		if (writer) this.writers.set(name, writer);
		this.changed(name, entry);
		return entry;
	}

	/**
	 * Notice hand edits: an agent writing `stage.pen` with its own tools, or a person saving from
	 * pen.dev. Debounced per stage, and a write that matches what the server wrote is not news.
	 */
	watch(): void {
		this.close();
		this.files.watchFrames();
		// A drawing changed on disk: an agent's write, pen.dev's save, a friend's edit the sync brought down.
		const drawing = (name: string) => {
			clearTimeout(this.pending.get(name));
			this.pending.set(
				name,
				setTimeout(() => {
					this.pending.delete(name);
					const before = this.cache.get(name);
					const after = this.get(name);
					if (after !== before || after.rev !== before?.rev) {
						// Written straight to the file: pen.dev, an agent's own tools, the sync from Studio.
						if (!after.error) this.record(name, before?.doc, after.doc, after.rev, { kind: "file" });
						this.changed(name, after);
					}
					this.settle(name);
				}, 80),
			);
		};
		// One of a canvas's own frames changed: that canvas is sent again.
		const frame = (name: string, rest: string[]) => {
			const key = `frames/${rest.join("/").replace(/\.pen$/, "")}`;
			this.files.changed(join(this.folderOf(name), `${key}.pen`), key, name);
		};
		const seen = (name: string, rest: string[]) => {
			if (rest.length === 1 && rest[0] === FILE) drawing(name);
			else if (rest[0] === "frames" && rest.length > 1 && rest.at(-1)!.endsWith(".pen")) frame(name, rest.slice(1));
		};
		// No folder yet is no stage yet: `claim` and `write` start watching when they make one.
		try {
			if (existsSync(this.dir)) {
				this.watcher = watch(this.dir, { recursive: true }, (_event, file) => {
					if (!file) return;
					const parts = String(file).split(/[\\/]/);
					if (parts.length >= 2 && plainSegment(parts[0])) seen(parts[0]!, parts.slice(1));
				});
			}
			const shared = join(this.deckPath, SHARED_CANVASES);
			if (existsSync(shared)) {
				this.sharedWatcher = watch(shared, { recursive: true }, (_event, file) => {
					if (!file) return;
					const parts = String(file).split(/[\\/]/);
					if (parts.length >= 3 && plainSegment(parts[0]) && plainSegment(parts[1])) seen(sharedName(parts[0]!, parts[1]!), parts.slice(2));
				});
			}
		} catch {
			// A platform without recursive watching still works: edits through the tool are announced
			// by `write`, and a hand edit is read the next time anything asks.
		}
	}

	/** Every stage that uses a saved frame, sent again with a new revision, so each copy shows the change. */
	resendUsing(key: string, canvas?: string): void {
		for (const [stage, entry] of this.cache) {
			if (!entry.text.includes(`"${key}`)) continue;
			// A canvas's own frame is that canvas's; the deck's is any canvas's that has no copy of its own.
			if (canvas ? stage !== canvas : existsSync(join(this.folderOf(stage), `${key}.pen`))) continue;
			// A new revision, so the canvas takes it as news and lays the stage out again.
			const next = { ...entry, rev: entry.rev + 1, placed: undefined };
			this.cache.set(stage, next);
			this.changed(stage, next);
		}
	}

	setDeck(deckPath: string): void {
		runAtOpen(deckPath, { dataDir: dirname(deckPath) });
		this.deckPath = deckPath;
		this.cache.clear();
		this.files.forget();
		this.watch();
	}

	close(): void {
		this.watcher?.close();
		this.watcher = undefined;
		this.sharedWatcher?.close();
		this.sharedWatcher = undefined;
		this.files.close();
		for (const timer of this.pending.values()) clearTimeout(timer);
		this.pending.clear();
	}
}

/** A board's box on this stage, found by path, for an arrow that ends on it. */
/**
 * `doc` with the Decks colours `ops` use and it lacks defined (`withDecksColors`), as a document of
 * its own, so the edit's results and an error's "Edit 2" still count the caller's ops. `doc` itself
 * when nothing is wanted.
 */
export function withColors(doc: PenDocument, ops: readonly Op[]): PenDocument {
	const colored = withDecksColors(doc, ops);
	if (colored.length === ops.length) return doc;
	return apply(doc, [colored[0] as Op], { theme: baseTheme(doc, "light"), measure }).doc;
}

function boardBox(doc: PenDocument, placed: ReadonlyMap<string, Placed>, path: string): Frame | undefined {
	for (const node of walk(doc.children)) if (boardOf(node) === path) return placed.get(node.id)?.box;
	return undefined;
}

/** A result with the box its item now has, from a layout of the file. */
export function withBox(result: OpResult, placed: Map<string, Placed>): OpResult & { box?: { x1: number; y1: number; x2: number; y2: number } } {
	const at = result.op === "delete" ? undefined : placed.get(result.id);
	return at ? { ...result, box: { x1: at.box.x, y1: at.box.y, x2: at.box.x + at.box.w, y2: at.box.y + at.box.h } } : result;
}

