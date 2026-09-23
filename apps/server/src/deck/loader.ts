import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { Board, DeckState } from "@decks/protocol";
import { DECK_DIR } from "../config.ts";
import { readMeta } from "./meta.ts";
import { defaultWidth, formatOf, isBoardFile, liveKindOf, shellFor, slideHeight } from "./kinds.ts";
import { resolveInDeck, resolveRoots, type ResolvedRoots } from "./roots.ts";
import { syncRuntimeLib } from "./lib-sync.ts";
import { declaredRoots, normalizeBoardPath, parseDeckFile, serializeDeckFile, type DeckFile } from "./schema.ts";

/**
 * A board's height until a frame measures it, and a *foreign* one's for good.
 *
 * The short one, because a board that grows into its content on load looks like it is arriving where
 * one that shrinks looks broken. The long one, because a sandboxed document from somewhere else
 * cannot measure itself at all, so its placeholder has to be a usable page rather than a box that
 * grows.
 */
const START_H = 240;
const FOREIGN_H = 600;
/** Space between auto-placed boards, and how many go in a row before wrapping. */
const GUTTER = 160;
const PER_ROW = 3;

export interface DeckWarning {
	text: string;
}

/**
 * The open deck: `deck.json`, the boards on disk, and the roots embeds may reach.
 *
 * Holds no agent state and no camera — those belong to a session and a browser respectively. What it
takes from the file is the deck's own facts: its name, the roots, a size for a board that cannot
state one, and the arrangement an older file laid its boards out in, which it hands to a stage as a
seed and never writes back.
 */
export class Deck {
	private file: DeckFile = { version: 1 };
	/**
	 * The places an older `deck.json` laid its boards out in — the arrangement a stage is seeded from.
	 *
	 * Read, never written: a place belongs to a stage now, so this is handed to a conversation the first
	 * time it asks and then recorded in that conversation's own record (`App.stageState`). It is not in
	 * `file`, so the next `save()` drops it from the disk for good — a conversation started after that
	 * seeds nothing, which is the end state the migration is for.
	 */
	private seeds: Record<string, { x: number; y: number }> = {};
	private boardsByPath = new Map<string, Board>();
	/**
	 * `mtime:size` per board file, so `resync` can skip what has not moved.
	 *
	 * A signature is a *cheap* answer to "is this worth reading", never the answer to
	 * "did it change" — that is `rev`, which is the content hashed. A board touched
	 * without being edited has a new signature and the same revision, and nothing is
	 * told about it.
	 */
	private signatures = new Map<string, string>();
	/**
	 * The height each board's file states, or 0 for a board that states none.
	 *
	 * **A stated height is a floor, not a ceiling.** It is what a drag or a `stage.fit` wrote, and the
	 * browser's measurement raises the board above it whenever the content needs more room — so a board
	 * can be given space under its last box and can still never clip. Kept here rather than on the
	 * `Board` because nothing outside this file has a use for it: what everything else wants is `h`,
	 * which is already the answer.
	 */
	private floors = new Map<string, number>();
	private resolved: ResolvedRoots;
	readonly warnings: string[] = [];

	private constructor(readonly path: string) {
		this.resolved = resolveRoots(path, []);
	}

	static open(path: string): Deck {
		const absolute = resolve(path);
		if (!existsSync(absolute)) throw new Error(`No such deck: ${absolute}`);
		if (!statSync(absolute).isDirectory()) throw new Error(`A deck is a directory, and this is not one: ${absolute}`);
		const deck = new Deck(absolute);
		deck.reload();
		return deck;
	}

	/**
	 * Create a deck in an empty (or new) directory: `deck.json`, `boards/`,
	 * `assets/`, and the primitives copied in so its boards work offline and
	 * keep working if this app is not running.
	 */
	static create(path: string, runtimeLib: string, name?: string): Deck {
		const absolute = resolve(path);
		mkdirSync(join(absolute, "boards"), { recursive: true });
		mkdirSync(join(absolute, "assets"), { recursive: true });
		syncRuntimeLib(runtimeLib, join(absolute, "lib"));
		const deckFile = join(absolute, "deck.json");
		if (!existsSync(deckFile)) {
			writeFileSync(deckFile, serializeDeckFile({ version: 1, name: name ?? basename(absolute), roots: [] }));
		}
		return Deck.open(absolute);
	}

