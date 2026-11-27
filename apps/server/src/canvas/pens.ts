import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Author } from "./log.ts";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { rustRouter } from "./arrows.ts";
import { CANVAS_DIR, CANVAS_FILE, CANVAS_META } from "./canvas-files.ts";
import { join } from "node:path";
import { apply, baseTheme, withDecksColors, emptyDocument, ids, parse, PenError, placements, read, reroute, serialize, themeFrom, walk, type Frame, type Op, type OpResult, type PenDocument, type PenNode, type Placed, type ReadOptions } from "@decks/pen";

import { serverText } from "./text.ts";
import { CanvasCards } from "./cards-on.ts";
import { PenFiles } from "./pen-files.ts";
import { CanvasRights } from "./rights.ts";
import { CanvasLog } from "./log.ts";
import { slug } from "@decks/deck-kit";
import { fileUrl } from "../deck/roots.ts";
import { canvasFolder, canvasNameOk, isSharedCanvas, plainSegment, SHARED_CANVASES, sharedName } from "@decks/hub/layout";
import { toDisk, toMemory } from "./canvas-refs.ts";

/** What a read may ask for beyond the whole file: one item, a depth, values worked out, in a theme such as { mode: "dark" } (`read.ts`). */
export type ReadMore = Omit<ReadOptions, "theme" | "measure"> & { theme?: Record<string, string> };

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
export function cardOf(node: PenNode): string | undefined {
	if (node.type !== "browser" || !node.metadata || node.metadata.type !== CARD_ITEM) return undefined;
	const path = node.metadata.path;
	return typeof path === "string" && path ? path : undefined;
}

/**
 * The canvases' drawings, kept: each `canvases/<name>/canvas.pen` in the deck, read, written and watched.
 *
 * A canvas's drawing (notes, shapes, arrows, text, frames, and its cards as `browser` items) is a
 * native pen.dev document, saved as pen.dev saves one, so the folder opens in pen.dev as it is.
 * This is the one writer the server has: edits come in as pen operations (`@decks/pen`'s `apply`),
 * are checked, and are written whole. An agent may also edit the file with its own tools; the
 * watcher picks that up, and a file that no longer parses is reported rather than drawn half
 * broken: the last good version stays on the canvas until it is fixed.
 *
 * Here: the files themselves, their names and titles, reading one and editing one. What else a
 * canvas's drawing involves is a part with one job each, held here and asked through it:
 *
 * - `cards` (`cards-on.ts`): the cards a canvas places;
 * - `files` (`pen-files.ts`): saved frames and any `.pen` file by its path;
 * - `rights` (`rights.ts`): whose a canvas is and what you may do to it;
 * - `log` (`log.ts`): what was written and by whom, the person's undo, and what the pages are sent.
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
	/** `text` as a short hash, worked out the first time it is asked for (`summary`). */
	shot?: string;
}

/**
 * The person's own name for the edit being made, when the browser gave one (`x-decks-edit` on a verb's
 * request, `edit` on the socket's): set around the call that makes it, read when the drawing is written,
 * and sent back with the revision that has it (`made` on `canvas.changed`). The browser
 * shows its edit at once and keeps it on top of what the server sends until that revision comes
 * (`canvas/src/model/drawing.ts`), so it never draws the drawing as it was before for the round trip.
 */
export const penEditBy = new AsyncLocalStorage<string>();

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
export const penOrigin = new AsyncLocalStorage<Author>();

/** Words measured as the page measures them (`text.ts`). */
export const measure = serverText.measure;

const FILE = CANVAS_FILE;

export class CanvasPens {
	/** The cards on each canvas: placed, moved, sized, taken off, and copied in from another canvas (`cards-on.ts`). */
	readonly cards: CanvasCards = new CanvasCards(this);
	/** Saved frames and any other `.pen` file by its path: read, edited, made, placed by a ref, and watched (`pen-files.ts`). */
	readonly files: PenFiles = new PenFiles(this);
	/** Whose each canvas is and what you may do to it: yours, shared with others, or a friend's to edit or only to view (`rights.ts`). */
	readonly rights: CanvasRights = new CanvasRights(this);
	/** What was written to each canvas, by whom: for the agents' news, the person's undo, and what the pages are sent (`log.ts`). */
	readonly log: CanvasLog = new CanvasLog(this);
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

