import { AsyncLocalStorage } from "node:async_hooks";
import type { Author, ChangeRecord } from "../agents/canvas-news.ts";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { rustRouter } from "./arrows.ts";
import { CANVAS_DIR, CANVAS_FILE, CANVAS_META } from "./canvas-files.ts";
import { runAtOpen } from "../migrations/index.ts";
import { movedPath } from "../migrations/2026-10-16-stages-to-canvases.ts";
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";
import { apply, ARROW, baseTheme, withDecksColors, clone, emptyDocument, ids, IMPORTED, indexOf, parse, PEN_VERSION, PenError, placements, read, reroute, serialize, themeFrom, walk, type Frame, type Op, type OpResult, type PenDocument, type PenNode, type Placed, type ReadOptions, diff } from "@decks/pen";

/** What a read may ask for beyond the whole file: one item, a depth, values worked out, in a theme such as { mode: "dark" } (`read.ts`). */
export type ReadMore = Omit<ReadOptions, "theme" | "measure"> & { theme?: Record<string, string> };
import { serverText } from "./text.ts";
import type { ServerMessage } from "@decks/protocol";
import { slug } from "../agents/slug.ts";
import { fileUrl } from "../deck/roots.ts";
import { canvasFolder, isCardPath, pageName, canvasNameOk, canvasOfPath, isSharedCanvas, plainSegment, referenceFor, SHARED_CANVASES, sharedName, sharedParts, viewOnlySentence } from "../deck/layout.ts";
import { copyBoardInto, copyFileInto, copyFrameInto } from "./copy-in.ts";
import { toDisk, toMemory, type Adopt } from "./canvas-refs.ts";

/**
 * A deck board on a stage: pen's own `browser` item, a live web page, pointed at the board's file
 * and tagged in pen's extension field with the board's path, so the server knows which board it is
 * without parsing a URL.
 *
 *     { "type": "browser", "id": "report", "name": "The finding", "url": "../../boards/report.html",
 *       "x": 0, "y": 0, "width": 1000, "height": 700, "metadata": { "type": "decks.board", "path": "boards/report.html" } }
 *
 * pen.dev shows it as a web page; Decks draws the board itself in its place.
 */
export const BOARD_ITEM = "decks.board";
/** A card's tag: a board in `cards/`, drawn in a shadow root of the stage's page (`deck/layout.ts`). */
export const CARD_ITEM = "decks.card";
/** The tag a page item takes for its path: a card's in a canvas's `cards/`, a board's anywhere else. */
export const pageTag = (path: string): string => (isCardPath(path) ? CARD_ITEM : BOARD_ITEM);

/** The deck board an item stands for, by path, or undefined when it is not one. */
export function boardOf(node: PenNode): string | undefined {
	if (node.type !== "browser" || !node.metadata || (node.metadata.type !== BOARD_ITEM && node.metadata.type !== CARD_ITEM)) return undefined;
	const path = node.metadata.path;
	return typeof path === "string" && path ? path : undefined;
}

/** A board as a stage wants it: where it sits, and the size and title its file gives it. */
export interface BoardSpot {
	path: string;
	x: number;
	y: number;
	w: number;
	h: number;
	title: string;
	/**
	 * Whether the writer moved or sized the board itself. `false` leaves the item's place or size as the
	 * file has it, which another session on the stage may have changed; left out, the spot is the truth.
	 */
	moved?: boolean;
	sized?: boolean;
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
 * The agent a write to a drawing is made for, while one of its calls runs (`stage/tool.ts`): each
 * canvas remembers the last, and its placeholder frames are drawn in that agent's colour with its
 * name. A person's own edits leave it as it was.
 */
export const penWriter = new AsyncLocalStorage<string>();

/** Words measured as the page measures them (`text.ts`). */
const measure = serverText.measure;

const FILE = CANVAS_FILE;
/** How many of the person's edits each stage can take back. */
const HISTORY = 100;

export class StagePens {
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
	private framesWatchers = new Map<string, FSWatcher>();
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

	/** A write of a canvas, kept for whoever is told about it next. */
	private record(name: string, before: PenDocument | undefined, after: PenDocument, rev: number, by: Author): void {
		// A canvas's first write is from nothing.
		const ids = [...new Set(diff(before ?? emptyDocument(), after).flatMap((edit) => ("id" in edit ? [edit.id] : [])))];
		if (ids.length === 0) return;
		const log = this.changeLogs.get(name) ?? [];
		log.push({ rev, by, ids });
		if (log.length > CHANGE_LOG) log.splice(0, log.length - CHANGE_LOG);
		this.changeLogs.set(name, log);
		if (by.kind === "agent") {
			const set = this.writtenBy.get(by.id) ?? new Set<string>();
			set.add(name);
			this.writtenBy.set(by.id, set);
		}
	}

