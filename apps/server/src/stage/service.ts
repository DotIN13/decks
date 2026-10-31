import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Board, Camera, ServerMessage, StageCall, StageResult, WebStatus } from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";
import { withBoardSize } from "../deck/meta.ts";

import { fileUrl, resolveFileRequest } from "../deck/roots.ts";
import { checkAvatar } from "./avatar.ts";
import type { StageShots } from "./shots.ts";
import type { StagePens } from "./pens.ts";
import type { Forwards } from "../ports.ts";
import type { Apps } from "../apps/service.ts";
import type { AppCheck } from "../apps/check.ts";

/**
 * The single path from a tool to the canvas.
 *
 * Two kinds of operation, and the difference matters. A **read** — which boards
 * exist, what one says, where the roots are — the server can answer itself, so it
 * does, immediately. A **camera** operation only the browser can carry out, so it
 * becomes a `stage.call` frame and is awaited.
 *
 * With no browser connected the second kind resolves as a no-op and says so in the
 * result rather than hanging: an agent working while nobody is watching should
 * finish its work and report that the canvas was not there, which is also what
 * makes a headless run possible at all.
 */

export interface StageHost {
	/** Write a board's file, record the revision, and tell everyone. */
	writeBoard(path: string, html: string): Board;
	/** Delete a board's file, keeping its last revision, and tell everyone; the refusal's words, if it is refused. */
	deleteBoard?(path: string): string | undefined;
	/** What the canvas last measured of this board, if what it measured was this revision. */
	extent(path: string, rev: number, at?: number): { w: number; h: number; page?: number } | undefined;
	/** Wait for a measurement of this revision — every frame takes one when it loads. */
	awaitExtent(path: string, rev: number, ms: number, at?: number): Promise<{ w: number; h: number; page?: number } | undefined>;
	/**
	 * Measure the board in the server's own browser, at its own size, the way a canvas would: for a
	 * board no canvas is showing. Absent, or undefined, when there is no browser to do it with.
	 */
	measureAway?(path: string, w?: number): Promise<{ w: number; h: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number } | undefined>;
	/** Words counted and the smallest type on the board at this revision, when a browser reported them. */
	/** Press every control on the board in a headless page and report the views that break it. Advice: absent when it cannot run. */
	views?(path: string): Promise<{ controls: number; opening: number; views: Array<{ label: string; h: number; overflowX: number }>; errors: string[] } | undefined>;
	reading?(path: string, rev: number): { words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number };
	/** Send to the focused browser, and resolve when it answers. */
	call(call: Omit<StageCall, "id">, timeoutMs?: number): Promise<unknown>;
	/** Send to every browser, and resolve with every answer that came in time. Optional: `call` is the fallback. */
	callAll?(call: Omit<StageCall, "id">, timeoutMs?: number): Promise<unknown[]>;
	/** Is anyone looking? */
	connected(): boolean;
	broadcast(message: ServerMessage): void;
	/** The list of canvases changed without a drawing changing (a name): tell the browsers. */
	stagesChanged?(): void;
	/** Say who last wrote a board, as the person's own edits do (`BoardService.wrote`). */
	wrote?(path: string, who: string): void;
	/** Give a canvas a name; the first name anyone chooses names its folder too (`stage-admin.ts`). Returns the folder. */
	retitle?(name: string, title: string): string;
	/** The camera the browser last reported for one agent's canvas. */
	camera(agentId: string): Camera;
	/** Agents, for `decks.agent.list()` and for `inContext` on every board. */
	agents(): Array<{ id: string; name: string; state: string; context: string[]; tags: string[] }>;
	/**
	 * Move a board on the stage this host is serving, and answer with the board as that stage sees it.
	 *
	 * On the host rather than the deck because the deck stopped having an arrangement: the position
	 * belongs to an agent, and the host is what holds one.
	 */
	place(agentId: string, path: string, x: number, y: number): Board | undefined;
	/**
	 * Every board as one stage sees it — the arrangement, not the loader's zeroes.
	 *
	 * **Answered for the agent that asked.** A move is written on the caller's own canvas
	 * (`place`), so a read served from whichever conversation the browser happens to be looking
	 * at would tell an agent that its own move did not happen — which is what it did, until an
	 * agent moved four boards while the person was reading another chat and `decks.canvas.read()`
	 * gave back all four places from before.
	 *
	 * Optional, like `StageAgentHooks.positions`, so a host that does not arrange omits it and a
	 * test can build one without a stage behind it. `StageService.boards` falls back to the deck's
	 * own list; no id means the conversation on screen, which is what a board's own code gets.
	 */
	boards?(agentId?: string): Board[];

}

