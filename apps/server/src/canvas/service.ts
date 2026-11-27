import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Page, Camera, ServerMessage, StageCall, StageResult, WebStatus } from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";
import { withCardSize } from "@decks/deck-kit";

import { fileUrl, resolveFileRequest } from "../deck/roots.ts";
import { checkAvatar } from "./avatar.ts";
import type { CanvasShots } from "./shots.ts";
import type { CanvasPens } from "./pens.ts";
import type { Forwards } from "../ports.ts";
import type { Apps } from "../apps/service.ts";
import type { AppCheck } from "../apps/check.ts";

/**
 * The single path from a tool to the canvas.
 *
 * Two kinds of operation, and the difference matters. A **read** — which cards
 * exist, what one says, where the roots are — the server can answer itself, so it
 * does, immediately. A **camera** operation only the browser can carry out, so it
 * becomes a `stage.call` frame and is awaited.
 *
 * With no browser connected the second kind resolves as a no-op and says so in the
 * result rather than hanging: an agent working while nobody is watching should
 * finish its work and report that the canvas was not there, which is also what
 * makes a headless run possible at all.
 */

export interface CanvasServiceHost {
	/** Write a card's file, record the revision, and tell everyone. */
	writeCard(path: string, html: string): Page;
	/** Delete a card's file, keeping its last revision, and tell everyone; the refusal's words, if it is refused. */
	deleteCard?(path: string): string | undefined;
	/** What the canvas last measured of this card, if what it measured was this revision. */
	extent(path: string, rev: number, at?: number): { w: number; h: number; page?: number } | undefined;
	/** Wait for a measurement of this revision — every frame takes one when it loads. */
	awaitExtent(path: string, rev: number, ms: number, at?: number): Promise<{ w: number; h: number; page?: number } | undefined>;
	/**
	 * Measure the card in the server's own browser, at its own size, the way a canvas would: for a
	 * card no canvas is showing. Absent, or undefined, when there is no browser to do it with.
	 */
	measureAway?(path: string, w?: number): Promise<{ w: number; h: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number } | undefined>;
	/** Words counted and the smallest type on the card at this revision, when a browser reported them. */
	/** Press every control on the card in a headless page and report the views that break it. Advice: absent when it cannot run. */
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
	/** Say who last wrote a card, as the person's own edits do (`CardService.wrote`). */
	wrote?(path: string, who: string): void;
	/** Give a canvas a name; the first name anyone chooses names its folder too (`admin.ts`). Returns the folder. */
	retitle?(name: string, title: string): string;
	/** The camera the browser last reported for one agent's canvas. */
	camera(agentId: string): Camera;
	/** Agents, for `decks.agent.list()` and for `inContext` on every card. */
	agents(): Array<{ id: string; name: string; state: string; context: string[]; tags: string[] }>;
	/**
	 * Move a card on the canvas this host is serving, and answer with the card as that canvas sees it.
	 *
	 * On the host rather than the deck because the deck stopped having an arrangement: the position
	 * belongs to an agent, and the host is what holds one.
	 */
	place(agentId: string, path: string, x: number, y: number): Page | undefined;
	/**
	 * Every card as one canvas sees it — the arrangement, not the loader's zeroes.
	 *
	 * **Answered for the agent that asked.** A move is written on the caller's own canvas
	 * (`place`), so a read served from whichever conversation the browser happens to be looking
	 * at would tell an agent that its own move did not happen — which is what it did, until an
	 * agent moved four cards while the person was reading another chat and `decks.canvas.read()`
	 * gave back all four places from before.
	 *
	 * Optional, like `AgentHooks.positions`, so a host that does not arrange omits it and a
	 * test can build one without a canvas behind it. `CanvasService.boards` falls back to the deck's
	 * own list; no id means the conversation on screen, which is what a card's own code gets.
	 */
	cards?(agentId?: string): Page[];

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

/** What the canvas tool needs of the shared browser. `WebBridge` is the one implementation. */
interface WebHost {
	code(): string;
	repair(): string;
	status(): WebStatus;
	stop(): void;
	open(url: string): Promise<{ url: string; title: string }>;
	focus(what: WebTarget): Promise<{ focused: string }>;
	type(text: string, into?: WebTarget): Promise<{ typed: number; into?: string }>;
	/** The tabs of the Decks group (`browser/tabs.ts`). */
	readonly group: {
		list(): Promise<{ index: number; title: string; url: string; current: boolean }[]>;
		open(url?: string): Promise<{ index: number; url: string; title: string }>;
		use(which: number | string): Promise<{ index: number; url: string; title: string }>;
		close(which?: number | string): Promise<{ closed: string; tabs: number }>;
	};
	values(): Promise<{ url: string; fields: { label: string; value: string; kind: string }[] }>;
	read(options?: { full?: boolean }): Promise<{ url: string; title: string; snapshot: string; truncated?: boolean }>;
	screenshot(options?: { full?: boolean }): Promise<{ file: string; width: number; height: number; png: Buffer }>;
	fill(field: WebTarget, text: string): Promise<{ field: string }>;
	select(field: WebTarget, option: string): Promise<{ field: string; option: string; byKeyboard?: boolean }>;
	click(what: WebTarget, options?: { ask?: boolean }): Promise<{ clicked: string; navigated?: string; changed?: boolean; allowed?: boolean }>;
	press(key: string): Promise<{ pressed: string; navigated?: string; changed?: boolean }>;
	submit(what?: WebTarget, options?: { ask?: boolean }): Promise<{ submitted: string; allowed: boolean }>;
}

/** The room `decks.canvas.fit` leaves under the content — the margin a card's own components start at. */
const FIT_MARGIN = 48;

/** How long `decks.canvas.fit` waits for the frame to load and report, before saying nobody looked. */
const FIT_WAIT_MS = 5000;
/** How long `decks.canvas.fit` waits for a canvas before measuring the card in the server's own browser as well. */
const AWAY_AFTER_MS = 1200;

export class CanvasService {
	/**
	 * The user's shared Chrome, if the app has one (`browser/bridge.ts`).
	 *
	 * Held here rather than threaded through the registry and every session, because it is
	 * one object per server, like the deck, and the canvas tool is the only thing that reads
	 * it. `undefined` in the tests that build a service on its own.
	 */
	web: WebHost | undefined;
	/**
	 * Every agent's canvas drawing, as `.pen` files (`canvas/pens.ts`).
	 *
	 * On the service for the reason `web` is: one per server, and the canvas tool is what reads it.
	 * `undefined` in tests that build a service without a deck on disk.
	 */
	pens: CanvasPens | undefined;
	/** The ports forwarded through Decks, which agents open and close (`ports.ts`). `undefined` in tests without one. */
	forwards: Forwards | undefined;
	/** The deck's apps (`apps/service.ts`). `undefined` in tests without one. */
	apps: Apps | undefined;
	/** A fresh pairing code for another Decks front end (`auth/issue.ts`), for `decks pair code`. */
	pairCode: (() => { code: string; expires: number }) | undefined;
	/** Start signing the harness in to Decks Studio (`studio/login.ts`): the address that shows its code; then the code, pasted; and the sign-in under way. Set by the app. */
	studioLogin: ((url?: string) => Promise<{ url: string; studio: string; expires: number }>) | undefined;
	studioCode: ((code: string) => Promise<{ url: string; account?: string }>) | undefined;
	studioShowing: (() => { open?: { url: string; studio: string; expires: number }; failed?: string }) | undefined;
	/** How far the deck is in step with Studio, as its sync last said; set by the app. */
	studioSync: (() => import("@decks/protocol").StudioSyncRow | undefined) | undefined;
	/** Sign the harness out of Studio as Settings does (`studio/index.ts`, `unpairStudio`); set by the app. */
	studioSignOut: (() => void) | undefined;
	/** An app opened in the server's own Chromium (`apps/check.ts`). */
	appCheck: ((name: string) => Promise<AppCheck>) | undefined;
	/** Pictures of a canvas, taken in the server's own Chromium (`canvas/shots.ts`). */
	shots: CanvasShots | undefined;
	/** The server's own picture of a whole card, fresh from its file (`pictures/service.ts`): what a screenshot falls back to. */
	cardPicture: ((path: string, scheme: "light" | "dark") => Promise<Buffer>) | undefined;

