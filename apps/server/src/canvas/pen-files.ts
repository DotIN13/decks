import { existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { CANVAS_FILE, movedPath } from "./canvas-files.ts";
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";
import { apply, baseTheme, clone, IMPORTED, indexOf, parse, PEN_VERSION, PenError, placements, read, serialize, themeFrom, type Frame, type Op, type OpResult, type PenDocument, type PenNode } from "@decks/pen";
import { slug } from "@decks/deck-kit";
import { fileUrl } from "../deck/roots.ts";
import { canvasFolder, canvasNameOk, canvasOfPath, isSharedCanvas } from "@decks/hub/layout";
import { measure, withBox, withColors, type ReadMore, type StagePens } from "./pens.ts";

/**
 * Saved frames, and any other `.pen` file named by its path.
 *
 * A canvas's drawing may place a saved frame by a ref (`frames/ui/card`), which is a `.pen` file of
 * its own in the canvas's `frames/` (or the deck's, from before canvases kept their own). Here those
 * files are read with the frames they in turn place, edited, made and saved from an item, and watched,
 * so a change to one shows on every canvas placing it.
 */

export class PenFiles {
	/** Frame files that changed and wait a moment, so one save is one message. */
	private readonly settling = new Map<string, NodeJS.Timeout>();

	constructor(private readonly of: StagePens) {}

	/**
	 * A frame's file changed, by anyone: it is read again when next placed, and every canvas using it
	 * is sent again, a moment later. `canvas`: one canvas's own frame, which is that canvas's alone.
	 */
	changed(file: string, key: string, canvas?: string): void {
		this.importCache.delete(file);
		const waiting = canvas ? `${canvas}:${key}` : key;
		clearTimeout(this.settling.get(waiting));
		this.settling.set(
			waiting,
			setTimeout(() => {
				this.settling.delete(waiting);
				this.of.resendUsing(key, canvas);
			}, 80),
		);
	}

	/** Another deck is open: nothing read from the last one is kept. */
	forget(): void {
		this.importCache.clear();
	}

	close(): void {
		for (const watcher of this.framesWatchers.values()) watcher.close();
		this.framesWatchers.clear();
		for (const timer of this.settling.values()) clearTimeout(timer);
		this.settling.clear();
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
		return this.withImportedAt(this.of.folderOf(name), doc);
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
		return join(this.of.deckPath, "frames");
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
		const inside = relative(this.of.deckPath, here).split(sep).join("/");
		const at = inside && !inside.startsWith("..") ? canvasOfPath(`${inside}/x`) : undefined;
		return at ? join(this.of.deckPath, at.folder) : this.of.deckPath;
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
		if (replace) this.of.mayWrite(stage);
		const entry = this.of.get(stage);
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
			this.of.edit(stage, [{ op: "replace", id, node: ref } as Op]);
		}
		this.of.resendUsing(target.ref, target.canvas);
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
		// A path written before canvases moved out of stages/ still finds its canvas (`canvas-files.ts`).
		const relativeAsked = movedPath(asked.replace(/^\.?\/+/, ""), new Map());
		let file = isAbsolute(asked) ? resolvePath(asked) : resolvePath(this.of.deckPath, relativeAsked);
		if (!/\.[^/\\.]+$/.test(file)) file += ".pen";
		if (!file.endsWith(".pen")) throw new PenError(`${asked} is not a .pen file.`);
		// Shown relative to the deck when it is inside it, and as its full path when it is not.
		const inside = relative(this.of.deckPath, file);
		const outside = !inside || inside.startsWith("..") || isAbsolute(inside);
		const shown = outside ? file : inside.split(sep).join("/");
		const at = outside ? undefined : canvasOfPath(shown);
		if (at && at.rest === CANVAS_FILE) return { file, shown, stage: at.name };
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
		return existsSync(join(this.of.deckPath, /\.pen$/.test(own) ? own : `${own}.pen`)) ? own : asked;
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
		const at = canvasOfPath(relative(this.of.deckPath, file).split(sep).join("/"));
		if (at && isSharedCanvas(at.name)) this.of.mayWrite(at.name);
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
		if (target.stage) return { doc: this.withImported(target.stage, this.of.get(target.stage).doc), base: `${fileUrl(this.of.folderOf(target.stage))}/`, stage: target.stage };
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
		if (target.stage) return { ...this.of.read(target.stage, more), file: target.shown };
		const doc = this.loadPen(target.file, target.shown);
		const { theme, ...rest } = more;
		return { file: target.shown, ...(target.ref ? { ref: target.ref } : {}), ...read(this.withImportedAt(dirname(target.file), doc), { theme: themeFrom(doc, theme), measure, ...rest }) };
	}

	/** The same edits as a stage takes, on any .pen file; a frame's change reaches every stage that uses it. */
	editFile(path: string, ops: readonly Op[]): { file: string; ref?: string; results: Array<OpResult & { box?: { x1: number; y1: number; x2: number; y2: number } }> } {
		const target = this.penFile(path);
		const theme = (doc: PenDocument) => baseTheme(doc, "light");
		if (target.stage) {
			const { entry, results } = this.of.edit(target.stage, ops);
			const placed = placements(this.withImported(target.stage, entry.doc), { theme: theme(entry.doc), measure });
			return { file: target.shown, results: results.map((result) => withBox(result, placed)) };
		}
		const current = this.loadPen(target.file, target.shown);
		const { doc, results } = apply(withColors(current, ops), ops, { theme: theme(current), measure });
		this.writePen(target.file, doc);
		if (target.ref) this.of.resendUsing(target.ref, target.canvas);
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

	private framesWatchers = new Map<string, FSWatcher>();

	/**
	 * A saved frame changed on disk (an agent's write, a person's edit, a save): every stage that uses
	 * it is sent again, so each copy shows the change, as a board's edit shows on every stage.
	 */
	watchFrames(): void {
		for (const folder of ["frames", "boards"]) {
			const dir = join(this.of.deckPath, folder);
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
			this.changed(join(dir, String(file)), key);
		});
	}
}
