import type { PenDocument } from "@decks/pen";
import type { DeckState, ServerMessage } from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";
import { joinPlaces } from "../deck/place.ts";
import { cardsOn, putOn, takeOff, type OnCanvas } from "../canvas/canvas-ops.ts";
import type { CanvasService } from "../canvas/service.ts";
import { canvasNews } from "./canvas-news.ts";
import { recordedBoardsToAdopt } from "./old-records.ts";
import type { AgentRecord } from "./store.ts";

/**
 * An agent's seat: where it sits, and what it has in front of it.
 *
 * Its home canvas (the one a call that names none acts on), the cards it holds, where it last had a
 * card it took off the canvas, and what it has seen of each canvas it works on, so it can be told
 * what others changed there since. The canvas's file is the one record of which cards are on it,
 * where, and how big (`canvas/pens.ts`): the seat reads it when it needs them and writes each change
 * as one operation on one card, so several agents on one canvas, and a person on it, never put back
 * each other's work.
 */

/** What a canvas is called until somebody names it; the first name it is given names its folder too. */
const UNTITLED = "Untitled canvas";

/** What the seat needs of the agent it is the seat of. */
export interface SeatHost {
	readonly id: string;
	readonly deck: Deck;
	readonly stage: CanvasService;
	emit(message: ServerMessage): void;
	/** Something the record keeps changed: write it shortly. */
	save(): void;
	/** A card was given a place, so the deck's state goes out to the browsers. Optional: a unit fixture has none to tell. */
	arranged?(): void;
	/** Every agent's name, for the news of who changed what. */
	agents(): Array<{ id: string; name: string }>;
	/** A note the agent reads before its next message. */
	tell(note: string): void;
}

/** What a seat is made from: where a new agent's first canvas comes from, and a restored agent's record. */
export interface SeatStart {
	/** The canvas a new agent opens on, asked the first time it needs one (`Registry.latestCanvas`). */
	firstCanvas?: ((self: string) => string | undefined) | undefined;
	restored?: { context: string[]; inPlay: string[]; positions?: Record<string, { x: number; y: number }> | undefined; stage?: string | undefined } | undefined;
}

/**
 * Where a stage put its boards, if the stored value is one.
 *
 * The one validator for two readers — a restored record and a rewind's snapshot — because they are the
 * same map arriving by different roads and used to have a copy of this loop each. A pair of finite
 * numbers per path and nothing else: entries that are not that are dropped rather than the whole map,
 * so one hand-edit cannot cost a stage its whole arrangement.
 */
export function cleanPlaces(raw: unknown): Record<string, { x: number; y: number }> | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const kept: Record<string, { x: number; y: number }> = {};
	for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
		const at = value as { x?: unknown; y?: unknown } | null;
		const x = Number(at?.x);
		const y = Number(at?.y);
		if (path && Number.isFinite(x) && Number.isFinite(y)) kept[path] = { x, y };
	}
	return Object.keys(kept).length > 0 ? kept : undefined;
}

export class Seat {
	/**
	 * The boards this agent is holding, most-recently-touched first.
	 *
	 * The order used to be insertion order, which is how `decks.agent.list()` ended up answering
	 * "what is this agent working on" with everything it had ever held, oldest first. A held
	 * board is a decision the agent made — attaching one is it saying *this is what I am
	 * working from* — so the recent end is the answer to the question, and the rest of the
	 * list is history. The touch sites (`stage.attach`, a new board, a first `decks.canvas.insert`) put the
	 * newest board at the front; `setContext` keeps whatever order it is given. Re-attaching a
	 * board is a fresh touch, which is why `attach` moves it to the front rather than leaving
	 * it where it sat.
	 */
	private held: string[] = [];
	/**
	 * With no stage file to hold them (a host that keeps none), the boards this session was given to
	 * show. With one, the stage's boards are the file's (`playing`).
	 */
	private loosePlaying: string[] = [];
	/** The boards a restored record had on its stage, written in once if the stage file has none (`adoptStage`). */
	private restoredPlaying: string[] | undefined;
	/**
	 * Where this agent last had each board it took off its stage, by path, so showing it again puts it
	 * back. The places of boards on the stage are the stage file's own.
	 */
	private places: Record<string, { x: number; y: number }> = {};
	/** Where a new agent's first canvas comes from (`options.firstCanvas`); asked once, then let go. */
	private firstCanvas: ((self: string) => string | undefined) | undefined;
	/** The folder its stage drawing lives in, once it has one (`canvas/pens.ts`). */
	private folder: string | undefined;