/**
 * How an agent names the thing it wants in the shared tab.
 *
 * A **name** is what a person would call it — the label, the placeholder, the words on the
 * button. It is the readable form and stays the default. Two others exist because a real
 * form defeats names: `{ ref }` is an id from `read()`'s snapshot, which is the only way to
 * reach a field with no label at all or a control the page hides and paints over; and
 * `{ name, nth }` picks one of several things with the same name, counting from 1.
 */
export type WebTarget = string | { ref: string } | { name: string; nth?: number };

/** What the stage tool needs of the shared browser. `WebBridge` is the one implementation. */
export interface WebHost {
	code(): string;
	repair(): string;
	status(): WebStatus;
	stop(): void;
	open(url: string): Promise<{ url: string; title: string }>;
	read(): Promise<{ url: string; title: string; snapshot: string; truncated?: boolean }>;
	screenshot(options?: { full?: boolean }): Promise<{ file: string; width: number; height: number; png: Buffer }>;
	fill(field: WebTarget, text: string): Promise<{ field: string }>;
	select(field: WebTarget, option: string): Promise<{ field: string; option: string }>;
	click(what: WebTarget): Promise<{ clicked: string }>;
	press(key: string): Promise<{ pressed: string }>;
	submit(what?: WebTarget, options?: { ask?: boolean }): Promise<{ submitted: string; allowed: boolean }>;
}

/** The room `decks.canvas.fit` leaves under the content — the margin a board's own components start at. */
const FIT_MARGIN = 48;

/** How long `decks.canvas.fit` waits for the frame to load and report, before saying nobody looked. */
const FIT_WAIT_MS = 5000;
/** How long `decks.canvas.fit` waits for a canvas before measuring the board in the server's own browser as well. */
const AWAY_AFTER_MS = 1200;

export class StageService {
	/**
	 * The user's shared Chrome, if the app has one (`browser/bridge.ts`).
	 *
	 * Held here rather than threaded through the registry and every session, because it is
	 * one object per server, like the deck, and the stage tool is the only thing that reads
	 * it. `undefined` in the tests that build a service on its own.
	 */
	web: WebHost | undefined;
	/**
	 * Every agent's stage drawing, as `.pen` files (`stage/pens.ts`).
	 *
	 * On the service for the reason `web` is: one per server, and the stage tool is what reads it.
	 * `undefined` in tests that build a service without a deck on disk.
	 */
	pens: StagePens | undefined;
	/** The ports forwarded through Decks, which agents open and close (`ports.ts`). `undefined` in tests without one. */
	forwards: Forwards | undefined;
	/** The deck's apps (`apps/service.ts`). `undefined` in tests without one. */
	apps: Apps | undefined;
	/** A fresh pairing code for another Decks front end (`share/pairing.ts`), for `decks pair code`. */
	pairCode: (() => { code: string; expires: number }) | undefined;
	/** An app opened in the server's own Chromium (`apps/check.ts`). */
	appCheck: ((name: string) => Promise<AppCheck>) | undefined;
	/** Pictures of a stage, taken in the server's own Chromium (`stage/shots.ts`). */
	shots: StageShots | undefined;
	/** The server's own picture of a whole board, fresh from its file (`pictures/thumbs.ts`): what a screenshot falls back to. */
	boardPicture: ((path: string, scheme: "light" | "dark") => Promise<Buffer>) | undefined;

	constructor(
		private deck: Deck,
		private readonly host: StageHost,
	) {}

	/** The list of canvases changed without a drawing changing (a name): tell the browsers. */
	stagesChanged(): void {
		this.host.stagesChanged?.();
	}

