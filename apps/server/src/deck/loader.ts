import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { Board, DeckState } from "@decks/protocol";
import { DECK_DIR } from "../config.ts";
import { readBoardMeta } from "./meta.ts";
import { resolveInDeck, resolveRoots, type ResolvedRoots } from "./roots.ts";
import { declaredRoots, normalizeBoardPath, parseDeckFile, serializeDeckFile, type DeckFile } from "./schema.ts";

/** Defaults for a board that says nothing about its own size. */
const DEFAULT_W = 1200;
const DEFAULT_H = 800;
/** Space between auto-placed boards, and how many go in a row before wrapping. */
const GUTTER = 160;
const PER_ROW = 3;

export interface DeckWarning {
	text: string;
}

/**
 * The open deck: `deck.json`, the boards on disk, and the roots embeds may reach.
 *
 * Holds no agent state and no camera — those belong to a session and a browser
 * respectively. What it owns is the arrangement, which is why it is also the only
 * thing that writes `deck.json`.
 */
export class Deck {
	private file: DeckFile = { version: 1 };
	private boardsByPath = new Map<string, Board>();
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
		copyDir(runtimeLib, join(absolute, "lib"));
		const deckFile = join(absolute, "deck.json");
		if (!existsSync(deckFile)) {
			writeFileSync(deckFile, serializeDeckFile({ version: 1, name: name ?? basename(absolute), boards: {}, roots: [] }));
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

	state(): DeckState {
		return { path: this.path, name: this.name, boards: this.boards, roots: this.resolved.roots };
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
			this.warnings.push(...parsed.warnings);
		} else {
			// A directory of boards with no deck.json is still a deck; it just has
			// no arrangement yet. Opening one must not require writing to it.
			this.file = { version: 1 };
		}

		this.resolved = resolveRoots(this.path, declaredRoots(this.file));
		for (const root of this.resolved.roots) {
			if (!root.exists) this.warnings.push(`Root ${root.path} does not exist; embeds under it will not resolve.`);
		}

		const found = scanBoards(join(this.path, "boards"), this.path);
		const positions = this.file.boards ?? {};
		const placed: Board[] = [];
		const unplaced: Board[] = [];

		for (const path of found) {
			const board = this.describe(path);
			if (positions[path]) {
				board.x = positions[path]!.x;
				board.y = positions[path]!.y;
				placed.push(board);
			} else {
				unplaced.push(board);
			}
		}

		autoPlace(unplaced, placed);

		this.boardsByPath = new Map([...placed, ...unplaced].map((board) => [board.path, board]));
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
		const board = this.describe(path);
		if (previous) {
			board.x = previous.x;
			board.y = previous.y;
			board.inContext = previous.inContext;
			board.lastWrittenBy = previous.lastWrittenBy;
		} else {
			autoPlace([board], this.boards);
		}
		this.boardsByPath.set(path, board);
		return board;
	}

	/** Move a board and write the arrangement down. */
	setPosition(boardPath: string, x: number, y: number): Board | undefined {
		const board = this.board(boardPath);
		if (!board) return undefined;
		board.x = Math.round(x);
		board.y = Math.round(y);
		this.save();
		return board;
	}

	/** The bytes this process last wrote to `deck.json`, so its own echo is known. */
	private lastWritten: string | undefined;

	/**
	 * Whether `deck.json` on disk is exactly what we last wrote.
	 *
	 * Saving the arrangement makes the watcher fire, and treating that as news meant
	 * every drag broadcast the whole deck back to the browser that had just moved a
	 * board. A hand edit still gets through — the bytes differ.
	 */
	isOwnWrite(): boolean {
		if (this.lastWritten === undefined) return false;
		try {
			return readFileSync(join(this.path, "deck.json"), "utf8") === this.lastWritten;
		} catch {
			return false;
		}
	}

	/**
	 * Write `deck.json` from the boards as they now sit.
	 *
	 * Positions are rebuilt from the live boards, but every other key in the file —
	 * including ones this build does not know about — is carried through, because
	 * the file belongs to the user as much as to us.
	 */
	save(): void {
		const boards: Record<string, { x: number; y: number }> = {};
		for (const board of this.boards) boards[board.path] = { x: board.x, y: board.y };
		this.file = { ...this.file, version: 1, name: this.file.name ?? this.name, boards };
		const text = serializeDeckFile(this.file);
		this.lastWritten = text;
		writeFileSync(join(this.path, "deck.json"), text);
	}

	private describe(path: string): Board {
		const absolute = join(this.path, path);
		const html = readFileSync(absolute, "utf8");
		const meta = readBoardMeta(html);
		return {
			path,
			title: meta.title ?? basename(path).replace(/\.html?$/i, ""),
			x: 0,
			y: 0,
			w: meta.w ?? DEFAULT_W,
			h: meta.h ?? DEFAULT_H,
			// The revision is the *content*, hashed. The modification time was the
			// obvious choice and the wrong one: it has millisecond resolution, so two
			// writes inside the same millisecond leave it unchanged and the frame
			// never reloads. A content hash also means an edit that puts a board back
			// the way it was does not churn every open frame.
			rev: revisionOf(html),
			...(meta.poster ? { poster: meta.poster } : {}),
			inContext: [],
		};
	}
}

/** Every `.html` under `boards/`, deck-relative, sorted, dotfiles skipped. */
function scanBoards(dir: string, deckRoot: string): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	const walk = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) continue;
			const full = join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (/\.html?$/i.test(entry.name)) out.push(normalizeBoardPath(relative(deckRoot, full)));
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

function copyDir(from: string, to: string): void {
	if (!existsSync(from)) return;
	mkdirSync(to, { recursive: true });
	for (const entry of readdirSync(from, { withFileTypes: true })) {
		const source = join(from, entry.name);
		const target = join(to, entry.name);
		if (entry.isDirectory()) copyDir(source, target);
		else writeFileSync(target, readFileSync(source));
	}
}