	/*
	 * A restored seat is put back before anything can change it: assigned, not set through
	 * `setContext`, which would announce the cards of an agent no browser has been told about yet.
	 */
	constructor(
		private readonly of: SeatHost,
		start: SeatStart = {},
	) {
		this.firstCanvas = start.firstCanvas;
		this.folder = start.restored?.stage;
		if (!start.restored) return;
		this.held = [...start.restored.context];
		this.restoredPlaying = start.restored.inPlay.filter((path) => this.held.includes(path));
		this.loosePlaying = [...this.restoredPlaying];
		// Where it had put its cards is the seat's own state and has no other home.
		const kept = cleanPlaces(start.restored.positions);
		if (kept) this.places = kept;
	}

	/** What the agent's record keeps of its seat. */
	record(): Pick<AgentRecord, "context" | "inPlay" | "positions" | "stage"> {
		return {
			context: [...this.held],
			// What is on a canvas is its file's; only a seat with no canvas file keeps its own list.
			inPlay: this.canvasName() ? [] : [...this.loosePlaying],
			...(Object.keys(this.places).length > 0 ? { positions: { ...this.places } } : {}),
			...(this.folder ? { stage: this.folder } : {}),
		};
	}

	/** Where it last had the cards it took off its canvas: its own places, without the canvas's. */
	remembered(): Record<string, { x: number; y: number }> {
		return { ...this.places };
	}

	get context(): readonly string[] {
		return this.held;
	}

	get inPlay(): readonly string[] {
		return this.playing;
	}

	/**
	 * The folder this agent's stage drawing lives in (`canvas/pens.ts`).
	 *
	 * Named the first time it is needed with `claim`, from the agent's name at that moment, and
	 * kept on the record — a rename later leaves the folder where it is.
	 */
	stageName(claim = false): string | undefined {
		if (this.folder || !claim) return this.folder;
		const pens = this.of.stage.pens;
		if (!pens) return undefined;
		// A new agent joins the latest canvas of its workspace; with none, it gets one of its own.
		const joined = this.firstCanvas?.(this.of.id);
		this.firstCanvas = undefined;
		// A placeholder until the canvas is named for what is on it, which names its folder too (`canvas/admin.ts`).
		this.folder = joined && pens.names().includes(joined) ? joined : pens.claim(UNTITLED, { provisional: true });
		this.of.save();
		return this.folder;
	}

	// --- the stage file (`canvas/pens.ts`) ----------------------------------------------------------
	/*
	 * A stage is a `.pen` file, and its boards are pen `browser` items in it. The file is the one record
	 * of which boards are on the stage, where, and how big: this session keeps no copy of them. It reads
	 * the file when it needs the boards, and writes each change to it as one operation on one board, so
	 * several agents on one stage, and a person on it, never put back each other's work.
	 *
	 * What it does keep is its own: the boards it holds (`held`), and where it last had a board it took
	 * off the stage (`places`), so showing that board again puts it back where it was.
	 */

	/** This agent's stage, when there is a file for it. */
	canvasName(): string | undefined {
		const pens = this.of.stage.pens;
		const name = this.folder;
		return pens && name && pens.has(name) ? name : undefined;
	}

	/** The deck's boards on this agent's stage, as the file has them. */
	private onCanvas(): OnCanvas[] {
		const name = this.canvasName();
		return name ? cardsOn(this.of.stage.pens!, this.of.deck, name) : [];
	}

	/** The boards on the stage: the file's, or, with no stage file, the ones this session was given. */
	private get playing(): string[] {
		return this.canvasName() ? this.onCanvas().map((one) => one.path) : this.loosePlaying;
	}

	/** Where the stage has its boards, and where this agent last had the ones it took off. */
	positions(): Record<string, { x: number; y: number }> {
		const out: Record<string, { x: number; y: number }> = { ...this.places };
		for (const one of this.onCanvas()) out[one.path] = { x: one.x, y: one.y };
		return out;
	}