	/** A board as its file has it (whether it fills its frame), not as a stage places it. */
	fileBoard(path: string): Board | undefined {
		return this.deck.board(path);
	}

	/** Every board file in the deck, as its file has it, placed anywhere or nowhere. */
	allBoards(): Board[] {
		return [...this.deck.boards];
	}

	/** Say who last wrote a board: `you` for the person's own resize. */
	wrote(path: string, who: string): void {
		this.host.wrote?.(path, who);
	}

	/** Tell every browser a board changed on this agent's stage, as that stage now places it. */
	announce(agentId: string, path: string): void {
		const board = this.boards(agentId).find((one) => one.path === path);
		if (board) this.host.broadcast({ type: "board.changed", path: board.path, rev: board.rev, board });
	}

	/** Name a canvas (`StageHost.retitle`); without a host that can, only its title changes. */
	retitle(name: string, title: string): string {
		if (this.host.retitle) return this.host.retitle(name, title);
		this.pens?.setTitle(name, title);
		return name;
	}

	/** The deck folder, for verbs that keep a file of their own there (`studio.connect`). */
	deckPath(): string {
		return this.deck.path;
	}

	setDeck(deck: Deck): void {
		this.deck = deck;
	}

	// --- reads --------------------------------------------------------------------

	/** Every board, placed as the asking agent's stage has them. */
	boards(agentId?: string): Board[] {
		const holders = this.host.agents();
		/*
		 * The host's arrangement when there is one, and the deck's own list when there is not.
		 *
		 * A board's `x`/`y` on the loader is zero — it has carried no place of its own since positions
		 * became per stage — so returning `deck.boards` here for a real app would tell every agent that
		 * every board is at the origin, which is worse than saying nothing.
		 */
		return (this.host.boards?.(agentId) ?? this.deck.boards).map((board) => {
			// A measurement of an older revision is left off rather than reported: it is a
			// number, and a number gets believed.
			const content = this.host.extent(board.path, board.rev);
			return {
				...board,
				...(content ? { content, clipped: content.w > board.w || content.h > board.h } : {}),
				inContext: holders.filter((agent) => agent.context.includes(board.path)).map((agent) => agent.id),
			};
		});
	}

	read(path: string): string {
		return readFileSync(this.deck.fileOf(path), "utf8");
	}

	roots() {
		return this.deck.roots.roots;
	}

	/** A path on disk -> the URL a board should embed. Refuses what the route would. */
	resolve(file: string): string {
		return fileUrl(resolveFileRequest(this.deck.roots, { path: file }));
	}

	/** Where Playwright should point to look at a board. */
	url(path: string, port: number): string {
		const board = this.deck.board(path);
		const rev = board ? `?rev=${board.rev}` : "";
		const encoded = path.split("/").map(encodeURIComponent).join("/");
		return `http://127.0.0.1:${port}/api/board/${encoded}${rev}`;
	}

	// --- writes the server owns ----------------------------------------------------

	/**
	 * A board moved **on the canvas of the agent that asked**.
	 *
	 * The deck has no arrangement to write to any more, so the move goes to the host, which is the
	 * thing holding the agent whose canvas this is. What comes back is the board as that stage sees
	 * it, so the caller broadcasts a position rather than a stale one.
	 *
	 * The agent is named rather than assumed. It used to be whichever conversation the browser
	 * acted on last, which is only the same agent when you happen to be watching the one that
	 * called: a background agent tidying its own canvas moved a board on yours instead, and its own
	 * stayed where it was.
	 */
	move(agentId: string, path: string, at: { x: number; y: number }): Board {
		const board = this.host.place(agentId, path, at.x, at.y);
		if (!board) throw new Error(`No such board: ${path}`);
		this.host.broadcast({ type: "board.changed", path: board.path, rev: board.rev, board });
		return board;
	}

	/** Write a card's file (a canvas's `cards/`), recorded and announced as a board's write is. */
	writeCard(path: string, html: string): Board {
		return this.host.writeBoard(path, html);
	}

