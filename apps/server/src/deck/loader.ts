import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cardFolders } from "./card-folders.ts";
import { isCardPath, pageName } from "@decks/hub/layout";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { Page, DeckPen, DeckState } from "@decks/protocol";
import { DECK_DIR } from "../config.ts";
import { CARD_W, cardMeta } from "@decks/deck-kit";
import { resolveInDeck, resolveRoots, type ResolvedRoots } from "./roots.ts";
import { syncRuntimeLib } from "./lib-sync.ts";
import { readsOldShapes } from "./old-shapes.ts";
import { declaredRoots, normalizeCardPath, parseDeckFile, serializeDeckFile, type DeckFile } from "./schema.ts";

/**
 * A card's height until it is measured: short, because a card that grows into its content on load
 * looks like it is arriving where one that shrinks looks broken.
 */
const START_H = 240;
/** Space between auto-placed cards, and how many go in a row before wrapping. */
const GUTTER = 160;
const PER_ROW = 3;

/**
 * The open deck: `deck.json`, the cards on disk, and the roots embeds may reach.
 *
 * Holds no agent state and no camera — those belong to a session and a browser respectively. What it
takes from the file is the deck's own facts: its name, the roots, a size for a card that cannot
state one, and the arrangement an older file laid its cards out in, which it hands to a canvas as a
seed and never writes back.
 */
export class Deck {
	private file: DeckFile = { version: 1 };
	/**
	 * The places an older `deck.json` laid its cards out in — the arrangement a canvas is seeded from.
	 *
	 * Read, never written: a place belongs to a canvas now, so this is handed to a conversation the first
	 * time it asks and then recorded in that conversation's own record (`App.canvasState`). It is not in
	 * `file`, so the next `save()` drops it from the disk for good — a conversation started after that
	 * seeds nothing, which is the end state the migration is for.
	 */
	private seeds: Record<string, { x: number; y: number }> = {};
	/**
	 * Whether this deck may still hold shapes from before version 0.1.0 (`old-shapes.ts`): asked once, when
	 * the deck is opened, and what the readers of those shapes go by (the seeds above, `agents/old-records.ts`).
	 */
	readonly readsOldShapes: boolean;
	private cardsByPath = new Map<string, Page>();
	/**
	 * `mtime:size` per card file, so `resync` can skip what has not moved.
	 *
	 * A signature is a *cheap* answer to "is this worth reading", never the answer to
	 * "did it change" — that is `rev`, which is the content hashed. A card touched
	 * without being edited has a new signature and the same revision, and nothing is
	 * told about it.
	 */
	private signatures = new Map<string, string>();
	/**
	 * The height each card's file states, or 0 for a card that states none.
	 *
	 * **A stated height is a floor, not a ceiling.** It is what a drag or a `decks.canvas.fit` wrote, and the
	 * browser's measurement raises the card above it whenever the content needs more room — so a card
	 * can be given space under its last box and can still never clip. Kept here rather than on the
	 * `Page` because nothing outside this file has a use for it: what everything else wants is `h`,
	 * which is already the answer.
	 */
	private floors = new Map<string, number>();
	/**
	 * Heights browsers read, at the revision they read them, from when a reading sized a card; kept in
	 * `.decks/heights.json` and no longer written. A card's size is its canvas's now (the canvas file),
	 * and a card joining a canvas comes at its own file's; this answers only for a file that states no
	 * height, at the revision it was read at.
	 */
	private heights = new Map<string, { rev: number; h: number }>();
	private resolved: ResolvedRoots;
	readonly warnings: string[] = [];