	constructor(
		private deck: Deck,
		private readonly host: CanvasServiceHost,
	) {}

	/** The list of canvases changed without a drawing changing (a name): tell the browsers. */
	stagesChanged(): void {
		this.host.stagesChanged?.();
	}

	/** A card as its file has it, not as a canvas places it. */
	fileCard(path: string): Page | undefined {
		return this.deck.card(path);
	}

	/** Every card file in the deck, as its file has it, placed anywhere or nowhere. */
	allCards(): Page[] {
		return [...this.deck.cards];
	}

	/** Say who last wrote a card: `you` for the person's own resize. */
	wrote(path: string, who: string): void {
		this.host.wrote?.(path, who);
	}

	/** Tell every browser a card changed on this agent's canvas, as that canvas now places it. */
	announce(agentId: string, path: string): void {
		const card = this.cards(agentId).find((one) => one.path === path);
		if (card) this.host.broadcast({ type: "card.changed", path: card.path, rev: card.rev, card });
	}

	/** Name a canvas (`CanvasServiceHost.retitle`); without a host that can, only its title changes. */
	retitle(name: string, title: string): string {
		if (this.host.retitle) return this.host.retitle(name, title);
		this.pens?.setTitle(name, title);
		return name;
	}

	/** The deck folder, for verbs that read a file of their own there (`studio.status`). */
	deckPath(): string {
		return this.deck.path;
	}