	/**
	 * Set a board's size: the one number in the file, written by the thing that owns it.
	 *
	 * An agent editing `<meta name="board">` by hand works and is a bad idea — it is JSON
	 * inside an HTML attribute, and the write has to keep every other byte where it was.
	 * Here the deck's own record is refreshed as part of the write, so a resize can never
	 * be a change the canvas does not know about.
	 */
	resize(path: string, size: { w?: number; h?: number }): Board {
		const board = this.deck.board(path);
		if (!board) throw new Error(`No such board: ${path}`);
		if (size.w === undefined && size.h === undefined) throw new Error("A resize needs a width, a height, or both");
		const html = readFileSync(this.deck.fileOf(path), "utf8");
		return this.host.writeBoard(path, withBoardSize(path, html, size));
	}

	/**
	 * Size a board to its content — **the height, and only the height**, at width `w`: the width the
	 * board has on the canvas it is fitted on (`tool.ts`), or the file's own. The width is never
	 * measured: a board pinned to a measured width would reflow its text every time the measurement
	 * changed. The height is measured at that width, and both go to the board's file, as a person's
	 * resize writes them.
	 *
	 * The height is the one number a board cannot state for itself: it is what the content came to
	 * once it was laid out, and only the browser knows it. So this reads what the frame measured and
	 * writes that, plus — on a component board — the margin its boxes start at.
	 *
	 * It used to take the width too, in two passes: set the width, wait for the reflow, measure the
	 * height that produced. That made `decks.canvas.fit` the one call that could silently reflow a board — and on
	 * a **flow** document, whose `.doc` is `width: 100%` of the frame, the "content width" it read
	 * back was the frame's own width, so every fit added the margin and grew the board by 48px.
	 */
	async fit(path: string, options?: { margin?: number; w?: number }): Promise<{ board: Board; content: { w: number; h: number }; reading: { words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number }; views?: { controls: number; opening: number; views: Array<{ label: string; h: number; overflowX: number }>; errors: string[] } }> {
		// The record first: an agent calls this straight after writing the content, and
		// the revision we wait for a measurement of has to be the one now on disk.
		this.deck.refresh(path);
		const board = this.deck.board(path);
		if (!board) throw new Error(`No such board: ${path}`);

		const margin = Math.max(0, Math.min(400, Math.round(options?.margin ?? FIT_MARGIN)));

		const w = Math.round(options?.w ?? board.w);
		const { reading: away, ...measured } = await this.measure(path, board.rev, w);
		/*
		 * A board is one page, and the page ends in its own bottom padding, which is already part of
		 * what the browser measured (`page`): it is fitted to that exactly. Adding a margin would make
		 * the board taller than the page it shows, a strip of nothing along the bottom. Only a reading
		 * with no `page` in it (a frame from an older build) gets the margin.
		 */
		const ends = measured.page !== undefined && measured.page >= measured.h;
		/*
		 * A board that is one box filling it — an app, a document page, one file — is the size it was
		 * given: the box ends at the board's foot because the board does, so fitting it to the box
		 * plus a margin grew it by the margin every time it was asked.
		 */
		const h = board.fills ? board.h : ends ? measured.h : measured.h + margin;
		const reading = away ?? this.host.reading?.(path, board.rev) ?? {};
		// Six seconds at most: the check is advice, and a fit that hangs on it is worse than one without it.
		const views = await Promise.race([this.host.views?.(path) ?? Promise.resolve(undefined), new Promise<undefined>((done) => setTimeout(() => done(undefined), 6000))]).catch(() => undefined);
		return { board: h === board.h && w === board.w ? board : this.resize(path, { w, h }), content: measured, reading, ...(views ? { views } : {}) };
	}

