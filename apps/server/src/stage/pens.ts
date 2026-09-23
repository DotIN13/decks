import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { apply, baseTheme, emptyDocument, ids, parse, PenError, placements, read, reroute, serialize, walk, type Frame, type Op, type OpResult, type PenDocument, type PenNode, type Placed } from "@decks/pen";
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

	/** Take a folder for a new stage, named from a title; made now, so two agents cannot take one name. */
	claim(title: string): string {
		const name = this.freshName(title);
		mkdirSync(join(this.dir, name), { recursive: true });
		if (!this.watcher) this.watch();
		return name;
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
		const placed = placements(doc, { theme });
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
		const placed = placements(doc, { theme: baseTheme(doc, "light") });
		if (reroute(doc, placed, (path) => boardBox(doc, placed, path) ?? boards(path))) this.write(name, doc);
	}

	/** Where everything in a stage is, laid out once per version of the file. */
	placedOf(name: string): Map<string, Placed> {
		const entry = this.get(name);
		entry.placed ??= placements(entry.doc, { theme: baseTheme(entry.doc, "light") });
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

	/** The `stage.pen` frame for one agent looking at this stage. */
	frame(agentId: string, name: string): ServerMessage {
		const entry = this.get(name);
		return { type: "stage.pen", agentId, stage: name, rev: entry.rev, doc: entry.doc, base: `${fileUrl(join(this.dir, name))}/`, ...(entry.error ? { error: entry.error } : {}) };
	}

	/** Replace the document whole, from text that must parse. */
	replace(name: string, text: string): PenEntry {
		return this.write(name, parse(text));
	}

	/** What an agent reads: the file's items, each with its box on the stage. */
	read(name: string) {
		const entry = this.get(name);
		return { stage: name, file: this.fileOf(name), ...(entry.error ? { error: entry.error } : {}), ...read(entry.doc, { theme: baseTheme(entry.doc, "light") }) };
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
		this.watch();
	}

	close(): void {
		this.watcher?.close();
		this.watcher = undefined;
		for (const timer of this.pending.values()) clearTimeout(timer);
		this.pending.clear();
	}
}

/** A board's box on this stage, found by path, for an arrow that ends on it. */
function boardBox(doc: PenDocument, placed: ReadonlyMap<string, Placed>, path: string): Frame | undefined {
	for (const node of walk(doc.children)) if (boardOf(node) === path) return placed.get(node.id)?.box;
	return undefined;
}