	/**
	 * What to call this deck.
	 *
	 * `deck.json` decides if it says so. Otherwise: the deck directory is always literally
	 * named `decks`, so its own basename tells you nothing — the data directory it sits in
	 * is the one somebody chose, and a leading dot (`~/.decks`) is a convention rather
	 * than a name.
	 */
	get name(): string {
		if (this.file.name) return this.file.name;
		const own = basename(this.path);
		const chosen = own === DECK_DIR ? basename(dirname(this.path)) : own;
		return chosen.replace(/^\.+/, "") || own;
	}

	get roots(): ResolvedRoots {
		return this.resolved;
	}

	get boards(): Board[] {
		return [...this.boardsByPath.values()].sort((a, b) => a.path.localeCompare(b.path));
	}

	board(path: string): Board | undefined {
		return this.boardsByPath.get(normalizeBoardPath(path));
	}

	/**
	 * The deck as one stage sees it: `positions` overrides where a board sits, then the place the deck
	 * itself was laid out with, and a board with neither goes through the auto-layout.
	 *
	 * Called with the focused agent's map, so what the client draws is that stage's arrangement. Called
	 * with nothing, it is the arrangement a stage that has placed nothing starts from — which is the
	 * deck's own, because that is what `seeds` is.
	 *
	 * `onPlace` is handed every place that was *not* read from the stage's own map — seeded or worked
	 * out — which is what lets the caller write it down on the stage and stop asking again. See
	 * `arrange`.
	 */
	state(
		positions?: Record<string, { x: number; y: number }>,
		onPlace?: (path: string, at: { x: number; y: number }) => void,
		onCanvas?: readonly string[],
	): DeckState {
		return { path: this.path, name: this.name, boards: this.arrange(positions, onPlace, onCanvas), roots: this.resolved.roots };
	}

	/**
	 * The boards, placed for one stage.
	 *
	 * A board with a position in `positions` takes it; one the deck was laid out with takes the seed;
	 * every other board goes through the existing `autoPlace`, with the boards that *do* have a place as
	 * its "already placed" — so the rows are laid out under this stage's arrangement rather than under a
	 * deck-wide one that is not there any more.
	 *
	 * **The places `autoPlace` computes are reported, not kept.** This function is called on every
	 * send, and a board placed beside the frontier *now* would chase it the next time somebody moved
	 * a board down — the reason the caller writes what it is told into the stage's map, so a board
	 * lands once and the frontier moves on without it.
	 */
	private arrange(
		positions?: Record<string, { x: number; y: number }>,
		onPlace?: (path: string, at: { x: number; y: number }) => void,
		onCanvas?: readonly string[],
	): Board[] {
		/*
		 * What the layout is measured against, and what is worth writing down.
		 *
		 * A place is a fact about a canvas: it says where a board sits among the boards beside it. So
		 * a stage that says which of its boards are on the canvas gets both halves narrowed to those
		 * — the frontier a new board lands under, and the places that are recorded. A board nobody
		 * has put on a canvas still comes out of here with coordinates, because the protocol wants
		 * numbers, but they are not kept and nothing draws them.
		 *
		 * Called with no canvas — a deck with nobody looking at it, and every test of the layout
		 * itself — this is the deck-wide auto-layout it always was.
		 */
		const shown = onCanvas ? new Set(onCanvas) : undefined;
		const keeping = (path: string) => !shown || shown.has(path);
		const placed: Board[] = [];
		const unplaced: Board[] = [];
		for (const board of this.boards) {
			const own = positions?.[board.path];
			/*
			 * The stage's own place, or the one the deck was laid out with.
			 *
			 * A seed is reported through `onPlace` exactly as a computed place is, which is what makes
			 * this a migration: the stage writes the deck's arrangement into its own record on the first
			 * send, and the map in `deck.json` stops mattering from then on.
			 */
			const at = own ?? this.seeds[board.path];
			if (at) {
				const spot = { x: Math.round(at.x), y: Math.round(at.y) };
				placed.push({ ...board, ...spot });
				if (!own && keeping(board.path)) onPlace?.(board.path, spot);
			} else unplaced.push({ ...board });
		}
		autoPlace(unplaced, shown ? placed.filter((board) => shown.has(board.path)) : placed);
		for (const board of unplaced) if (keeping(board.path)) onPlace?.(board.path, { x: board.x, y: board.y });
		return [...placed, ...unplaced];
	}