	/**
	 * What this revision of a board measures, laid out in a browser.
	 *
	 * The canvas's own measurement first: every frame reports one when it loads and on every
	 * revision, so a board on screen answers at once. A board nobody is looking at — the usual
	 * case for an agent writing on its own stage while the person watches another — has no frame,
	 * and after a short wait for one it is measured in the server's own browser instead
	 * (`measureAway`), at its own size and by the same code. Whichever answers first is used; the
	 * error is left for when neither can.
	 */
	private async measure(path: string, rev: number, at: number): Promise<{ w: number; h: number; page?: number; reading?: { words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number } }> {
		// A frame's reading counts only when it laid the board out at this width.
		const known = this.host.extent(path, rev, at);
		if (known) return known;
		const canvas = this.host.awaitExtent(path, rev, FIT_WAIT_MS, at);
		const away = this.host.measureAway
			? new Promise<void>((done) => setTimeout(done, AWAY_AFTER_MS)).then(async () => {
					// A canvas that answered in the meantime wins: its numbers are the person's own browser's.
					if (this.host.extent(path, rev, at)) return undefined;
					const found = await this.host.measureAway?.(path, at).catch(() => undefined);
					if (!found) return undefined;
					const { w, h, page, ...reading } = found;
					return { w, h, ...(page === undefined ? {} : { page }), reading };
				})
			: Promise.resolve(undefined);
		const first = await Promise.race([canvas.then((extent) => extent ?? away), away.then((extent) => extent ?? canvas)]);
		if (!first) {
			throw new Error(
				`Nothing has measured ${path} yet. A board is measured in the frame showing it, so put it on the canvas — decks canvas insert '{"type":"board","board":"${path}"}' — and ask again.`,
			);
		}
		return first;
	}