	/**
	 * The deck as this seat sees it: every card, the ones on its canvas where the canvas has them and
	 * at the size the canvas draws them.
	 *
	 * The canvas goes with the positions, and it is what the deck's fallback layout is measured
	 * against: a card with no place of its own is put beside **the cards on this canvas**, not below
	 * every card this seat was ever given a place for, which on a deck of 900 was a column a million
	 * pixels tall. A card on a canvas file always has its place there, so nothing is written by
	 * building this view; only a seat with no canvas file keeps the places it worked out, so a card
	 * lands once and does not drift each time another is dragged.
	 */
	deckState(): DeckState {
		const seeded: Array<{ path: string; x: number; y: number }> = [];
		const state = this.of.deck.state(this.positions(), (path, at) => seeded.push({ path, ...at }), this.inPlay);
		if (!this.canvasName()) for (const { path, x, y } of seeded) this.setPosition(path, x, y);
		// The size the canvas draws each card at is its item's in the canvas file; a card the seat does not hold keeps its file's size.
		const sizes = this.boardSizes();
		const boards = state.boards.map((board) => {
			const size = sizes[board.path];
			return size && (size.w !== board.w || size.h !== board.h) ? { ...board, w: size.w, h: size.h } : board;
		});
		return { ...state, boards };
	}

	/** How big the stage draws its boards: its file's sizes. */
	private boardSizes(): Record<string, { w: number; h: number }> {
		const out: Record<string, { w: number; h: number }> = {};
		for (const one of this.onCanvas()) out[one.path] = { w: one.w, h: one.h };
		return out;
	}

	/**
	 * Size one board on this agent's stage, in its file. Nothing else sizes a board: a browser's
	 * measurement does not, and neither does a new revision of its file. `decks.canvas.fit` and `decks.canvas.update`
	 * call this; a person's drag sizes the board on the stage on screen, by name (`calls/person-canvas.ts`).
	 */
	setSize(path: string, size: { w?: number; h?: number }): void {
		const name = this.canvasName();
		if (!name) return;
		this.of.stage.pens!.cards.sizeCard(name, path, size);
	}

	/**
	 * Move one board on this agent's stage, in its file; a board not on it is remembered at that place,
	 * for when it is shown.
	 */
	setPosition(path: string, x: number, y: number): void {
		if (!Number.isFinite(x) || !Number.isFinite(y)) return;
		const name = this.canvasName();
		if (name && this.of.stage.pens!.cards.moveCard(name, path, x, y)) return;
		this.places[path] = { x: Math.round(x), y: Math.round(y) };
		this.of.save();
	}

	/**
	 * The stage file changed, by anyone. Its boards are read from it whenever they are needed, so all
	 * there is to do is take up a board that joined the stage and say that it changed.
	 */
	penChanged(): void {
		if (!this.canvasName()) return;
		const before = this.held.length;
		for (const path of [...this.playing].reverse()) if (!this.held.includes(path)) this.held.unshift(path);
		if (this.held.length !== before) this.of.save();
		this.of.arranged?.();
		this.publishContext();
	}

	/**
	 * After a restore. A stage file with boards in it is the truth. A chat whose boards are only in its
	 * record (every chat from before boards moved into the file) writes them in, once.
	 */
	adoptStage(): void {
		if (!this.of.stage.pens) return;
		const restored = this.restoredPlaying;
		this.restoredPlaying = undefined;
		// A record's own list of boards, from before deck version 0.1.0: only in a deck old enough to hold one (`old-records.ts`).
		const adopt = this.of.deck.readsOldShapes ? recordedBoardsToAdopt(this.onCanvas().length, restored) : [];
		if (adopt.length === 0) {
			if (this.canvasName()) this.penChanged();
			return;
		}
		this.setInPlay(adopt);
	}