	/** An absolute path for a deck-relative board, refusing anything outside. */
	fileOf(boardPath: string): string {
		return resolveInDeck(this.path, normalizeBoardPath(boardPath));
	}

	/** Re-read `deck.json` and re-scan `boards/`. Cheap enough to do on any change. */
	reload(): void {
		this.warnings.length = 0;

		const deckFile = join(this.path, "deck.json");
		if (existsSync(deckFile)) {
			const parsed = parseDeckFile(readFileSync(deckFile, "utf8"));
			this.file = parsed.file;
			this.seeds = parsed.arrangement;
			this.warnings.push(...parsed.warnings);
		} else {
			// A directory of boards with no deck.json is still a deck; it just has
			// no arrangement yet. Opening one must not require writing to it.
			this.file = { version: 1 };
			this.seeds = {};
		}

		this.resolved = resolveRoots(this.path, declaredRoots(this.file));
		for (const root of this.resolved.roots) {
			if (!root.exists) this.warnings.push(`Root ${root.path} does not exist; embeds under it will not resolve.`);
		}

		const found = scanBoards(join(this.path, "boards"), this.path);
		/*
		 * No positions in the scan. Where a board sits is a stage's business now and this is only the
		 * list of boards; `arrange` gives them a place when they are sent.
		 */
		const boards = found.map((path) => this.describe(path));

		this.boardsByPath = new Map(boards.map((board) => [board.path, board]));
	}

	/**
	 * Re-read the whole boards directory from disk, and say what actually moved.
	 *
	 * The watcher is the fast path and this is the one that has to be right. A board is
	 * re-read only when its `mtime:size` differs from the last reading, and reported only
	 * when the *content hash* differs from the record we hold — so calling this on a timer
	 * costs a directory walk and a `stat` per board, and a deck where nothing happened
	 * produces nothing.
	 *
	 * It exists because a file event is not a promise. A write that replaces the file
	 * (`sed -i`, `vim`, any atomic save) can leave the recursive watcher armed on an inode
	 * nobody will write to again, and every later edit to that board then arrives nowhere:
	 * the canvas keeps showing a version that is no longer on disk, silently, until the
	 * server restarts.
	 */
	resync(): { changed: Board[]; removed: string[] } {
		const found = scanBoards(join(this.path, "boards"), this.path);
		const changed: Board[] = [];
		const removed: string[] = [];

		for (const path of found) {
			const signature = signatureOf(join(this.path, path));
			const known = this.boardsByPath.get(path);
			if (known && this.signatures.get(path) === signature) continue;
			const board = this.refresh(path);
			if (board && (!known || known.rev !== board.rev)) changed.push(board);
		}

		const seen = new Set(found);
		for (const path of [...this.boardsByPath.keys()]) {
			if (seen.has(path)) continue;
			this.boardsByPath.delete(path);
			this.signatures.delete(path);
			this.floors.delete(path);
			removed.push(path);
		}

		return { changed, removed };
	}

	/** Re-read one board after a change, keeping everything else as it is. */
	refresh(boardPath: string): Board | undefined {
		const path = normalizeBoardPath(boardPath);
		const absolute = join(this.path, path);
		if (!existsSync(absolute)) {
			this.boardsByPath.delete(path);
			return undefined;
		}
		const previous = this.boardsByPath.get(path);
		const floorBefore = this.floors.get(path);
		const board = this.describe(path);
		if (previous) {
			board.x = previous.x;
			board.y = previous.y;
			board.inContext = previous.inContext;
			board.lastWrittenBy = previous.lastWrittenBy;
			board.namedAt = previous.namedAt;
			board.seenAt = previous.seenAt;
			/*
			 * A board's height is its content's, and only a frame knows it: the reading the last look
			 * produced is the best answer until the next look. Without this, editing a board shrank it to
			 * the height in its file for a beat — and a board that jumps is the thing `refresh` exists to
			 * avoid.
			 *
			 * Unless the file's own number moved, which is a drag or a `stage.fit` writing a new floor.
			 * That one is deliberate and has to land now, or a fit that tightens a board would appear to do
			 * nothing until something else reloaded it.
			 */
			if (board.format !== "slides" && floorBefore === this.floors.get(path)) board.h = Math.max(previous.h, board.h);
		} else {
			autoPlace([board], this.boards);
		}
		this.boardsByPath.set(path, board);
		return board;
	}