	/** The writes of a canvas after revision `rev`, oldest first. */
	changesSince(name: string, rev: number): ChangeRecord[] {
		return (this.changeLogs.get(name) ?? []).filter((record) => record.rev > rev);
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
		private deckPath: string,
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
			if (serialize(toDisk(name, entry.doc, this.adopt)) !== entry.text) this.write(name, entry.doc);
		} catch {
			/* a board it names cannot be copied in: left as it is, and drawn as missing */
		}
	}

	/** Refused, with a sentence, for a friend's canvas shared with you to view: its drawing follows theirs. */
	mayWrite(name: string): void {
		const shared = this.sharing(name);
		if (shared && shared.role !== "edit") throw new PenError(viewOnlySentence(this.titleOf(name), shared.ownerName ?? shared.owner, name));
	}

	/**
	 * How a canvas takes in a board or a frame from elsewhere: copied into its own folder
	 * (`stage/copy-in.ts`). Replaced by the app, which also tells the deck about the copy.
	 */
	adopt: Adopt = {
		board: (canvas, path) => this.copyIn(canvas, path),
		frame: (canvas, ref) => copyFrameInto(this.deckPath, ref, canvas),
		file: (canvas, deckPath) => copyFileInto(this.deckPath, deckPath, canvas),
	};

	/** Told of each copy a canvas makes, so the deck reads it at once (`app.ts`). */
	copied?: (path: string) => void;

	/** Copy a board into a canvas, and write down where the copy came from (`canvas.json`'s `copiedFrom`). */
	private copyIn(canvas: string, path: string): string {
		const copy = copyBoardInto(this.deckPath, path, canvas);
		const file = join(this.folderOf(canvas), CANVAS_META);
		let meta: Record<string, unknown> = {};
		try {
			meta = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		} catch {
			/* a canvas with no record yet */
		}
		const copied = meta.copiedFrom && typeof meta.copiedFrom === "object" ? (meta.copiedFrom as Record<string, string>) : {};
		writeFileSync(file, `${JSON.stringify({ ...meta, copiedFrom: { ...copied, [copy.slice(canvasFolder(canvas).length + 1)]: path } }, null, "\t")}\n`);
		this.copied?.(copy);
		return copy;
	}

	/**
	 * The canvas's own board for a deck path: the path itself when the board is the canvas's, else the
	 * copy the canvas already made of it (`copiedFrom`), else the path as it was. Copies nothing.
	 */
	copyOf(name: string, path: string): string {
		if ("path" in referenceFor(name, path)) return path;
		let copied: unknown;
		try {
			copied = (JSON.parse(readFileSync(join(this.folderOf(name), CANVAS_META), "utf8")) as { copiedFrom?: unknown }).copiedFrom;
		} catch {
			return path;
		}
		if (!copied || typeof copied !== "object") return path;
		for (const [reference, origin] of Object.entries(copied as Record<string, unknown>)) {
			const own = `${canvasFolder(name)}/${reference}`;
			if (origin === path && existsSync(join(this.deckPath, own))) return own;
		}
		return path;
	}

	/**
	 * The board a canvas places for a deck path, copied in now when the canvas has no copy of it yet
	 * (`stage/copy-in.ts`): what an agent's list of boards on its canvas is turned into, so the same
	 * library board asked for twice is one copy, not two. A path with no file is left as it is.
	 */
	ownPath(name: string, path: string): string {
		const known = this.copyOf(name, path);
		if (known !== path || "path" in referenceFor(name, path) || !existsSync(join(this.deckPath, path))) return known;
		return this.copyIn(name, path);
	}

	/** Whether a canvas is a friend's, shared with this deck: read here, written back only when they let you edit it. */
	isShared(name: string): boolean {
		return isSharedCanvas(name);
	}