	private constructor(readonly path: string) {
		this.readsOldShapes = readsOldShapes(path);
		this.resolved = resolveRoots(path, []);
		try {
			const saved = JSON.parse(readFileSync(join(path, ".decks", "heights.json"), "utf8")) as Record<string, { rev: number; h: number }>;
			for (const [card, at] of Object.entries(saved)) if (Number.isFinite(at?.rev) && Number.isFinite(at?.h)) this.heights.set(card, at);
		} catch {
			/* none saved yet */
		}
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
	 * Create a deck in an empty (or new) directory: `deck.json`, `assets/`, and the
	 * primitives copied in so its pages work offline and keep working if this app is not
	 * running. No `cards/`: nothing makes cards any more, and a canvas keeps its cards.
	 */
	static create(path: string, runtimeLib: string, name?: string): Deck {
		const absolute = resolve(path);
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

	get cards(): Page[] {
		return [...this.cardsByPath.values()].sort((a, b) => a.path.localeCompare(b.path));
	}

	card(path: string): Page | undefined {
		return this.cardsByPath.get(normalizeCardPath(path));
	}

	/**
	 * The deck as one canvas sees it: `positions` overrides where a card sits, then the place the deck
	 * itself was laid out with, and a card with neither goes through the auto-layout.
	 *
	 * Called with the focused agent's map, so what the client draws is that canvas's arrangement. Called
	 * with nothing, it is the arrangement a canvas that has placed nothing starts from — which is the
	 * deck's own, because that is what `seeds` is.
	 *
	 * `onPlace` is handed every place that was *not* read from the canvas's own map — seeded or worked
	 * out — which is what lets the caller write it down on the canvas and stop asking again. See
	 * `arrange`.
	 */
	state(
		positions?: Record<string, { x: number; y: number }>,
		onPlace?: (path: string, at: { x: number; y: number }) => void,
		onCanvas?: readonly string[],
	): DeckState {
		return { path: this.path, name: this.name, cards: this.arrange(positions, onPlace, onCanvas), roots: this.resolved.roots, pens: this.pens() };
	}

	/** The `.pen` files in the deck's `frames/`, each with the ref that places it and a title to list it by. */
	pens(): DeckPen[] {
		const out: DeckPen[] = [];
		const walk = (current: string) => {
			if (!existsSync(current)) return;
			for (const entry of readdirSync(current, { withFileTypes: true })) {
				if (entry.name.startsWith(".")) continue;
				const full = join(current, entry.name);
				if (entry.isDirectory()) walk(full);
				else if (entry.name.endsWith(".pen")) {
					const path = normalizeCardPath(relative(this.path, full));
					let title = entry.name.replace(/\.pen$/, "");
					try {
						const first = (JSON.parse(readFileSync(full, "utf8")) as { children?: Array<{ name?: unknown }> }).children?.[0];
						if (typeof first?.name === "string" && first.name.trim()) title = first.name.trim();
					} catch {
						/* a file that does not parse is listed by its name, and draws as missing where it is used */
					}
					out.push({ path, ref: path.replace(/\.pen$/, ""), title, modifiedAt: modifiedAtOf(full) });
				}
			}
		};
		walk(join(this.path, "frames"));
		return out.sort((a, b) => a.path.localeCompare(b.path));
	}

	/**
	 * The cards, placed for one canvas.
	 *
	 * A card with a position in `positions` takes it; one the deck was laid out with takes the seed;
	 * every other card goes through the existing `autoPlace`, with the cards that *do* have a place as
	 * its "already placed" — so the rows are laid out under this canvas's arrangement rather than under a
	 * deck-wide one that is not there any more.
	 *
	 * **The places `autoPlace` computes are reported, not kept.** This function is called on every
	 * send, and a card placed beside the frontier *now* would chase it the next time somebody moved
	 * a card down — the reason the caller writes what it is told into the canvas's map, so a card
	 * lands once and the frontier moves on without it.
	 */
	private arrange(
		positions?: Record<string, { x: number; y: number }>,
		onPlace?: (path: string, at: { x: number; y: number }) => void,
		onCanvas?: readonly string[],
	): Page[] {
		/*
		 * What the layout is measured against, and what is worth writing down.
		 *
		 * A place is a fact about a canvas: it says where a card sits among the cards beside it. So
		 * a canvas that says which of its cards are on the canvas gets both halves narrowed to those
		 * — the frontier a new card lands under, and the places that are recorded. A card nobody
		 * has put on a canvas still comes out of here with coordinates, because the protocol wants
		 * numbers, but they are not kept and nothing draws them.
		 *
		 * Called with no canvas — a deck with nobody looking at it, and every test of the layout
		 * itself — this is the deck-wide auto-layout it always was.
		 */
		const shown = onCanvas ? new Set(onCanvas) : undefined;
		const keeping = (path: string) => !shown || shown.has(path);
		const placed: Page[] = [];
		const unplaced: Page[] = [];
		for (const card of this.cards) {
			const own = positions?.[card.path];
			/*
			 * The canvas's own place, or the one the deck was laid out with.
			 *
			 * A seed is reported through `onPlace` exactly as a computed place is, which is what makes
			 * this a migration: the canvas writes the deck's arrangement into its own record on the first
			 * send, and the map in `deck.json` stops mattering from then on.
			 */
			const at = own ?? this.seeds[card.path];
			if (at) {
				const spot = { x: Math.round(at.x), y: Math.round(at.y) };
				placed.push({ ...card, ...spot });
				if (!own && keeping(card.path)) onPlace?.(card.path, spot);
			} else unplaced.push({ ...card });
		}
		autoPlace(unplaced, shown ? placed.filter((card) => shown.has(card.path)) : placed);
		for (const one of unplaced) if (keeping(one.path)) onPlace?.(one.path, { x: one.x, y: one.y });
		return [...placed, ...unplaced];
	}

	/** An absolute path for a deck-relative card, refusing anything outside. */
	fileOf(cardPath: string): string {
		return resolveInDeck(this.path, normalizeCardPath(cardPath));
	}

	/** Re-read `deck.json` and re-scan the card folders. Cheap enough to do on any change. */
	reload(): void {
		this.warnings.length = 0;

		const deckFile = join(this.path, "deck.json");
		if (existsSync(deckFile)) {
			const parsed = parseDeckFile(readFileSync(deckFile, "utf8"), { oldPlaces: this.readsOldShapes });
			this.file = parsed.file;
			this.seeds = parsed.arrangement;
			this.warnings.push(...parsed.warnings);
		} else {
			// A directory of cards with no deck.json is still a deck; it just has
			// no arrangement yet. Opening one must not require writing to it.
			this.file = { version: 1 };
			this.seeds = {};
		}

		this.resolved = resolveRoots(this.path, declaredRoots(this.file));
		for (const root of this.resolved.roots) {
			if (!root.exists) this.warnings.push(`Root ${root.path} does not exist; embeds under it will not resolve.`);
		}

		const found = cardFolders(this.path).flatMap((folder) => scanCards(join(this.path, folder), this.path));
		/*
		 * No positions in the scan. Where a card sits is a canvas's business now and this is only the
		 * list of cards; `arrange` gives them a place when they are sent.
		 */
		const cards = found.map((path) => this.describe(path));

		this.cardsByPath = new Map(cards.map((card) => [card.path, card]));
	}

	/**
	 * Re-read the whole cards directory from disk, and say what actually moved.
	 *
	 * The watcher is the fast path and this is the one that has to be right. A card is
	 * re-read only when its `mtime:size` differs from the last reading, and reported only
	 * when the *content hash* differs from the record we hold — so calling this on a timer
	 * costs a directory walk and a `stat` per card, and a deck where nothing happened
	 * produces nothing.
	 *
	 * It exists because a file event is not a promise. A write that replaces the file
	 * (`sed -i`, `vim`, any atomic save) can leave the recursive watcher armed on an inode
	 * nobody will write to again, and every later edit to that card then arrives nowhere:
	 * the canvas keeps showing a version that is no longer on disk, silently, until the
	 * server restarts.
	 */
	resync(): { changed: Page[]; removed: string[] } {
		const found = cardFolders(this.path).flatMap((folder) => scanCards(join(this.path, folder), this.path));
		const changed: Page[] = [];

		const removed: string[] = [];

		for (const path of found) {
			const signature = pageSignature(this.path, path);
			const known = this.cardsByPath.get(path);
			if (known && this.signatures.get(path) === signature) continue;
			const card = this.refresh(path);
			if (card && (!known || known.rev !== card.rev)) changed.push(card);
		}

		const seen = new Set(found);
		for (const path of [...this.cardsByPath.keys()]) {
			if (seen.has(path)) continue;
			this.cardsByPath.delete(path);
			this.signatures.delete(path);
			this.floors.delete(path);
			removed.push(path);
		}

		return { changed, removed };
	}

	/** Whether a card known here is on disk as it was last read: its file and its folder, by place, time and size (`pageSignature`). */
	unchanged(cardPath: string): boolean {
		const path = normalizeCardPath(cardPath);
		return this.cardsByPath.has(path) && this.signatures.get(path) === pageSignature(this.path, path);
	}

	/** Re-read one card after a change, keeping everything else as it is. */
	refresh(cardPath: string): Page | undefined {
		const path = normalizeCardPath(cardPath);
		const absolute = join(this.path, path);
		if (!existsSync(absolute)) {
			this.cardsByPath.delete(path);
			return undefined;
		}
		const previous = this.cardsByPath.get(path);
		const card = this.describe(path);
		if (previous) {
			card.x = previous.x;
			card.y = previous.y;
			card.inContext = previous.inContext;
			card.lastWrittenBy = previous.lastWrittenBy;
			card.namedAt = previous.namedAt;
			card.seenAt = previous.seenAt;
			// A file that states no height keeps the one the card had; one that does is that height.
			if ((this.floors.get(path) ?? 0) === 0) card.h = previous.h;
		} else {
			autoPlace([card], this.cards);
		}
		this.cardsByPath.set(path, card);
		return card;
	}

	/**
	 * Delete a card's file and forget it. `true` if there was one to delete.
	 *
	 * Here rather than in `App` because this class is the only thing that knows a
	 * deck-relative path's file *and* holds the map that path appears in — a delete written
	 * anywhere else is an `unlink` plus two things to remember. `fileOf` is what makes it
	 * safe: it resolves through `resolveInDeck`, which throws on anything that climbs out of
	 * the deck, so a path from the wire cannot reach a file this deck does not own.
	 *
	 * The record is rewritten only if it mentioned this card's size. A deck with no
	 * The file is not rewritten at all. A size is not here any more — it is the card's own file's, and
	 * a flow card's height is a reading — so a delete has nothing in `deck.json` to prune. A deck
	 * with no `deck.json` is a valid deck: opening one must not write to it. A card's *place* belongs
	 * to a canvas, which is where a delete already takes it in turn.
	 *
	 * Nothing here touches `.decks/revisions`. The versions of a deleted card stay on disk
	 * under their shas, which is the whole of what makes this recoverable by hand; the caller
	 * records one last revision before calling, so the bytes that were on screen are among
	 * them.
	 */
	remove(cardPath: string): boolean {
		const path = normalizeCardPath(cardPath);
		const absolute = this.fileOf(path);
		const existed = existsSync(absolute);
		if (existed) rmSync(absolute);
		this.cardsByPath.delete(path);
		this.floors.delete(path);
		return existed;
	}



	private describe(path: string): Page {
		const absolute = join(this.path, path);
		const source = readFileSync(absolute, "utf8");
		const meta = cardMeta(source);
		// Recorded here rather than in `resync` so that every path that reads a card —
		// the first load, a watcher event, a `resync` — leaves the same mark behind.
		this.signatures.set(path, pageSignature(this.path, path));
		/*
		 * Where the size comes from: **the card's own file**, and nowhere else.
		 *
		 * A card says its width in `<meta name="card">` (or in front-matter, if it is markdown) and
		 * may say a height there too. And `deck.json` no longer keeps a copy: preferring one meant a resize that wrote the
		 * file — which is what every resize does — could appear to do nothing, and a card's width was
		 * unchangeable for as long as the record disagreed with the file.
		 */
		const width = meta.w ?? CARD_W;
		/*
		 * **A stated height is a floor.** It is the room somebody dragged out or the number `decks.canvas.fit`
		 * wrote, and the browser's measurement raises the card above it the moment the content needs
		 * more — so a card keeps the space it was given and still cannot clip. A file that states none
		 * is the ordinary case and is exactly as tall as what is on it.
		 *
		 * Two formats used to answer this, and the honest reading of the difference is that one of them
		 * always stated a height and the other never did. It is one line now, and which line a card
		 * takes is the file's to say rather than the format's.
		 */
		const floor = meta.h ?? 0;
		this.floors.set(path, floor);
		// A card is its folder: a change to its `chart.js` is a new revision of the card, as a change to its HTML is.
		const rev = revisionOf(`${source}\n${folderSignature(dirname(absolute))}`);
		// Read before, at this revision, when browsers still sized cards (`heights`).
		const known = this.heights.get(path);
		// The file's own height when it states one, as its agent wrote it; an old reading only when it does not.
		const height = floor || (known?.rev === rev ? known.h : START_H);
		return {
			path,
			title: meta.title ?? pageName(path),
			card: true as const,
			x: 0,
			y: 0,
			w: width,
			h: height,
			// The revision is the *content*, hashed. The modification time was the
			// obvious choice and the wrong one: it has millisecond resolution, so two
			// writes inside the same millisecond leave it unchanged and the frame
			// never reloads. A content hash also means an edit that puts a card back
			// the way it was does not churn every open frame.
			rev,
			// The *other* reading of the same file, published because the canvas's
			// "changed" mark needs a time (`agents/canvas-news.ts`). A reading and not a promise:
			// a card touched without being edited has a new time and the same revision.
			// `signatureOf` has already stat-ed the file by now; this is the stat whose
			// number it kept private.
			modifiedAt: modifiedAtOf(absolute),
			...(meta.poster ? { poster: meta.poster } : {}),
			inContext: [],
		};
	}
}

/** A card's whole folder: what `resync` compares to tell it changed. */
function pageSignature(deck: string, path: string): string {
	const absolute = join(deck, path);
	return `${signatureOf(absolute)}|${folderSignature(dirname(absolute))}`;
}

/** Every file in a card's folder, by its place, time and size; hidden ones left out. */
function folderSignature(dir: string): string {
	const out: string[] = [];
	const walk = (current: string) => {
		let entries: import("node:fs").Dirent[] = [];
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const full = join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else out.push(`${relative(dir, full)}:${signatureOf(full)}`);
		}
	};
	walk(dir);
	return out.sort().join(",");
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

/** Every card under one `cards/` folder (`deck/card-folders.ts`): each folder's `index.html`, deck-relative, sorted, hidden folders skipped. */
function scanCards(dir: string, deckRoot: string): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		const path = normalizeCardPath(relative(deckRoot, join(dir, entry.name, "index.html")));
		if (isCardPath(path) && existsSync(join(deckRoot, path))) out.push(path);
	}
	return out.sort((a, b) => a.localeCompare(b));
}