	/**
	 * Delete a board's file and forget it. `true` if there was one to delete.
	 *
	 * Here rather than in `App` because this class is the only thing that knows a
	 * deck-relative path's file *and* holds the map that path appears in — a delete written
	 * anywhere else is an `unlink` plus two things to remember. `fileOf` is what makes it
	 * safe: it resolves through `resolveInDeck`, which throws on anything that climbs out of
	 * the deck, so a path from the wire cannot reach a file this deck does not own.
	 *
	 * The record is rewritten only if it mentioned this board's size. A deck with no
	 * The file is not rewritten at all. A size is not here any more — it is the board's own file's, and
	 * a flow board's height is a reading — so a delete has nothing in `deck.json` to prune. A deck
	 * with no `deck.json` is a valid deck: opening one must not write to it. A board's *place* belongs
	 * to a stage, which is where a delete already takes it in turn.
	 *
	 * Nothing here touches `.decks/revisions`. The versions of a deleted board stay on disk
	 * under their shas, which is the whole of what makes this recoverable by hand; the caller
	 * records one last revision before calling, so the bytes that were on screen are among
	 * them.
	 */
	remove(boardPath: string): boolean {
		const path = normalizeBoardPath(boardPath);
		const absolute = this.fileOf(path);
		const existed = existsSync(absolute);
		if (existed) rmSync(absolute);
		this.boardsByPath.delete(path);
		this.floors.delete(path);
		return existed;
	}

	/**
	 * Keep a height a frame measured, for this session.
	 *
	 * The one number a board cannot state for itself: how tall its content came to, which only the
	 * browser knows. Written nowhere — a height is a reading, and one recorded beside the board would
	 * be a second answer to "how tall is this" that goes stale the moment the content changes, which is
	 * exactly the shadowing this file used to do to a width. Kept on the board, so `deck.state` carries
	 * it while the process is up, and re-measured on the next load.
	 *
	 * **Never below the floor the file states.** That number is what somebody dragged or what a fit
	 * wrote, and a measurement that undercut it would take away the room under the last box a beat after
	 * it was asked for. Above it the measurement always wins, which is what makes clipping impossible.
	 *
	 * Returns the board only when the number actually moved, which is what stops a measurement that
	 * agrees with the board from broadcasting a `deck.state` and reloading the frame that produced it,
	 * forever.
	 */
	setHeight(boardPath: string, h: number): Board | undefined {
		const board = this.board(boardPath);
		// A deck's height is its aspect's, not its content's.
		if (!board || board.format === "slides") return undefined;
		const measured = Number.isFinite(h) && h > 0 ? Math.round(h) : undefined;
		if (measured === undefined) return undefined;
		const height = Math.max(measured, this.floors.get(board.path) ?? 0);
		if (height === board.h) return undefined;
		board.h = height;
		return board;
	}