	/**
	 * An agent's avatar, drawn by the agent, stored beside the deck.
	 *
	 * Checked and repaired on the way in (`avatar.ts`), which is the only place it can be: this is
	 * what every caller writing an avatar goes through, and what is on disk here is served straight
	 * to the browser as an image. `changed` is the sentence to hand back to the agent when its
	 * markup needed a repair, so it learns rather than drawing the same broken shape again.
	 */
	writeAvatar(agentId: string, svg: string): { url: string; changed?: string } {
		const checked = checkAvatar(svg);
		const file = join(this.deck.path, ".decks", "avatars", `${agentId}.svg`);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, checked.svg);
		// The revision is a fresh id rather than a hash: an avatar is written once per
		// change and the only job of the query is to get past the browser's cache.
		const url = `/api/avatar/${agentId}?rev=${randomUUID().slice(0, 8)}`;
		return checked.changed === undefined ? { url } : { url, changed: checked.changed };
	}

	// --- the browser's half ---------------------------------------------------------

	camera(agentId: string): Camera {
		return this.host.camera(agentId);
	}

	/**
	 * How much room the canvas has, in CSS pixels — or nothing, if no browser ever said.
	 *
	 * `undefined` rather than a default, and that is the whole design: a number an agent can
	 * size a board against has to be a number somebody measured. A headless run and a fresh
	 * session before the first reading both get nothing, and an agent told nothing picks its
	 * own size, which is what it would have done anyway.
	 */
	viewport(agentId: string): { width: number; height: number } | undefined {
		const { width, height } = this.host.camera(agentId);
		if (!width || !height) return undefined;
		return { width, height };
	}

	/**
	 * Every one of these says which agent asked, and the browser decides what that means.
	 *
	 * The rule it applies: an operation that moves *the view* is carried out when the agent
	 * is the conversation on screen, and remembered against that agent when it is not — so it
	 * arrives, framed as it intended, the moment you open that chat. The result says which
	 * happened, so an agent working in the background is told rather than lied to.
	 */
	async setCamera(agentId: string, at: Camera, options: { animate?: boolean } = {}): Promise<unknown> {
		return this.ask(agentId, { op: "camera", args: { ...at, animate: options.animate } });
	}

	/**
	 * Put these boards on the canvas, and answer with what the browser did.
	 *
	 * The result is the browser's: which boards it moved to, and the sentence it left on the
	 * canvas when this agent's view was remembered rather than moved (the camera is per
	 * conversation — §7). Typed rather than `unknown` because `stage.d.ts` promises the
	 * shape to the agent, and the agent writes code against what that file says.
	 */
	async show(
		agentId: string,
		paths: string[],
		options: { fit?: "board" | "all"; highlight?: string; animate?: boolean; items?: Array<{ id: string; box: { x: number; y: number; w: number; h: number } }>; stage?: string } = {},
	): Promise<{ shown: string[]; deferred?: string }> {
		for (const path of paths) {
			if (!this.deck.board(path)) throw new Error(`No such board: ${path}`);
		}
		/*
		 * Drawn items travel as boxes rather than as ids, because where an item *is* is a
		 * question about the layout, and the server has already answered it (`pens.placedOf`).
		 * The browser would have to ask its own canvas the same question and could get a
		 * different answer while a file is being rewritten.
		 */
		const answer = await this.ask(agentId, { op: "show", args: { paths, ...options } });
		const result = (answer ?? {}) as { shown?: unknown; deferred?: unknown; skipped?: unknown; error?: unknown };
		// With a canvas named (`view.focus`), a browser showing another says so, as does one that is not there.
		const why = typeof result.deferred === "string" ? result.deferred : options.stage && typeof result.skipped === "string" ? result.skipped : options.stage && typeof result.error === "string" ? result.error : undefined;
		return {
			shown: Array.isArray(result.shown) ? result.shown.filter((path): path is string => typeof path === "string") : [],
			...(why ? { deferred: why } : {}),
		};
	}

	async reload(agentId: string, path: string): Promise<void> {
		await this.ask(agentId, { op: "reload", args: { path } });
	}

	/**
	 * Reload a board's page in every browser showing it: on one canvas, or on any. Every browser is
	 * asked, and each says how many pages it reloaded (one, or none when the board is not on the
	 * canvas it shows), so the answer is a count rather than a guess.
	 */
	async reloadEverywhere(agentId: string, path: string, stage?: string): Promise<number> {
		if (!this.deck.board(path)) throw new Error(`No such board: ${path}`);
		if (!this.host.connected()) return 0;
		const call = { op: "reload" as const, agentId, args: { path, count: true, ...(stage ? { stage } : {}) } };
		const answers = this.host.callAll ? await this.host.callAll(call, 1500) : [await this.host.call(call, 1500)];
		return answers.reduce<number>((sum, answer) => sum + (typeof (answer as { pages?: unknown } | undefined)?.pages === "number" ? (answer as { pages: number }).pages : 0), 0);
	}

	/**
	 * Bring the person's screen to a canvas (`view.goto`). The browser does it by opening a
	 * conversation that is on that canvas, the caller's own first; it answers whether it moved.
	 */
	async goto(agentId: string, stage: string): Promise<{ moved: boolean; note?: string }> {
		const answer = (await this.ask(agentId, { op: "goto", args: { stage } })) as { moved?: unknown; note?: unknown; deferred?: unknown; skipped?: unknown; error?: unknown } | undefined;
		const note = [answer?.note, answer?.deferred, answer?.skipped, answer?.error].find((one): one is string => typeof one === "string");
		return { moved: answer?.moved === true, ...(note ? { note } : {}) };
	}

	async cursor(agentId: string, path: string, at: { x: number; y: number } | null, label: string, color: string): Promise<void> {
		await this.ask(agentId, { op: "cursor", args: { path, at, label, color } });
	}

	/**
	 * A board as the person's browser has it now (`stage.call` op `shot`): drawn there by
	 * HTML-in-Canvas, or from a snapshot the server's Chrome draws, so it shows what the person did
	 * on the page. `none` when no browser is looking or it has no live page for the board.
	 */
	async seenBoard(agentId: string, path: string): Promise<{ how: "canvas" | "snapshot"; bytes: Buffer; mime: string } | { how: "none"; why: string }> {
		const value = (await this.ask(agentId, { op: "shot", args: { path } }, 20_000)) as { how?: string; data?: string; mime?: string; why?: string; skipped?: string } | undefined;
		if (value && (value.how === "canvas" || value.how === "snapshot") && typeof value.data === "string") {
			return { how: value.how, bytes: Buffer.from(value.data, "base64"), mime: value.mime ?? "image/png" };
		}
		return { how: "none", why: value?.why ?? value?.skipped ?? "the person's browser did not answer" };
	}

	private async ask(agentId: string, call: Omit<StageCall, "id" | "agentId">, timeoutMs?: number): Promise<unknown> {
		if (!this.host.connected()) {
			// Not an error: an agent can do useful work with nobody watching, and it
			// should be told rather than blocked.
			return { skipped: "no browser is connected to the canvas" };
		}
		return this.host.call({ ...call, agentId }, timeoutMs);
	}
}

export type { StageResult };