	setDeck(deck: Deck): void {
		this.deck = deck;
	}

	// --- reads --------------------------------------------------------------------

	/** Every card, placed as the asking agent's canvas has them. */
	cards(agentId?: string): Page[] {
		const holders = this.host.agents();
		/*
		 * The host's arrangement when there is one, and the deck's own list when there is not.
		 *
		 * A card's `x`/`y` on the loader is zero — it has carried no place of its own since positions
		 * became per canvas — so returning `deck.boards` here for a real app would tell every agent that
		 * every card is at the origin, which is worse than saying nothing.
		 */
		return (this.host.cards?.(agentId) ?? this.deck.cards).map((card) => {
			// A measurement of an older revision is left off rather than reported: it is a
			// number, and a number gets believed.
			const content = this.host.extent(card.path, card.rev);
			return {
				...card,
				...(content ? { content, clipped: content.w > card.w || content.h > card.h } : {}),
				inContext: holders.filter((agent) => agent.context.includes(card.path)).map((agent) => agent.id),
			};
		});
	}

	read(path: string): string {
		return readFileSync(this.deck.fileOf(path), "utf8");
	}

	/** Where the deck's files may be read from: the deck, and the roots it declares (`deck/roots.ts`). */
	roots() {
		return this.deck.roots;
	}

	/** A path on disk -> the URL a card should embed. Refuses what the route would. */
	resolve(file: string): string {
		return fileUrl(resolveFileRequest(this.deck.roots, { path: file }));
	}

	/** Where Playwright should point to look at a card, under `/api/card/`. */
	url(path: string, port: number): string {
		const card = this.deck.card(path);
		const rev = card ? `?rev=${card.rev}` : "";
		const encoded = path.split("/").map(encodeURIComponent).join("/");
		return `http://127.0.0.1:${port}/api/card/${encoded}${rev}`;
	}

	// --- writes the server owns ----------------------------------------------------

	/**
	 * A card moved **on the canvas of the agent that asked**.
	 *
	 * The deck has no arrangement to write to any more, so the move goes to the host, which is the
	 * thing holding the agent whose canvas this is. What comes back is the card as that canvas sees
	 * it, so the caller broadcasts a position rather than a stale one.
	 *
	 * The agent is named rather than assumed. It used to be whichever conversation the browser
	 * acted on last, which is only the same agent when you happen to be watching the one that
	 * called: a background agent tidying its own canvas moved a card on yours instead, and its own
	 * stayed where it was.
	 */
	move(agentId: string, path: string, at: { x: number; y: number }): Page {
		const card = this.host.place(agentId, path, at.x, at.y);
		if (!card) throw new Error(`No such board: ${path}`);
		this.host.broadcast({ type: "card.changed", path: card.path, rev: card.rev, card });
		return card;
	}

	/** Write a card's file (a canvas's `cards/`), recorded and announced as a card's write is. */
	writeCard(path: string, html: string): Page {
		return this.host.writeCard(path, html);
	}

	/**
	 * Set a card's size: the one number in the file, written by the thing that owns it.
	 *
	 * An agent editing `<meta name="board">` by hand works and is a bad idea — it is JSON
	 * inside an HTML attribute, and the write has to keep every other byte where it was.
	 * Here the deck's own record is refreshed as part of the write, so a resize can never
	 * be a change the canvas does not know about.
	 */
	resize(path: string, size: { w?: number; h?: number }): Page {
		const card = this.deck.card(path);
		if (!card) throw new Error(`No such board: ${path}`);
		if (size.w === undefined && size.h === undefined) throw new Error("A resize needs a width, a height, or both");
		const html = readFileSync(this.deck.fileOf(path), "utf8");
		return this.host.writeCard(path, withCardSize(html, size));
	}