	private describe(path: string): Board {
		const absolute = join(this.path, path);
		const source = readFileSync(absolute, "utf8");
		const format = formatOf(path);
		// A stub that draws itself from `postMessage`, if this is one.
		const live = liveKindOf(source);
		// Whether the file is a document already, or content that has to be wrapped in one.
		const shell = shellFor(path, source);
		const meta = readMeta(path, source);
		// Recorded here rather than in `resync` so that every path that reads a board —
		// the first load, a watcher event, a `resync` — leaves the same mark behind.
		this.signatures.set(path, signatureOf(absolute));
		/*
		 * Where the size comes from: **the board's own file**, and nowhere else.
		 *
		 * A board says its width in `<meta name="board">` (or in front-matter, if it is markdown) and
		 * may say a height there too; a slide deck says its width and derives its height from the
		 * aspect. And `deck.json` no longer keeps a copy: preferring one meant a resize that wrote the
		 * file — which is what every resize does — could appear to do nothing, and a board's width was
		 * unchangeable for as long as the record disagreed with the file.
		 */
		const width = meta.w ?? defaultWidth(format);
		/*
		 * **A stated height is a floor.** It is the room somebody dragged out or the number `stage.fit`
		 * wrote, and the browser's measurement raises the board above it the moment the content needs
		 * more — so a board keeps the space it was given and still cannot clip. A file that states none
		 * is the ordinary case and is exactly as tall as what is on it.
		 *
		 * Two formats used to answer this, and the honest reading of the difference is that one of them
		 * always stated a height and the other never did. It is one line now, and which line a board
		 * takes is the file's to say rather than the format's.
		 *
		 * A *sandboxed* board — a document from somewhere else — never gets a measurement at all, so for
		 * it the placeholder is the answer rather than a start. Hence the two: a usable page for a
		 * document nobody can measure, and the short one for ours, because a board that grows into its
		 * content on load looks like it is arriving where one that shrinks looks broken.
		 */
		const floor = format === "slides" ? 0 : meta.h ?? 0;
		this.floors.set(path, floor);
		const height = format === "slides" ? slideHeight(width, meta.aspect) : floor || (shell === "foreign" ? FOREIGN_H : START_H);
		return {
			path,
			// `.slides.html` before `.html`, or a deck with no title of its own is called
			// `talk.slides` in the rail.
			title: meta.title ?? basename(path).replace(/\.(slides\.(?:html?|md)|html?|mdx?)$/i, ""),
			format,
			...(shell ? { shell } : {}),
			x: 0,
			y: 0,
			w: width,
			h: height,
			// The revision is the *content*, hashed. The modification time was the
			// obvious choice and the wrong one: it has millisecond resolution, so two
			// writes inside the same millisecond leave it unchanged and the frame
			// never reloads. A content hash also means an edit that puts a board back
			// the way it was does not churn every open frame.
			rev: revisionOf(source),
			// The *other* reading of the same file, published because the canvas's
			// "changed" mark needs a time (`board-news.ts`). A reading and not a promise:
			// a board touched without being edited has a new time and the same revision.
			// `signatureOf` has already stat-ed the file by now; this is the stat whose
			// number it kept private.
			modifiedAt: modifiedAtOf(absolute),
			...(meta.poster ? { poster: meta.poster } : {}),
			...(live ? { live } : {}),
			inContext: [],
		};
	}
}

/** `mtime:size` for a file, or `""` if it went away between the scan and the stat. */
function signatureOf(absolute: string): string {
	try {
		const stats = statSync(absolute);
		return `${stats.mtimeMs}:${stats.size}`;
	} catch {
		return "";
	}
}

/** The last modification, for the "changed" mark — `0` if the file went away mid-scan. */
function modifiedAtOf(absolute: string): number {
	try {
		return statSync(absolute).mtimeMs;
	} catch {
		return 0;
	}
}

/** Every board file under `boards/`, deck-relative, sorted, dotfiles skipped. */
function scanBoards(dir: string, deckRoot: string): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	const walk = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) continue;
			const full = join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (isBoardFile(entry.name)) out.push(normalizeBoardPath(relative(deckRoot, full)));
		}
	};
	walk(dir);
	return out.sort((a, b) => a.localeCompare(b));
}

/**
 * Give the boards nobody has arranged a place to be.
 *
 * Rows of three, left to right, starting below whatever is already placed — so a
 * board the agent just wrote appears next to its siblings instead of on top of
 * one, and dragging it somewhere makes that position permanent.
 */
function autoPlace(boards: Board[], existing: Board[]): void {
	if (boards.length === 0) return;
	const startY = existing.length > 0 ? Math.max(...existing.map((b) => b.y + b.h)) + GUTTER : 0;
	let x = existing.length > 0 ? Math.min(...existing.map((b) => b.x)) : 0;
	let y = startY;
	let rowHeight = 0;
	boards.forEach((board, index) => {
		if (index > 0 && index % PER_ROW === 0) {
			x = existing.length > 0 ? Math.min(...existing.map((b) => b.x)) : 0;
			y += rowHeight + GUTTER;
			rowHeight = 0;
		}
		board.x = x;
		board.y = y;
		x += board.w + GUTTER;
		rowHeight = Math.max(rowHeight, board.h);
	});
}

/**
 * A 32-bit FNV-1a over the board's bytes, as its revision.
 *
 * Not a cryptographic hash and not trying to be: this is a cache key for one
 * board in one process, and the file has already been read to parse its `<meta>`,
 * so it costs nothing. Kept positive so it reads as an id in a URL.
 */
function revisionOf(html: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < html.length; index++) {
		hash ^= html.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

