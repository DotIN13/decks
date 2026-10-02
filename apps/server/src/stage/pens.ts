import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";
import { apply, ARROW, baseTheme, clone, emptyDocument, ids, IMPORTED, indexOf, parse, PEN_VERSION, PenError, placements, read, reroute, serialize, walk, type Frame, type Op, type OpResult, type PenDocument, type PenNode, type Placed } from "@decks/pen";
import type { ServerMessage } from "@decks/protocol";
import { slug } from "../agents/slug.ts";
import { fileUrl } from "../deck/roots.ts";

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

/** The deck board an item stands for, by path, or undefined when it is not one. */
export function boardOf(node: PenNode): string | undefined {
	if (node.type !== "browser" || !node.metadata || node.metadata.type !== BOARD_ITEM) return undefined;
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

const FILE = "stage.pen";
/** How many of the person's edits each stage can take back. */
const HISTORY = 100;

export class StagePens {
	private readonly cache = new Map<string, PenEntry & { mtime: number; text: string }>();
	private watcher: FSWatcher | undefined;
	private framesWatchers = new Map<string, FSWatcher>();
	private pending = new Map<string, NodeJS.Timeout>();
	private readonly history = new Map<string, { undo: Array<{ before: string; after: string }>; redo: Array<{ before: string; after: string }> }>();

	constructor(
		private deckPath: string,
		private readonly changed: (name: string, entry: PenEntry) => void,
	) {}

	get dir(): string {
		return join(this.deckPath, "stages");
	}

	fileOf(name: string): string {
		return join(this.dir, name, FILE);
	}

	/** Every stage folder, drawn on or only claimed. */
	names(): string[] {
		if (!existsSync(this.dir)) return [];
		return readdirSync(this.dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
	}

	/**
	 * Take a folder for a new stage, named from a title; made now, so two agents cannot take one name.
	 * The title is kept as given. `provisional` is a name nobody chose for what is on the canvas —
	 * the agent's own, given to the canvas it lands on — which the agent is asked to replace
	 * (`naming`).
	 */
	claim(title: string, options: { provisional?: boolean } = {}): string {
		const name = this.freshName(title);
		mkdirSync(join(this.dir, name), { recursive: true });
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
			const parsed = JSON.parse(readFileSync(join(this.dir, name, "stage.json"), "utf8")) as { title?: unknown; provisional?: unknown; boards?: unknown };
			const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : undefined;
			const boards = Array.isArray(parsed.boards) ? parsed.boards.filter((one): one is string => typeof one === "string") : undefined;
			return { ...(title ? { title } : {}), provisional: parsed.provisional === true, ...(boards ? { boards } : {}) };
		} catch {
			/* no stage.json, or one that does not parse: no name but the folder's */
			return { provisional: false };
		}
	}

	/**
	 * Call a stage something else. Only the name changes; the folder, its boards and its drawing stay
	 * where they are. The boards on it now are written down with the name, as what it was named for.
	 */
	setTitle(name: string, title: string, options: { provisional?: boolean } = {}): string {
		if (!this.names().includes(name)) throw new Error(`No stage "${name}".`);
		const clean = title.replace(/\s+/g, " ").trim().slice(0, 80);
		if (!clean) throw new Error("A stage's name cannot be empty.");
		const file = join(this.dir, name, "stage.json");
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
		if (!this.names().includes(from)) throw new Error(`No stage "${from}".`);
		if (this.names().includes(to)) throw new Error(`A stage called "${to}" already exists.`);
		renameSync(join(this.dir, from), join(this.dir, to));
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
		if (!this.names().includes(name)) throw new Error(`No stage "${name}".`);
		rmSync(join(this.dir, name), { recursive: true, force: true });
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
			const doc = parse(text);
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
		const current = this.get(name);
		if (current.error) throw new PenError(`${current.error}. Fix the file, or replace it whole, before editing it.`);
		const theme = baseTheme(current.doc, "light");
		const { doc, results } = apply(current.doc, ops, { theme });
		const placed = placements(this.withImported(name, doc), { theme });
		reroute(doc, placed, (path) => boardBox(doc, placed, path) ?? boards?.(path));
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
		const entry = this.write(name, parse(direction === "undo" ? last.before : last.after));
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
		if (current.error || !existsSync(this.fileOf(name))) return;
		const doc = structuredClone(current.doc);
		const placed = placements(this.withImported(name, doc), { theme: baseTheme(doc, "light") });
		if (reroute(doc, placed, (path) => boardBox(doc, placed, path) ?? boards(path))) this.write(name, doc);
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
		return this.withImportedAt(join(this.dir, name), doc);
	}

	/** The same, for a `.pen` file in `here` (a frame's folder, or a stage's). */
	private withImportedAt(here: string, doc: PenDocument): PenDocument {
		const imports = doc.imports && typeof doc.imports === "object" ? doc.imports : {};
		const out: Record<string, PenDocument> = {};
		this.addFrames(doc, out);
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
	private addFrames(doc: PenDocument, out: Record<string, PenDocument>, depth = 0): void {
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
			const saved = this.readPen(join(this.deckPath, `${key}.pen`));
			if (!saved) continue;
			out[key] = saved;
			this.addFrames(saved, out, depth + 1);
		}
	}

	/**
	 * Save an item on a stage as a reusable frame, `frames/<name>.pen`, and put a ref to it in its place
	 * (unless `replace` is false). The file is a pen document whose one item is the frame, reusable, with
	 * the stage's variables and themes so its colours come with it. Saving over a name changes the frame
	 * everywhere it is used.
	 */
	saveFrame(stage: string, id: string, path: string, replace = true): { frame: string; ref: string; replaced: boolean; overwrote: boolean } {
		const entry = this.get(stage);
		if (entry.error) throw new PenError(`${entry.error}. Fix the file before saving from it.`);
		const target = this.penFile(path);
		if (!target.ref) throw new PenError(`A frame is saved in frames/ or boards/: give a path there, such as "frames/agent-card" or "frames/ui/agent-card".`);
		const found = indexOf(entry.doc).get(id);
		if (!found) throw new PenError(`No item "${id}" on stage ${stage}: stage.pen.read() lists the items.`);
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
		this.resendFrame(target.ref);
		return { frame: target.shown, ref: target.ref, replaced: replace, overwrote };
	}

	/**
	 * A `.pen` file named by an agent: relative to the deck, as a board's path is (`"frames/ui/button"`,
	 * `"stages/wren/stage.pen"`), or an absolute path anywhere. `.pen` may be left off. Its deck-relative path to show, the stage it is when it is a
	 * stage's own file, and the ref that places it when it is a frame.
	 */
	penFile(path: string): { file: string; shown: string; stage?: string; ref?: string } {
		const asked = typeof path === "string" ? path.trim() : "";
		if (!asked) throw new PenError("A .pen file needs a path relative to the deck, such as \"frames/agent-card\" or \"stages/wren/stage.pen\", or an absolute one.");
		let file = isAbsolute(asked) ? resolvePath(asked) : resolvePath(this.deckPath, asked.replace(/^\.?\/+/, ""));
		if (!/\.[^/\\.]+$/.test(file)) file += ".pen";
		if (!file.endsWith(".pen")) throw new PenError(`${asked} is not a .pen file.`);
		// Shown relative to the deck when it is inside it, and as its full path when it is not.
		const inside = relative(this.deckPath, file);
		const outside = !inside || inside.startsWith("..") || isAbsolute(inside);
		const shown = outside ? file : inside.split(sep).join("/");
		const stageMatch = /^stages\/([^/]+)\/stage\.pen$/.exec(shown);
		if (stageMatch) return { file, shown, stage: stageMatch[1]! };
		// A file in frames/ or boards/ is placed by its path; the path is its ref, so it keeps to what a ref can say.
		const ref = !outside && /^(?:frames|boards)\//.test(shown) ? shown.replace(/\.pen$/, "") : undefined;
		if (ref && !/^(?:frames|boards)\/[A-Za-z0-9][\w.-]*(?:\/[A-Za-z0-9][\w.-]*)*$/.test(ref)) throw new PenError(`${asked}: a path placed by ref is letters, digits, dots and dashes, in folders if you like, such as "frames/ui/agent-card".`);
		return { file, shown, ...(ref ? { ref } : {}) };
	}

	/** A pen file's document, read fresh, with a sentence when it is missing or does not parse. */
	private loadPen(file: string, shown: string): PenDocument {
		let text: string;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			throw new PenError(`There is no ${shown}. Make it with stage.pen.create.`);
		}
		try {
			return parse(text);
		} catch (error) {
			throw new PenError(`${shown} does not parse: ${(error as Error).message}`);
		}
	}

	private writePen(file: string, doc: PenDocument): void {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, serialize(doc));
		this.importCache.delete(file);
		this.watchFrames();
	}

	/**
	 * Any .pen file as a page draws it (`shot.html`, for `stage.screenshot`): its document with what it
	 * imports and the saved frames it uses, the folder its relative links resolve from, and the box
	 * round all its items. A stage's own file answers as the stage does, its boards included.
	 */
	fileFrame(path: string): { doc: PenDocument; base: string; box?: { x1: number; y1: number; x2: number; y2: number }; stage?: string } {
		const target = this.penFile(path);
		if (target.stage) return { doc: this.withImported(target.stage, this.get(target.stage).doc), base: `${fileUrl(join(this.dir, target.stage))}/`, stage: target.stage };
		const doc = this.withImportedAt(dirname(target.file), this.loadPen(target.file, target.shown));
		const placed = placements(doc, { theme: baseTheme(doc, "light") });
		const boxes = doc.children.map((node) => placed.get(node.id)?.box).filter((box): box is NonNullable<typeof box> => !!box);
		const box = boxes.length
			? { x1: Math.min(...boxes.map((b) => b.x)), y1: Math.min(...boxes.map((b) => b.y)), x2: Math.max(...boxes.map((b) => b.x + b.w)), y2: Math.max(...boxes.map((b) => b.y + b.h)) }
			: undefined;
		return { doc, base: `${fileUrl(dirname(target.file))}/`, ...(box ? { box } : {}) };
	}

	/** What an agent reads of any .pen file: its items, each with its box in the file's own space. */
	readFile(path: string) {
		const target = this.penFile(path);
		if (target.stage) return { ...this.read(target.stage), file: target.shown };
		const doc = this.loadPen(target.file, target.shown);
		return { file: target.shown, ...(target.ref ? { ref: target.ref } : {}), ...read(this.withImportedAt(dirname(target.file), doc), { theme: baseTheme(doc, "light") }) };
	}

	/** The same edits as a stage takes, on any .pen file; a frame's change reaches every stage that uses it. */
	editFile(path: string, ops: readonly Op[]): { file: string; ref?: string; results: Array<OpResult & { box?: { x1: number; y1: number; x2: number; y2: number } }> } {
		const target = this.penFile(path);
		const theme = (doc: PenDocument) => baseTheme(doc, "light");
		if (target.stage) {
			const { entry, results } = this.edit(target.stage, ops);
			const placed = placements(this.withImported(target.stage, entry.doc), { theme: theme(entry.doc) });
			return { file: target.shown, results: results.map((result) => withBox(result, placed)) };
		}
		const current = this.loadPen(target.file, target.shown);
		const { doc, results } = apply(current, ops, { theme: theme(current) });
		this.writePen(target.file, doc);
		if (target.ref) this.resendFrame(target.ref);
		const placed = placements(this.withImportedAt(dirname(target.file), doc), { theme: theme(doc) });
		return { file: target.shown, ...(target.ref ? { ref: target.ref } : {}), results: results.map((result) => withBox(result, placed)) };
	}

	/**
	 * A new .pen file: `item` (a frame unless said otherwise) as its one reusable item, named for the
	 * file. In `frames/` it answers the ref that places it. Refused when the file is already there.
	 */
	createFile(path: string, item?: Partial<PenNode>): { file: string; ref?: string; id: string } {
		const target = this.penFile(path);
		if (target.stage) throw new PenError(`${target.shown} is a stage; make one with stage.newStage.`);
		if (existsSync(target.file)) throw new PenError(`${target.shown} is already there: read it, or edit it with { path: "${path}" }.`);
		const id = slug(basename(target.file, ".pen"), 60) || "frame";
		const node = { type: "frame", layout: "vertical", width: 320, height: "fit_content", children: [], ...(item ?? {}), id, reusable: true } as PenNode;
		delete node.x;
		delete node.y;
		const doc = parse(serialize({ version: PEN_VERSION, children: [node] }));
		this.writePen(target.file, doc);
		return { file: target.shown, ...(target.ref ? { ref: target.ref } : {}), id };
	}

	/** Every stage that uses a saved frame, sent again with a new revision, so each copy shows the change. */
	private resendFrame(key: string): void {
		for (const [stage, entry] of this.cache) {
			if (!entry.text.includes(`"${key}`)) continue;
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
		entry.placed ??= placements(this.withImported(name, entry.doc), { theme: baseTheme(entry.doc, "light") });
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
	syncBoards(name: string, wanted: readonly BoardSpot[]): boolean {
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
				const base = slug(spot.path.replace(/^boards\//, "").replace(/\.[^.]+$/, ""), 40) || "board";
				let id = base;
				for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
				taken.add(id);
				ops.push({
					op: "insert",
					node: { type: "browser", id, name: spot.title, url: `../../${spot.path}`, width: spot.w, height: spot.h, metadata: { type: BOARD_ITEM, path: spot.path } },
					box: { x1: spot.x, y1: spot.y },
				});
				continue;
			}
			const set: Record<string, unknown> = {};
			if (node.width !== spot.w) set.width = spot.w;
			if (node.height !== spot.h) set.height = spot.h;
			if (node.name !== spot.title) set.name = spot.title;
			const box = placed.get(node.id)?.box;
			const moved = !!box && (Math.round(box.x) !== spot.x || Math.round(box.y) !== spot.y);
			if (Object.keys(set).length > 0 || moved) ops.push({ op: "update", id: node.id, set, ...(moved ? { box: { x1: spot.x, y1: spot.y } } : {}) });
		}
		const keep = new Set(wanted.map((spot) => spot.path));
		for (const [path, node] of present) if (!keep.has(path)) ops.push({ op: "delete", id: node.id });
		if (ops.length === 0) return false;
		this.edit(name, ops);
		return true;
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
	frame(agentId: string, name: string): ServerMessage {
		const entry = this.get(name);
		return { type: "stage.pen", agentId, stage: name, rev: entry.rev, doc: this.withImported(name, entry.doc), base: `${fileUrl(join(this.dir, name))}/`, ...(entry.error ? { error: entry.error } : {}) };
	}

	/** Replace the document whole, from text that must parse. */
	replace(name: string, text: string): PenEntry {
		return this.write(name, parse(text));
	}

	/** What an agent reads: the file's items, each with its box on the stage. */
	read(name: string) {
		const entry = this.get(name);
		return { stage: name, file: this.fileOf(name), ...(entry.error ? { error: entry.error } : {}), ...read(this.withImported(name, entry.doc), { theme: baseTheme(entry.doc, "light") }) };
	}

	private write(name: string, doc: PenDocument): PenEntry {
		const file = this.fileOf(name);
		mkdirSync(join(this.dir, name), { recursive: true });
		if (!this.watcher) this.watch();
		const text = serialize(doc);
		writeFileSync(file, text);
		const previous = this.cache.get(name);
		const entry = { doc, rev: (previous?.rev ?? 0) + 1, mtime: statSync(file).mtimeMs, text };
		this.cache.set(name, entry);
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
		// No folder yet is no stage yet: `claim` and `write` start watching when they make one.
		if (!existsSync(this.dir)) return;
		try {
			this.watcher = watch(this.dir, { recursive: true }, (_event, file) => {
				if (!file) return;
				const parts = String(file).split(/[\\/]/);
				if (parts.length !== 2 || parts[1] !== FILE) return;
				const name = parts[0]!;
				clearTimeout(this.pending.get(name));
				this.pending.set(
					name,
					setTimeout(() => {
						this.pending.delete(name);
						const before = this.cache.get(name);
						const after = this.get(name);
						if (after !== before || after.rev !== before?.rev) this.changed(name, after);
					}, 80),
				);
			});
		} catch {
			// A platform without recursive watching still works: edits through the tool are announced
			// by `write`, and a hand edit is read the next time anything asks.
		}
	}

	setDeck(deckPath: string): void {
		this.deckPath = deckPath;
		this.cache.clear();
		this.importCache.clear();
		this.watch();
	}

	close(): void {
		this.watcher?.close();
		this.watcher = undefined;
		for (const watcher of this.framesWatchers.values()) watcher.close();
		this.framesWatchers.clear();
		for (const timer of this.pending.values()) clearTimeout(timer);
		this.pending.clear();
	}
}

/** A board's box on this stage, found by path, for an arrow that ends on it. */
function boardBox(doc: PenDocument, placed: ReadonlyMap<string, Placed>, path: string): Frame | undefined {
	for (const node of walk(doc.children)) if (boardOf(node) === path) return placed.get(node.id)?.box;
	return undefined;
}

/** A result with the box its item now has, from a layout of the file. */
function withBox(result: OpResult, placed: Map<string, Placed>): OpResult & { box?: { x1: number; y1: number; x2: number; y2: number } } {
	const at = result.op === "delete" ? undefined : placed.get(result.id);
	return at ? { ...result, box: { x1: at.box.x, y1: at.box.y, x2: at.box.x + at.box.w, y2: at.box.y + at.box.h } } : result;
}