	/**
	 * Size a card to its content — **the height, and only the height**, at width `w`: the width the
	 * card has on the canvas it is fitted on (`tool.ts`), or the file's own. The width is never
	 * measured: a card pinned to a measured width would reflow its text every time the measurement
	 * changed. The height is measured at that width, and both go to the card's file, as a person's
	 * resize writes them.
	 *
	 * The height is the one number a card cannot state for itself: it is what the content came to
	 * once it was laid out, and only the browser knows it. So this reads what the frame measured and
	 * writes that, plus — on a component card — the margin its boxes start at.
	 *
	 * It used to take the width too, in two passes: set the width, wait for the reflow, measure the
	 * height that produced. That made `decks.canvas.fit` the one call that could silently reflow a card — and on
	 * a **flow** document, whose `.doc` is `width: 100%` of the frame, the "content width" it read
	 * back was the frame's own width, so every fit added the margin and grew the card by 48px.
	 */
	async fit(path: string, options?: { margin?: number; w?: number }): Promise<{ board: Page; content: { w: number; h: number }; reading: { words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number }; views?: { controls: number; opening: number; views: Array<{ label: string; h: number; overflowX: number }>; errors: string[] } }> {
		// The record first: an agent calls this straight after writing the content, and
		// the revision we wait for a measurement of has to be the one now on disk.
		this.deck.refresh(path);
		const card = this.deck.card(path);
		if (!card) throw new Error(`No such board: ${path}`);

		const margin = Math.max(0, Math.min(400, Math.round(options?.margin ?? FIT_MARGIN)));

		const w = Math.round(options?.w ?? card.w);
		const { reading: away, ...measured } = await this.measure(path, card.rev, w);
		/*
		 * A card is one page, and the page ends in its own bottom padding, which is already part of
		 * what the browser measured (`page`): it is fitted to that exactly. Adding a margin would make
		 * the card taller than the page it shows, a strip of nothing along the bottom. Only a reading
		 * with no `page` in it (a frame from an older build) gets the margin.
		 */
		const ends = measured.page !== undefined && measured.page >= measured.h;
		/*
		 * A card that is one box filling it — an app, a document page, one file — is the size it was
		 * given: the box ends at the card's foot because the card does, so fitting it to the box
		 * plus a margin grew it by the margin every time it was asked.
		 */
		const h = ends ? measured.h : measured.h + margin;
		const reading = away ?? this.host.reading?.(path, card.rev) ?? {};
		// Six seconds at most: the check is advice, and a fit that hangs on it is worse than one without it.
		const views = await Promise.race([this.host.views?.(path) ?? Promise.resolve(undefined), new Promise<undefined>((done) => setTimeout(() => done(undefined), 6000))]).catch(() => undefined);
		return { board: h === card.h && w === card.w ? card : this.resize(path, { w, h }), content: measured, reading, ...(views ? { views } : {}) };
	}