	/**
	 * Put the chat's camera on another canvas: the browser is sent its drawing, and its boards are the ones this agent sees.
	 *
	 * The agent is told nothing of it. An agent has no home canvas and names the canvas in every call
	 * (`calls/context.ts`), so a move changes nothing about where its work lands, and every message the
	 * person writes says what they were looking at (`looking-at.ts`). It was told, in a note that called
	 * the canvas its home and said calls would act there, once for every tab the person looked at
	 * between two messages. Only a canvas deleted from under it is still said (`stageDeleted`).
	 */
	openStage(name: string): void {
		const pens = this.of.stage.pens;
		if (!pens) throw new Error("This server keeps no stage files.");
		if (!pens.names().includes(name)) throw new Error(`No stage "${name}". decks canvas list lists them; decks canvas create <title> makes one.`);
		if (name === this.folder) return;
		this.folder = name;
		this.of.save();
		for (const path of [...this.playing].reverse()) if (!this.held.includes(path)) this.held.unshift(path);
		this.of.arranged?.();
		this.publishContext();
	}

	/**
	 * A stage was renamed (`canvas/admin.ts`). If it is this agent's, it follows: the stage's
	 * name, and the paths of boards kept in its folder, wherever this session holds them.
	 */
	stageRenamed(from: string, to: string, repoint: (path: string) => string): void {
		if (this.folder !== from) return;
		this.folder = to;
		this.held = this.held.map(repoint);
		const places: typeof this.places = {};
		for (const [path, at] of Object.entries(this.places)) places[repoint(path)] = at;
		this.places = places;
		this.of.save();
		this.of.arranged?.();
		this.publishContext();
	}

	/**
	 * A canvas was deleted. If this agent's camera was on it, the camera goes to a fresh, empty canvas;
	 * the cards it held there are gone with the canvas's folder. It is told so with its next message,
	 * by the canvas's name, since a call that names that canvas would now be refused.
	 */
	stageDeleted(name: string): void {
		if (this.folder !== name) return;
		const gone = (path: string) => !this.of.deck.card(path);
		this.held = this.held.filter((path) => !gone(path));
		for (const path of Object.keys(this.places)) if (gone(path)) delete this.places[path];
		this.folder = undefined;
		this.loosePlaying = [];
		this.of.save();
		const pens = this.of.stage.pens;
		if (!pens) return void this.publishContext();
		const fresh = this.newStage("");
		this.of.tell(`[The canvas "${name}" was deleted, with the cards on it. Your chat's camera is on a new, empty canvas now (--canvas ${fresh}).]`);
	}

	/** A new, empty stage, named from a title, and opened. Returns its folder name. */
	newStage(title: string, options: { provisional?: boolean } = {}): string {
		const pens = this.of.stage.pens;
		if (!pens) throw new Error("This server keeps no stage files.");
		const name = pens.claim(title.trim() || UNTITLED, { provisional: options.provisional === true || !title.trim() });
		this.openStage(name);
		return name;
	}

	/**
	 * Set what the agent holds. `held` is most-recently-touched first, and the callers build the
	 * argument that way. What it holds is its own; the stage is shared, so letting go of a board here
	 * leaves it on the stage for whoever else is on it.
	 */
	setContext(paths: string[]): void {
		this.held = paths.filter((path, index) => paths.indexOf(path) === index);
		this.publishContext();
	}