/**
 * Give the cards nobody has arranged a place to be.
 *
 * Rows of three, left to right, starting below whatever is already placed — so a
 * card the agent just wrote appears next to its siblings instead of on top of
 * one, and dragging it somewhere makes that position permanent.
 */
function autoPlace(cards: Page[], existing: Page[]): void {
	if (cards.length === 0) return;
	const startY = existing.length > 0 ? Math.max(...existing.map((b) => b.y + b.h)) + GUTTER : 0;
	let x = existing.length > 0 ? Math.min(...existing.map((b) => b.x)) : 0;
	let y = startY;
	let rowHeight = 0;
	cards.forEach((card, index) => {
		if (index > 0 && index % PER_ROW === 0) {
			x = existing.length > 0 ? Math.min(...existing.map((b) => b.x)) : 0;
			y += rowHeight + GUTTER;
			rowHeight = 0;
		}
		card.x = x;
		card.y = y;
		x += card.w + GUTTER;
		rowHeight = Math.max(rowHeight, card.h);
	});
}

/**
 * A 32-bit FNV-1a over the card's bytes, as its revision.
 *
 * Not a cryptographic hash and not trying to be: this is a cache key for one
 * card in one process, and the file has already been read to parse its `<meta>`,
 * so it costs nothing. Kept positive so it reads as an id in a URL.
 */
export function revisionOf(html: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < html.length; index++) {
		hash ^= html.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