	/**
	 * What this revision of a card measures, laid out in a browser.
	 *
	 * The canvas's own measurement first: every frame reports one when it loads and on every
	 * revision, so a card on screen answers at once. A card nobody is looking at — the usual
	 * case for an agent writing on its own canvas while the person watches another — has no frame,
	 * and after a short wait for one it is measured in the server's own browser instead
	 * (`measureAway`), at its own size and by the same code. Whichever answers first is used; the
	 * error is left for when neither can.
	 */
	private async measure(path: string, rev: number, at: number): Promise<{ w: number; h: number; page?: number; reading?: { words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number } }> {
		// A frame's reading counts only when it laid the card out at this width.
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
	 * size a card against has to be a number somebody measured. A headless run and a fresh
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
	 * Put these cards on the canvas, and answer with what the browser did.
	 *
	 * The result is the browser's: which cards it moved to, and the sentence it left on the
	 * canvas when this agent's view was remembered rather than moved (the camera is per
	 * conversation — §7). Typed rather than `unknown` because the SDK's `index.d.ts` promises the
	 * shape to the agent, and the agent writes code against what that file says.
	 */
	async show(
		agentId: string,
		paths: string[],
		options: { fit?: "board" | "all"; highlight?: string; animate?: boolean; items?: Array<{ id: string; box: { x: number; y: number; w: number; h: number } }>; stage?: string; timeoutMs?: number } = {},
	): Promise<{ shown: string[]; deferred?: string }> {
		for (const path of paths) {
			if (!this.deck.card(path)) throw new Error(`No such board: ${path}`);
		}
		/*
		 * Drawn items travel as boxes rather than as ids, because where an item *is* is a
		 * question about the layout, and the server has already answered it (`pens.placedOf`).
		 * The browser would have to ask its own canvas the same question and could get a
		 * different answer while a file is being rewritten.
		 */
		const { timeoutMs, ...args } = options;
		const answer = await this.ask(agentId, { op: "show", args: { paths, ...args } }, timeoutMs);
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
	 * Reload a card's page in every browser showing it: on one canvas, or on any. Every browser is
	 * asked, and each says how many pages it reloaded (one, or none when the card is not on the
	 * canvas it shows), so the answer is a count rather than a guess.
	 */
	async reloadEverywhere(agentId: string, path: string, canvas?: string): Promise<number> {
		if (!this.deck.card(path)) throw new Error(`No such board: ${path}`);
		if (!this.host.connected()) return 0;
		const call = { op: "reload" as const, agentId, args: { path, count: true, ...(canvas ? { stage: canvas } : {}) } };
		const answers = this.host.callAll ? await this.host.callAll(call, 1500) : [await this.host.call(call, 1500)];
		return answers.reduce<number>((sum, answer) => sum + (typeof (answer as { pages?: unknown } | undefined)?.pages === "number" ? (answer as { pages: number }).pages : 0), 0);
	}

	/**
	 * Whether an agent may move its own conversation to a canvas now (`view.goto`, `agent.update --canvas`),
	 * as the browser says (`view-ops.ts`, `goto`): in the background, or with nobody watching, it may; on
	 * screen it may and the screen goes with it, unless the person is using the canvas, who is offered a
	 * button instead (`offered`), which moves it when pressed. The move itself is the caller's to make.
	 */
	async mayMove(agentId: string, canvas: string, person = false, keep = false): Promise<{ apply: boolean; onScreen: boolean; offered?: string }> {
		// `keep`: the canvas is opened as a tab (`view.open`), so the page keeps it and the one the camera leaves in its row.
		const answer = (await this.ask(agentId, { op: "goto", args: { stage: canvas, ...(person ? { person: true } : {}), ...(keep ? { keep: true } : {}) } })) as { apply?: unknown; onScreen?: unknown; offered?: unknown } | undefined;
		if (typeof answer?.offered === "string") return { apply: false, onScreen: true, offered: answer.offered };
		return { apply: true, onScreen: answer?.onScreen === true };
	}

	async cursor(agentId: string, path: string, at: { x: number; y: number } | null, label: string, color: string): Promise<void> {
		await this.ask(agentId, { op: "cursor", args: { path, at, label, color } });
	}

	/**
	 * A card as the person's browser has it now (`stage.call` op `shot`): drawn there by
	 * HTML-in-Canvas, or from a snapshot the server's Chrome draws, so it shows what the person did
	 * on the page. `none` when no browser is looking or it has no live page for the card.
	 */
	async seenCard(agentId: string, path: string): Promise<{ how: "canvas" | "snapshot"; bytes: Buffer; mime: string } | { how: "none"; why: string }> {
		const value = (await this.ask(agentId, { op: "shot", args: { path } }, 20_000)) as { how?: string; data?: string; mime?: string; why?: string; skipped?: string } | undefined;
		if (value && (value.how === "canvas" || value.how === "snapshot") && typeof value.data === "string") {
			return { how: value.how, bytes: Buffer.from(value.data, "base64"), mime: value.mime ?? "image/png" };
		}
		return { how: "none", why: value?.why ?? value?.skipped ?? "the person's browser did not answer" };
	}

	/** One thing asked of the person's page for an agent (`view.called`), answered by the first page to say; `skipped` when no page is there. */
	async ask(agentId: string, call: Omit<StageCall, "id" | "agentId">, timeoutMs?: number): Promise<unknown> {
		if (!this.host.connected()) {
			// Not an error: an agent can do useful work with nobody watching, and it
			// should be told rather than blocked.
			return { skipped: "no browser is connected to the canvas" };
		}
		return this.host.call({ ...call, agentId }, timeoutMs);
	}
}

export type { StageResult };