	/**
	 * Set what is on this agent's stage, in its file: boards not on it are put on it, and boards on it
	 * that are not wanted are taken off, their places remembered here for when they are shown again.
	 * Anything shown is held, so showing is also taking it up. The callers build `paths` from the stage
	 * as the file has it now (`inPlay`), so a board another agent put on the stage a moment ago stays.
	 *
	 * `at` places the boards named in it; every other joining board gets a place by the stage's rule
	 * (`placeJoining`). `place` is kept for the callers that pass it: every joining board is placed.
	 */
	setInPlay(paths: string[], options: { place?: boolean; at?: Record<string, { x: number; y: number }> } = {}): void {
		const wanted = paths.filter((path, index) => paths.indexOf(path) === index);
		// A board shown for the first time is the most recent touch, so it leads the held list.
		const hold = (list: string[]) => {
			for (const path of [...list].reverse()) if (!this.held.includes(path)) this.held.unshift(path);
		};
		const pens = this.of.stage.pens;
		const name = pens ? this.stageName(true) : undefined;
		if (!pens || !name || !pens.has(name)) {
			hold(wanted);
			// No stage file: the places are this session's own, by the same rule (`deck/place.ts`).
			const spots = joinPlaces({
				wanted,
				...(options.at ? { at: options.at } : {}),
				playing: this.loosePlaying.filter((path) => this.places[path]),
				places: this.places,
				size: (path) => {
					const board = this.of.deck.card(path);
					return board ? { w: board.w, h: board.h } : undefined;
				},
			});
			Object.assign(this.places, spots);
			this.loosePlaying = wanted;
			this.of.save();
			this.of.arranged?.();
			this.publishContext();
			return;
		}
		// A board from elsewhere is the canvas's own copy of it (`deck/layout.ts`), made now if it has none.
		const own = wanted.map((path) => pens.cards.ownPath(name, path));
		/*
		 * What is held is what is on the canvas: the copies, never the other canvas's cards they came
		 * from, or the panel lists each card twice and the agent's context names files its canvas does
		 * not show. A path held from before the copy is replaced by its copy.
		 */
		wanted.forEach((path, index) => {
			const copy = own[index]!;
			if (copy !== path) this.held = this.held.filter((one) => one !== path);
		});
		hold(own);
		// A place asked for another canvas's card is the place of its copy.
		const at = options.at ? Object.fromEntries(Object.entries(options.at).map(([path, spot]) => [own[wanted.indexOf(path)] ?? path, spot])) : undefined;
		const leaving = this.onCanvas().filter((one) => !own.includes(one.path)).map((one) => one.path);
		if (leaving.length) Object.assign(this.places, takeOff(pens, this.of.deck, name, leaving));
		for (const path of putOn(pens, this.of.deck, name, own, { ...(at ? { at } : {}), remembered: this.places })) delete this.places[path];
		this.of.save();
		this.of.arranged?.();
		this.publishContext();
	}

	/**
	 * Forget a board that no longer exists.
	 *
	 * A deleted board left in context is worse than it sounds: the rail resolves held
	 * paths against the deck and the canvas filters the deck by what is in play, so one
	 * dead path is enough to make an agent that holds only that board show an empty rail
	 * and an empty canvas — and because the context is not empty, the "holding nothing
	 * shows the whole deck" fallback does not fire. It reads as the deck being gone.
	 */
	forget(path: string): boolean {
		const playing = this.playing.includes(path);
		if (!this.held.includes(path) && !playing && !this.places[path]) return false;
		this.held = this.held.filter((held) => held !== path);
		this.loosePlaying = this.loosePlaying.filter((one) => one !== path);
		delete this.places[path];
		const name = this.canvasName();
		if (playing && name) this.of.stage.pens!.cards.removeCards(name, [path]);
		this.publishContext();
		return true;
	}

	private publishContext(): void {
		this.of.emit({ type: "agent.context", agentId: this.of.id, boards: [...this.held], inPlay: [...this.playing] });
		// The boards are part of the record, and this is not a transcript change, so the
		// translator's hook does not cover it.
		this.of.save();
	}

	/**
	 * Each canvas as it was at this agent's last message: what the next one is compared with, so it is
	 * told what others changed there since (`agents/canvas-news.ts`). Its home canvas, the ones it wrote,
	 * and any it was told about before.
	 */
	private seen = new Map<string, { rev: number; doc: PenDocument }>();
	/** The notes `prompt()` puts first, and takes them: each call compares with the one before. */
	canvasNotes(): string[] {
		const pens = this.of.stage.pens;
		if (!pens) return [];
		const names = new Set([...(this.folder ? [this.folder] : []), ...pens.log.takeWritten(this.of.id), ...this.seen.keys()]);
		const agents = this.of.agents();
		const nameOf = (id: string) => agents.find((one) => one.id === id)?.name ?? "another agent";
		const lines: string[] = [];
		for (const name of names) {
			if (!pens.has(name)) {
				this.seen.delete(name);
				continue;
			}
			const entry = pens.get(name);
			if (entry.error) continue;
			const before = this.seen.get(name);
			if (before && before.rev !== entry.rev) lines.push(...canvasNews(pens.titleOf(name), name, before.doc, entry.doc, pens.log.changesSince(name, before.rev), this.of.id, nameOf));
			this.seen.set(name, { rev: entry.rev, doc: entry.doc });
		}
		return lines;
	}
}