	/** Whether a canvas of this name exists, without listing them all. */
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

	/**
	 * Take a folder for a new canvas, named from a title; made now, so two agents cannot take one name.
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
	 * A canvas's name as the person reads it, which is not its folder's.
	 *
	 * The folder is the canvas's id — agents open it, card paths run through it, and a camera is
	 * kept under it — so it is a slug made once and never moved. The name beside it, in
	 * `stage.json`, is whatever the person or an agent calls the canvas, spaces, capitals and all,
	 * and changing it touches nothing else. A canvas with no `stage.json` is called by its folder.
	 */
	titleOf(name: string): string {
		return this.naming(name).title ?? name;
	}

	/**
	 * How a canvas came by its name: the name, whether anybody chose it (`provisional` when it is the
	 * agent's own, given at claim), and the cards it held when it was named — what an agent is
	 * asked about when the canvas has since filled with other things (`canvas/canvas-name.ts`).
	 */
	naming(name: string): { title?: string; provisional: boolean; boards?: string[] } {
		try {
			const parsed = JSON.parse(readFileSync(join(this.folderOf(name), CANVAS_META), "utf8")) as { title?: unknown; provisional?: unknown; boards?: unknown };
			const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : undefined;
			const cards = Array.isArray(parsed.boards) ? parsed.boards.filter((one): one is string => typeof one === "string") : undefined;
			return { ...(title ? { title } : {}), provisional: parsed.provisional === true, ...(cards ? { boards: cards } : {}) };
		} catch {
			/* no canvas.json, or one that does not parse: no name but the folder's */
			return { provisional: false };
		}
	}

	/**
	 * Call a canvas something else. Only the name changes; the folder, its cards and its drawing stay
	 * where they are. The cards on it now are written down with the name, as what it was named for.
	 */
	setTitle(name: string, title: string, options: { provisional?: boolean } = {}): string {
		if (!this.names().includes(name)) throw new Error(`No canvas "${name}".`);
		this.rights.mayWrite(name);
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
		let cards: string[] = [];
		try {
			cards = this.cards.cards(name).map((one) => one.path);
		} catch {
			/* a stage with no drawing yet holds no boards */
		}
		writeFileSync(file, `${JSON.stringify({ ...rest, title: clean, boards: cards, ...(options.provisional ? { provisional: true } : {}) }, null, "\t")}\n`);
		return clean;
	}

	/**
	 * Move a canvas to a new folder name, drawing and all. Card items whose path `repoint` changes
	 * (cards kept in the canvas's own folder, which moved with it) are pointed at the new path in
	 * place, so their ids — and any arrow joined to them — stay as they were.
	 */
	rename(from: string, to: string, repoint: (path: string) => string): void {
		if (!this.names().includes(from)) throw new Error(`No canvas "${from}".`);
		if (this.names().includes(to)) throw new Error(`A canvas called "${to}" already exists.`);
		renameSync(this.folderOf(from), this.folderOf(to));
		this.former.set(to, [...(this.former.get(from) ?? []), from]);
		this.former.delete(from);
		this.cache.delete(from);
		this.log.moved(from, to);
		const ops: Op[] = [];
		for (const node of walk(this.get(to).doc.children)) {
			const path = cardOf(node);
			if (!path || repoint(path) === path) continue;
			const next = repoint(path);
			ops.push({ op: "update", id: node.id, set: { url: `../../${next}`, metadata: { ...node.metadata, path: next } } });
		}
		if (ops.length > 0) this.edit(to, ops, undefined, { undoable: false });
	}