	/**
	 * Who shared a friend's canvas, and as what (`canvas.json`, written by the sync when it came down,
	 * `studio/sync.ts`); undefined for one of this deck's own.
	 */
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
	 * asked about when the canvas has since filled with other things (`stage/canvas-name.ts`).
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
			boards = this.boards(name).map((one) => one.path);
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
		const placed = placements(this.withImported(name, doc), { theme, measure });
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
		const placed = placements(this.withImported(name, doc), { theme: baseTheme(doc, "light"), measure });
		if (reroute(doc, placed, (path) => boardBox(doc, placed, path) ?? boards(path), rustRouter)) this.write(name, doc);
	}

	/** Imported files, read once per change on disk: path → its modification time and document. */
	private readonly importCache = new Map<string, { mtime: number; doc: PenDocument }>();

	/**
	 * The document with the files it `imports` beside it (`IMPORTED`), for drawing and measuring:
	 * pen's `imports` names other `.pen` files by a short name, relative to this one, and a ref says
	 * `"name:id"` to use an item from one. One that is missing or does not parse is left out, and refs
	 * into it are drawn as missing. Never saved.
	 */
	withImported(name: string, doc: PenDocument): PenDocument {
		return this.withImportedAt(this.folderOf(name), doc);
	}

	/** The same, for a `.pen` file in `here` (a frame's folder, or a stage's). */
	private withImportedAt(here: string, doc: PenDocument): PenDocument {
		const imports = doc.imports && typeof doc.imports === "object" ? doc.imports : {};
		const out: Record<string, PenDocument> = {};
		this.addFrames(doc, out, this.framesBaseOf(here));
		for (const [short, rel] of Object.entries(imports)) {
			if (typeof rel !== "string" || !rel) continue;
			const file = resolvePath(here, rel);
			// Missing or broken: its refs show as missing.
			const imported = this.readPen(file);
			if (imported) out[short] = imported;
		}
		return Object.keys(out).length ? { ...doc, [IMPORTED]: out } : doc;
	}

	/** The deck's saved frames: `frames/<name>.pen`, beside `boards/`. */
	get framesDir(): string {
		return join(this.deckPath, "frames");
	}

	/** A file read through the import cache, or undefined when it is missing or does not parse. */
	private readPen(file: string): PenDocument | undefined {
		try {
			const mtime = statSync(file).mtimeMs;
			let cached = this.importCache.get(file);
			if (!cached || cached.mtime !== mtime) {
				cached = { mtime, doc: parse(readFileSync(file, "utf8")) };
				this.importCache.set(file, cached);
			}
			return cached.doc;
		} catch {
			return undefined;
		}
	}

	/**
	 * Every saved frame a document uses, by `ref: "frames/<name>"` (or `"frames/<name>:<id>"`) anywhere in
	 * it, its overrides included, and the frames those use in turn: as `IMPORTED["frames/<name>"]`, read
	 * from the deck's `frames/` folder with nothing to declare, as a board is placed by its path.
	 */
	/**
	 * Where `frames/<name>` is read from for a file in `here`: its canvas's folder, when it is in one
	 * (`deck/layout.ts`), and the deck, for a frame kept in the deck's own `frames/`.
	 */
	private framesBaseOf(here: string): string {
		const inside = relative(this.deckPath, here).split(sep).join("/");
		const at = inside && !inside.startsWith("..") ? canvasOfPath(`${inside}/x`) : undefined;
		return at ? join(this.deckPath, at.folder) : this.deckPath;
	}

	private addFrames(doc: PenDocument, out: Record<string, PenDocument>, base: string, depth = 0): void {
		if (depth > 8) return;
		const names = new Set<string>();
		const scan = (value: unknown): void => {
			if (Array.isArray(value)) value.forEach(scan);
			else if (value && typeof value === "object") {
				const ref = (value as { ref?: unknown }).ref;
				if (typeof ref === "string") {
					const found = /^((?:frames|boards)\/[A-Za-z0-9][\w.-]*(?:\/[A-Za-z0-9][\w.-]*)*)(?::|$)/.exec(ref);
					if (found) names.add(found[1]!);
				}
				for (const inner of Object.values(value)) if (inner && typeof inner === "object") scan(inner);
			}
		};
		scan(doc.children);
		// The folder may have been made after the server started: watch it once a frame is used.
		if (names.size) this.watchFrames();
		for (const key of names) {
			if (out[key]) continue;
			const saved = this.readPen(join(base, `${key}.pen`));
			if (!saved) continue;
			out[key] = saved;
			this.addFrames(saved, out, base, depth + 1);
		}
	}

	/**
	 * Save an item on a stage as a reusable frame, `frames/<name>.pen`, and put a ref to it in its place
	 * (unless `replace` is false). The file is a pen document whose one item is the frame, reusable, with
	 * the stage's variables and themes so its colours come with it. Saving over a name changes the frame
	 * everywhere it is used.
	 */
	saveFrame(stage: string, id: string, path: string, replace = true): { frame: string; ref: string; replaced: boolean; overwrote: boolean } {
		if (replace) this.mayWrite(stage);
		const entry = this.get(stage);
		if (entry.error) throw new PenError(`${entry.error}. Fix the file before saving from it.`);
		// A frame is saved in the canvas's own frames/, so the canvas still stands alone (`deck/layout.ts`).
		const target = this.penFile(/^\.?\/?frames\//.test(path.trim()) ? `${canvasFolder(stage)}/${path.trim().replace(/^\.?\/+/, "")}` : path);
		if (!target.ref) throw new PenError(`A frame is saved in frames/ or boards/: give a path there, such as "frames/agent-card" or "frames/ui/agent-card".`);
		const found = indexOf(entry.doc).get(id);
		if (!found) throw new PenError(`No item "${id}" on stage ${stage}: decks canvas read lists the items.`);
		const node = clone(found.node);
		const { x, y } = node;
		delete node.x;
		delete node.y;
		node.id = slug(basename(target.file, ".pen"), 60) || "frame";
		node.reusable = true;
		const overwrote = existsSync(target.file);
		const saved: PenDocument = { version: entry.doc.version || PEN_VERSION, ...(entry.doc.themes ? { themes: entry.doc.themes } : {}), ...(entry.doc.variables ? { variables: entry.doc.variables } : {}), children: [node] };
		this.writePen(target.file, saved);
		if (replace) {
			const ref: PenNode = { type: "ref", id, ref: target.ref, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) };
			this.edit(stage, [{ op: "replace", id, node: ref } as Op]);
		}
		this.resendFrame(target.ref, target.canvas);
		return { frame: target.shown, ref: target.ref, replaced: replace, overwrote };
	}

	/**
	 * A `.pen` file named by an agent: relative to the deck, as a board's path is (`"frames/ui/button"`,
	 * `"canvases/research-notes/canvas.pen"`), or an absolute path anywhere. `.pen` may be left off. Its deck-relative path to show, the stage it is when it is a
	 * stage's own file, and the ref that places it when it is a frame.
	 */
	penFile(path: string): { file: string; shown: string; stage?: string; ref?: string; canvas?: string } {
		const asked = typeof path === "string" ? path.trim() : "";
		if (!asked) throw new PenError("A .pen file needs a path relative to the deck, such as \"frames/agent-card\" or \"canvases/research-notes/canvas.pen\", or an absolute one.");
		// A path written before canvases moved out of stages/ still finds its canvas (`migrations/2026-10-16-stages-to-canvases.ts`).
		const relativeAsked = movedPath(asked.replace(/^\.?\/+/, ""), new Map());
		let file = isAbsolute(asked) ? resolvePath(asked) : resolvePath(this.deckPath, relativeAsked);
		if (!/\.[^/\\.]+$/.test(file)) file += ".pen";
		if (!file.endsWith(".pen")) throw new PenError(`${asked} is not a .pen file.`);
		// Shown relative to the deck when it is inside it, and as its full path when it is not.
		const inside = relative(this.deckPath, file);
		const outside = !inside || inside.startsWith("..") || isAbsolute(inside);
		const shown = outside ? file : inside.split(sep).join("/");
		const at = outside ? undefined : canvasOfPath(shown);
		if (at && at.rest === FILE) return { file, shown, stage: at.name };
		// A file in frames/ or boards/, the deck's or a canvas's own, is placed by its path there; the path is its ref, so it keeps to what a ref can say.
		const placed = at ? at.rest : shown;
		const ref = !outside && /^(?:frames|boards)\//.test(placed) ? placed.replace(/\.pen$/, "") : undefined;
		if (ref && !/^(?:frames|boards)\/[A-Za-z0-9][\w.-]*(?:\/[A-Za-z0-9][\w.-]*)*$/.test(ref)) throw new PenError(`${asked}: a path placed by ref is letters, digits, dots and dashes, in folders if you like, such as "frames/ui/agent-card".`);
		return { file, shown, ...(ref ? { ref } : {}), ...(at && ref ? { canvas: at.name } : {}) };
	}

	/**
	 * A frame named as a canvas names it (`frames/agent-card`), as the deck path of the file: the one in
	 * that canvas's own `frames/` when it has it, else the deck's own `frames/`, the library.
	 */
	frameOn(path: string, canvas?: string): string {
		const asked = path.trim().replace(/^\.?\/+/, "");
		if (!canvas || !/^frames\//.test(asked) || !canvasNameOk(canvas)) return asked;
		const own = `${canvasFolder(canvas)}/${asked}`;
		return existsSync(join(this.deckPath, /\.pen$/.test(own) ? own : `${own}.pen`)) ? own : asked;
	}

	/** A pen file's document, read fresh, with a sentence when it is missing or does not parse. */
	private loadPen(file: string, shown: string): PenDocument {
		let text: string;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			throw new PenError(`There is no ${shown}. Make it with decks frame create.`);
		}
		try {
			return parse(text);
		} catch (error) {
			throw new PenError(`${shown} does not parse: ${(error as Error).message}`);
		}
	}

	private writePen(file: string, doc: PenDocument): void {
		// A frame in a friend's canvas shared with you to view is theirs, as its drawing is.
		const at = canvasOfPath(relative(this.deckPath, file).split(sep).join("/"));
		if (at && isSharedCanvas(at.name)) this.mayWrite(at.name);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, serialize(doc));
		this.importCache.delete(file);
		this.watchFrames();
	}

	/**
	 * Any .pen file as a page draws it (`shot.html`, for `decks.canvas.screenshot`): its document with what it
	 * imports and the saved frames it uses, the folder its relative links resolve from, and the box
	 * round all its items. A stage's own file answers as the stage does, its boards included.
	 */
	fileFrame(path: string): { doc: PenDocument; base: string; box?: { x1: number; y1: number; x2: number; y2: number }; stage?: string } {
		const target = this.penFile(path);
		if (target.stage) return { doc: this.withImported(target.stage, this.get(target.stage).doc), base: `${fileUrl(this.folderOf(target.stage))}/`, stage: target.stage };
		const doc = this.withImportedAt(dirname(target.file), this.loadPen(target.file, target.shown));
		const placed = placements(doc, { theme: baseTheme(doc, "light"), measure });
		const boxes = doc.children.map((node) => placed.get(node.id)?.box).filter((box): box is NonNullable<typeof box> => !!box);
		const box = boxes.length
			? { x1: Math.min(...boxes.map((b) => b.x)), y1: Math.min(...boxes.map((b) => b.y)), x2: Math.max(...boxes.map((b) => b.x + b.w)), y2: Math.max(...boxes.map((b) => b.y + b.h)) }
			: undefined;
		return { doc, base: `${fileUrl(dirname(target.file))}/`, ...(box ? { box } : {}) };
	}

	/**
	 * A frame file, for the canvas calls given `{ frame }`: its document read fresh, how to lay it out
	 * with the frames it uses (refs resolve from its own folder), and the ref that places it.
	 */
	framePen(path: string): { doc: PenDocument; ref: string; shown: string; imported: (doc: PenDocument) => PenDocument } {
		const target = this.penFile(path);
		if (!target.ref?.startsWith("frames/")) throw new PenError(`${path} is not a frame: a frame is a .pen file in frames/, named as in { frame: "frames/agent-card" }. A canvas is named with { canvas }.`);
		const here = dirname(target.file);
		return { doc: this.loadPen(target.file, target.shown), ref: target.ref, shown: target.shown, imported: (doc) => this.withImportedAt(here, doc) };
	}

	/** What an agent reads of any .pen file: its items, each with its box in the file's own space. */
	readFile(path: string, more: ReadMore = {}) {
		const target = this.penFile(path);
		if (target.stage) return { ...this.read(target.stage, more), file: target.shown };
		const doc = this.loadPen(target.file, target.shown);
		const { theme, ...rest } = more;
		return { file: target.shown, ...(target.ref ? { ref: target.ref } : {}), ...read(this.withImportedAt(dirname(target.file), doc), { theme: themeFrom(doc, theme), measure, ...rest }) };
	}

	/** The same edits as a stage takes, on any .pen file; a frame's change reaches every stage that uses it. */
	editFile(path: string, ops: readonly Op[]): { file: string; ref?: string; results: Array<OpResult & { box?: { x1: number; y1: number; x2: number; y2: number } }> } {
		const target = this.penFile(path);
		const theme = (doc: PenDocument) => baseTheme(doc, "light");
		if (target.stage) {
			const { entry, results } = this.edit(target.stage, ops);
			const placed = placements(this.withImported(target.stage, entry.doc), { theme: theme(entry.doc), measure });
			return { file: target.shown, results: results.map((result) => withBox(result, placed)) };
		}
		const current = this.loadPen(target.file, target.shown);
		const { doc, results } = apply(withColors(current, ops), ops, { theme: theme(current), measure });
		this.writePen(target.file, doc);
		if (target.ref) this.resendFrame(target.ref, target.canvas);
		const placed = placements(this.withImportedAt(dirname(target.file), doc), { theme: theme(doc), measure });
		return { file: target.shown, ...(target.ref ? { ref: target.ref } : {}), results: results.map((result) => withBox(result, placed)) };
	}

	/**
	 * A new .pen file: `item` (a frame unless said otherwise) as its one reusable item, named for the
	 * file. In `frames/` it answers the ref that places it. Refused when the file is already there.
	 */
	createFile(path: string, item?: Partial<PenNode>): { file: string; ref?: string; id: string } {
		const target = this.penFile(path);
		if (target.stage) throw new PenError(`${target.shown} is a canvas; make one with decks canvas create.`);
		if (existsSync(target.file)) throw new PenError(`${target.shown} is already there: read it with decks canvas read --frame ${target.ref ?? path}, and change it with the canvas calls given { frame }.`);
		const id = slug(basename(target.file, ".pen"), 60) || "frame";
		const node = { type: "frame", layout: "vertical", width: 320, height: "fit_content", children: [], ...(item ?? {}), id, reusable: true } as PenNode;
		delete node.x;
		delete node.y;
		const doc = parse(serialize({ version: PEN_VERSION, children: [node] }));
		this.writePen(target.file, doc);
		return { file: target.shown, ...(target.ref ? { ref: target.ref } : {}), id };
	}

	/** Every stage that uses a saved frame, sent again with a new revision, so each copy shows the change. */
	private resendFrame(key: string, canvas?: string): void {
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

	/**
	 * A saved frame changed on disk (an agent's write, a person's edit, a save): every stage that uses
	 * it is sent again, so each copy shows the change, as a board's edit shows on every stage.
	 */
	watchFrames(): void {
		for (const folder of ["frames", "boards"]) {
			const dir = join(this.deckPath, folder);
			if (this.framesWatchers.has(folder) || !existsSync(dir)) continue;
			try {
				this.framesWatchers.set(folder, this.watchPens(folder, dir));
			} catch {
				// Without a watcher a frame's change shows when its stage is next sent.
			}
		}
	}

	/** `.pen` files under one folder, each change sent to the stages that place it. */
	private watchPens(folder: string, dir: string): FSWatcher {
		return watch(dir, { recursive: true }, (_event, file) => {
			if (!file || !String(file).endsWith(".pen")) return;
			const rel = String(file).split(sep).join("/");
			const key = `${folder}/${rel.replace(/\.pen$/, "")}`;
			this.importCache.delete(join(dir, String(file)));
			clearTimeout(this.pending.get(key));
			this.pending.set(
				key,
				setTimeout(() => {
					this.pending.delete(key);
					this.resendFrame(key);
				}, 80),
			);
		});
	}

	/** Where everything in a stage is, laid out once per version of the file. */
	placedOf(name: string): Map<string, Placed> {
		const entry = this.get(name);
		entry.placed ??= placements(this.withImported(name, entry.doc), { theme: baseTheme(entry.doc, "light"), measure });
		return entry.placed;
	}

	/** The deck boards on a stage, in paint order, each where the layout puts it. */
	boards(name: string): Array<{ path: string; id: string; x: number; y: number; w: number; h: number }> {
		const placed = this.placedOf(name);
		const out: Array<{ path: string; id: string; x: number; y: number; w: number; h: number }> = [];
		for (const node of walk(this.get(name).doc.children)) {
			const path = boardOf(node);
			const box = path ? placed.get(node.id)?.box : undefined;
			if (path && box && !out.some((one) => one.path === path)) out.push({ path, id: node.id, x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) });
		}
		return out;
	}

	/**
	 * Everything drawn on a stage that is not a board, as boxes: what a board joining the stage must
	 * not land on (`deck/place.ts`). Only top-level items, since a frame's box already holds what is
	 * in it. Arrows are left out: they run between things, and a board beside two others would
	 * always be sitting on the arrow joining them.
	 */
	drawn(name: string): Array<{ x: number; y: number; w: number; h: number }> {
		const out: Array<{ x: number; y: number; w: number; h: number }> = [];
		for (const { node, box, parent } of this.placedOf(name).values()) {
			if (parent !== undefined || boardOf(node) || node.metadata?.type === ARROW) continue;
			if (box.w > 0 && box.h > 0) out.push({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) });
		}
		return out;
	}

	/**
	 * Make the stage's boards these: add the ones missing, move and resize the ones that differ, and
	 * take away the rest. Writes only when something changed, and returns whether it did.
	 */
	syncBoards(name: string, given: readonly BoardSpot[]): boolean {
		const wanted = given.map((spot) => ({ ...spot, path: this.ownPath(name, spot.path) }));
		const entry = this.get(name);
		if (entry.error) return false;
		const placed = this.placedOf(name);
		const present = new Map<string, PenNode>();
		for (const node of walk(entry.doc.children)) {
			const path = boardOf(node);
			if (path && !present.has(path)) present.set(path, node);
		}
		const taken = ids(entry.doc);
		const ops: Op[] = [];
		for (const spot of wanted) {
			const node = present.get(spot.path);
			if (!node) {
				const base = slug(basename(spot.path).replace(/\.[^.]+$/, ""), 40) || "board";
				let id = base;
				for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
				taken.add(id);
				ops.push({
					op: "insert",
					node: { type: "browser", id, name: spot.title, url: `../../${spot.path}`, width: spot.w, height: spot.h, metadata: { type: pageTag(spot.path), path: spot.path } },
					box: { x1: spot.x, y1: spot.y },
				});
				continue;
			}
			const set: Record<string, unknown> = {};
			if (spot.sized !== false && node.width !== spot.w) set.width = spot.w;
			if (spot.sized !== false && node.height !== spot.h) set.height = spot.h;
			if (node.name !== spot.title) set.name = spot.title;
			const box = placed.get(node.id)?.box;
			const moved = spot.moved !== false && !!box && (Math.round(box.x) !== spot.x || Math.round(box.y) !== spot.y);
			if (Object.keys(set).length > 0 || moved) ops.push({ op: "update", id: node.id, set, ...(moved ? { box: { x1: spot.x, y1: spot.y } } : {}) });
		}
		const keep = new Set(wanted.map((spot) => spot.path));
		for (const [path, node] of present) if (!keep.has(path)) ops.push({ op: "delete", id: node.id });
		if (ops.length === 0) return false;
		this.edit(name, ops);
		return true;
	}

	/*
	 * Boards on a stage, changed one at a time in its file. These are the only writes of boards to a
	 * stage: whoever asks, a person on the canvas or an agent on its own stage, names the stage and
	 * the board, and nothing else in the file is touched. There is no copy of the stage anywhere else
	 * to fall out of step with it.
	 */

	/** Each board's item in a stage, by path. */
	private boardItems(name: string): Map<string, PenNode> {
		const present = new Map<string, PenNode>();
		for (const node of walk(this.get(name).doc.children)) {
			const path = boardOf(node);
			if (path && !present.has(path)) present.set(path, node);
		}
		return present;
	}

	/** Put boards on a stage, each at its corner and size; one already there keeps its place and size. */
	placeBoards(name: string, given: readonly BoardSpot[]): void {
		const spots = given.map((spot) => ({ ...spot, path: this.ownPath(name, spot.path) }));
		const entry = this.get(name);
		if (entry.error) return;
		const present = this.boardItems(name);
		const taken = ids(entry.doc);
		const ops: Op[] = [];
		for (const spot of spots) {
			const node = present.get(spot.path);
			if (node) {
				if (node.name !== spot.title) ops.push({ op: "update", id: node.id, set: { name: spot.title } });
				continue;
			}
			const base = slug(basename(spot.path).replace(/\.[^.]+$/, ""), 40) || "board";
			let id = base;
			for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
			taken.add(id);
			ops.push({ op: "insert", node: { type: "browser", id, name: spot.title, url: `../../${spot.path}`, width: spot.w, height: spot.h, metadata: { type: pageTag(spot.path), path: spot.path } }, box: { x1: spot.x, y1: spot.y } });
		}
		if (ops.length) this.edit(name, ops);
	}

	/** Move one board on a stage, its corner to `x y`. False when the stage does not hold it. */
	moveBoard(name: string, path: string, x: number, y: number): boolean {
		const node = this.boardItems(name).get(this.copyOf(name, path));
		if (!node) return false;
		const box = this.placedOf(name).get(node.id)?.box;
		if (box && Math.round(box.x) === Math.round(x) && Math.round(box.y) === Math.round(y)) return true;
		this.edit(name, [{ op: "update", id: node.id, set: {}, box: { x1: Math.round(x), y1: Math.round(y) } }]);
		return true;
	}

	/** Size one board on a stage. False when the stage does not hold it. */
	sizeBoard(name: string, path: string, size: { w?: number; h?: number }): boolean {
		const node = this.boardItems(name).get(this.copyOf(name, path));
		if (!node) return false;
		const set: Record<string, unknown> = {};
		if (size.w !== undefined && node.width !== Math.round(size.w)) set.width = Math.round(size.w);
		if (size.h !== undefined && node.height !== Math.round(size.h)) set.height = Math.round(size.h);
		if (Object.keys(set).length) this.edit(name, [{ op: "update", id: node.id, set }]);
		return true;
	}

	/** Take boards off a stage. */
	removeBoards(name: string, paths: readonly string[]): void {
		const present = this.boardItems(name);
		const ops: Op[] = [];
		for (const path of paths) {
			const node = present.get(this.copyOf(name, path));
			if (node) ops.push({ op: "delete", id: node.id });
		}
		if (ops.length) this.edit(name, ops);
	}

	/** Point a board's item at another file (a board copied into the stage's own folder), in the same place. */
	repointBoard(name: string, from: string, to: string): void {
		const node = this.boardItems(name).get(from);
		if (!node) return;
		this.edit(name, [{ op: "update", id: node.id, set: { url: `../../${to}`, metadata: { ...(node.metadata ?? {}), type: pageTag(to), path: to } } }]);
	}

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
		return { doc: this.withImported(name, this.get(name).doc), base: `${fileUrl(this.folderOf(name))}/` };
	}

	/**
	 * A drawing sent whole to one browser (asked again, opened, a picture of the stage) says it has the
	 * recent names and those still to be sent, and takes none: taken, they were never sent to the
	 * other browsers, whose edits then stayed on top of the drawing for six seconds.
	 */
	frame(agentId: string, name: string, made = [...(this.madeLately.get(name) ?? []), ...(this.made.get(name) ?? [])]): ServerMessage {
		const entry = this.get(name);
		const doc = this.withImported(name, entry.doc);
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

	/**
	 * What changed since the version last sent, as `stage.pen.delta` frames for these agents, or the
	 * whole drawing when nothing was sent before or the file does not read. Whatever made the change
	 * (an edit, arrows rerouting, undo, the file written by hand), the edits are worked out from the
	 * two versions, so they are always right.
	 */
	changes(agentIds: readonly string[], name: string): ServerMessage[] {
		const entry = this.get(name);
		const before = this.sent.get(name);
		const made = this.takeMade(name);
		if (!before || entry.error) return agentIds.map((id) => this.frame(id, name, this.madeLately.get(name) ?? made));
		const doc = this.withImported(name, entry.doc);
		const edits = diff(before.doc, doc);
		this.sent.set(name, { rev: entry.rev, doc });
		const base = `${fileUrl(this.folderOf(name))}/`;
		const by = this.writers.get(name);
		return agentIds.map((agentId) => ({ type: "stage.pen.delta", agentId, stage: name, from: before.rev, rev: entry.rev, edits, base, ...(made.length ? { made } : {}), ...(by ? { by } : {}) }));
	}

	/** Replace the document whole, from text that must parse. */
	replace(name: string, text: string): PenEntry {
		return this.write(name, toMemory(name, parse(text)));
	}

	/** What an agent reads: the file's items, each with its box on the stage. */
	read(name: string, more: ReadMore = {}) {
		const entry = this.get(name);
		const { theme, ...rest } = more;
		return { stage: name, file: this.fileOf(name), ...(entry.error ? { error: entry.error } : {}), ...read(this.withImported(name, entry.doc), { theme: themeFrom(entry.doc, theme), measure, ...rest }) };
	}

	private write(name: string, doc: PenDocument): PenEntry {
		this.mayWrite(name);
		const file = this.fileOf(name);
		mkdirSync(this.folderOf(name), { recursive: true });
		if (!this.watcher) this.watch();
		// Named from the canvas's own folder on disk, a board from elsewhere copied in first (`canvas-refs.ts`).
		const text = serialize(toDisk(name, doc, this.adopt));
		writeFileSync(file, text);
		doc = toMemory(name, parse(text));
		const previous = this.cache.get(name);
		const entry = { doc, rev: (previous?.rev ?? 0) + 1, mtime: statSync(file).mtimeMs, text };
		this.cache.set(name, entry);
		// An agent's call says so (`penWriter`); any other write here is the person's, from a page.
		const author = penWriter.getStore();
		this.record(name, previous?.doc, doc, entry.rev, author ? { kind: "agent", id: author } : { kind: "person" });
		const by = penEditBy.getStore();
		if (by) this.made.set(name, [...(this.made.get(name) ?? []), by]);
		const writer = penWriter.getStore();
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
		this.watchFrames();
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
			this.importCache.delete(join(this.folderOf(name), `${key}.pen`));
			clearTimeout(this.pending.get(`${name}:${key}`));
			this.pending.set(
				`${name}:${key}`,
				setTimeout(() => {
					this.pending.delete(`${name}:${key}`);
					this.resendFrame(key, name);
				}, 80),
			);
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

	setDeck(deckPath: string): void {
		runAtOpen(deckPath, { dataDir: dirname(deckPath) });
		this.deckPath = deckPath;
		this.cache.clear();
		this.importCache.clear();
		this.watch();
	}

	close(): void {
		this.watcher?.close();
		this.watcher = undefined;
		this.sharedWatcher?.close();
		this.sharedWatcher = undefined;
		for (const watcher of this.framesWatchers.values()) watcher.close();
		this.framesWatchers.clear();
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
function withColors(doc: PenDocument, ops: readonly Op[]): PenDocument {
	const colored = withDecksColors(doc, ops);
	if (colored.length === ops.length) return doc;
	return apply(doc, [colored[0] as Op], { theme: baseTheme(doc, "light"), measure }).doc;
}

function boardBox(doc: PenDocument, placed: ReadonlyMap<string, Placed>, path: string): Frame | undefined {
	for (const node of walk(doc.children)) if (boardOf(node) === path) return placed.get(node.id)?.box;
	return undefined;
}

/** A result with the box its item now has, from a layout of the file. */
function withBox(result: OpResult, placed: Map<string, Placed>): OpResult & { box?: { x1: number; y1: number; x2: number; y2: number } } {
	const at = result.op === "delete" ? undefined : placed.get(result.id);
	return at ? { ...result, box: { x1: at.box.x, y1: at.box.y, x2: at.box.x + at.box.w, y2: at.box.y + at.box.h } } : result;
}