	/** Delete a canvas: its folder, its drawing and any cards kept in it. */
	remove(name: string): void {
		if (!this.names().includes(name)) throw new Error(`No canvas "${name}".`);
		rmSync(this.folderOf(name), { recursive: true, force: true });
		this.cache.delete(name);
		this.log.forget(name);
	}

	/** A folder name for a new canvas, from a title, not already taken by a file or by `alsoTaken`. */
	freshName(title: string, alsoTaken: Iterable<string> = []): string {
		const base = slug(title, 40) || "stage";
		const taken = new Set([...this.names(), ...alsoTaken]);
		if (!taken.has(base)) return base;
		for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
	}

	/** The document as it stands, read from disk when the file changed. A canvas with no file is empty. */
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
	 * (`@decks/pen`'s `reroute`). `boards` finds a card by path, for an arrow that ends on one.
	 */
	edit(name: string, ops: readonly Op[], cards?: (path: string) => Frame | undefined, options?: { undoable?: boolean }): { entry: PenEntry; results: OpResult[] } {
		this.rights.mayWrite(name);
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
		reroute(doc, placed, (path) => cardBox(doc, placed, path) ?? cards?.(path), rustRouter);
		const before = current.text ?? serialize(current.doc);
		const entry = this.write(name, doc);
		if (options?.undoable) this.log.undoable(name, before, entry.text!);
		return { entry, results };
	}

	/**
	 * Redraw a canvas's arrows because something outside the file moved — a card an arrow ends on.
	 * Written only when an arrow actually changed.
	 */
	follow(name: string, cards: (path: string) => Frame | undefined): void {
		const current = this.get(name);
		if (current.error || !existsSync(this.fileOf(name)) || this.rights.sharing(name)?.role === "view") return;
		const doc = structuredClone(current.doc);
		const placed = placements(this.files.withImported(name, doc), { theme: baseTheme(doc, "light"), measure });
		if (reroute(doc, placed, (path) => cardBox(doc, placed, path) ?? cards(path), rustRouter)) this.write(name, doc);
	}

	/** Where everything in a canvas is, laid out once per version of the file. */
	placedOf(name: string): Map<string, Placed> {
		const entry = this.get(name);
		entry.placed ??= placements(this.files.withImported(name, entry.doc), { theme: baseTheme(entry.doc, "light"), measure });
		return entry.placed;
	}

	/*
	 * Cards on a canvas, changed one at a time in its file. These are the only writes of cards to a
	 * canvas: whoever asks, a person on the canvas or an agent on its own canvas, names the canvas and
	 * the card, and nothing else in the file is touched. There is no copy of the canvas anywhere else
	 * to fall out of step with it.
	 */

	/**
	 * What one canvas holds, for the manager's list: how many cards, and the words in it.
	 *
	 * The words are what the manager's search matches beyond the name — every card's title and
	 * every note's text — gathered here because this is the only place that reads the file. A
	 * canvas with a file that does not parse still answers, from the last good document.
	 *
	 * `shot` is what a picture of the canvas is kept and asked for by (`shots.ts`, `thumb`): the
	 * drawing's text as a short hash. `rev` cannot do it, since it counts from 1 again each time the
	 * harness starts, so a picture kept as revision 1 weeks ago was shown as today's after a restart.
	 * The hash is the same until the drawing changes, whichever run of the harness reads it. A saved
	 * frame or a card's content changing does not change it: the picture follows at the next edit.
	 */
	summary(name: string): { boards: number; rev: number; shot: string; words: string } {
		const entry = this.get(name);
		const words: string[] = [];
		let cards = 0;
		for (const node of walk(entry.doc.children)) {
			if (cardOf(node)) cards += 1;
			if (typeof node.name === "string" && node.name) words.push(node.name);
			const content = (node as { content?: unknown }).content;
			if (typeof content === "string" && content) words.push(content);
		}
		entry.shot ??= entry.text === undefined ? "0" : createHash("sha1").update(entry.text).digest("hex").slice(0, 12);
		return { boards: cards, rev: entry.rev, shot: entry.shot, words: words.join(" ").replace(/\s+/g, " ").slice(0, 600) };
	}

	/** The `stage.pen` frame for one agent looking at this canvas. */
	/** A canvas's drawing as the page is given it (imports in place) and the folder its fills are read against, without counting as sent. */
	drawingOf(name: string): { doc: PenDocument; base: string } {
		return { doc: this.files.withImported(name, this.get(name).doc), base: `${fileUrl(this.folderOf(name))}/` };
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

	/** What an agent reads: the file's items, each with its box on the canvas. */
	read(name: string, more: ReadMore = {}) {
		const entry = this.get(name);
		const { theme, ...rest } = more;
		return { stage: name, file: this.fileOf(name), ...(entry.error ? { error: entry.error } : {}), ...read(this.files.withImported(name, entry.doc), { theme: themeFrom(entry.doc, theme), measure, ...rest }) };
	}

	/** Write a drawing back as text it once was: the person's undo and redo (`log.ts`). */
	putBack(name: string, text: string): PenEntry {
		return this.write(name, toMemory(name, parse(text)));
	}

	private write(name: string, doc: PenDocument, options: { unchecked?: boolean } = {}): PenEntry {
		if (!options.unchecked) this.rights.mayWrite(name);
		const file = this.fileOf(name);
		mkdirSync(this.folderOf(name), { recursive: true });
		if (!this.watcher) this.watch();
		// Named from the canvas's own folder on disk, a card from elsewhere copied in first (`canvas-refs.ts`).
		const text = serialize(toDisk(name, doc, this.cards.adopt));
		writeFileSync(file, text);
		doc = toMemory(name, parse(text));
		const previous = this.cache.get(name);
		const entry = { doc, rev: (previous?.rev ?? 0) + 1, mtime: statSync(file).mtimeMs, text };
		this.cache.set(name, entry);
		this.log.written(name, previous?.doc, doc, entry.rev);
		this.changed(name, entry);
		return entry;
	}

	/**
	 * Notice hand edits: an agent writing `stage.pen` with its own tools, or a person saving from
	 * pen.dev. Debounced per canvas, and a write that matches what the server wrote is not news.
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
						if (!after.error) this.log.fileChanged(name, before?.doc, after.doc, after.rev);
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
		// No folder yet is no canvas yet: `claim` and `write` start watching when they make one.
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

	/** Every canvas that uses a saved frame, sent again with a new revision, so each copy shows the change. */
	resendUsing(key: string, canvas?: string): void {
		for (const [stage, entry] of this.cache) {
			if (!entry.text.includes(`"${key}`)) continue;
			// A canvas's own frame is that canvas's; the deck's is any canvas's that has no copy of its own.
			if (canvas ? stage !== canvas : existsSync(join(this.folderOf(stage), `${key}.pen`))) continue;
			// A new revision, so the canvas takes it as news and lays the canvas out again.
			const next = { ...entry, rev: entry.rev + 1, placed: undefined };
			this.cache.set(stage, next);
			this.changed(stage, next);
		}
	}

	setDeck(deckPath: string): void {
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

/** A card's box on this canvas, found by path, for an arrow that ends on it. */
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

function cardBox(doc: PenDocument, placed: ReadonlyMap<string, Placed>, path: string): Frame | undefined {
	for (const node of walk(doc.children)) if (cardOf(node) === path) return placed.get(node.id)?.box;
	return undefined;
}

/** A result with the box its item now has, from a layout of the file. */
export function withBox(result: OpResult, placed: Map<string, Placed>): OpResult & { box?: { x1: number; y1: number; x2: number; y2: number } } {
	const at = result.op === "delete" ? undefined : placed.get(result.id);
	return at ? { ...result, box: { x1: at.box.x, y1: at.box.y, x2: at.box.x + at.box.w, y2: at.box.y + at.box.h } } : result;
}

