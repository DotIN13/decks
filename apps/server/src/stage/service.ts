import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Board, Camera, ServerMessage, StageCall, StageResult } from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";
import { withBoardSize } from "../deck/meta.ts";
import { fileUrl, resolveFileRequest } from "../deck/roots.ts";

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
	/** Write a new board from a template and return its deck-relative path. */
	newBoard(options: { title: string; kind: string; size?: { w?: number; h?: number } }): string;
	/** A live board: a stub that draws one agent's conversation. See `App.newMirror`. */
	newMirror(options: { agentId: string; name: string; size?: { w?: number; h?: number } }): string;
	/** Write a board's file, record the revision, and tell everyone. */
	writeBoard(path: string, html: string): Board;
	/** What the canvas last measured of this board, if what it measured was this revision. */
	extent(path: string, rev: number): { w: number; h: number } | undefined;
	/** Wait for a measurement of this revision — every frame takes one when it loads. */
	awaitExtent(path: string, rev: number, ms: number): Promise<{ w: number; h: number } | undefined>;
	/** Send to the focused browser, and resolve when it answers. */
	call(call: Omit<StageCall, "id">): Promise<unknown>;
	/** Is anyone looking? */
	connected(): boolean;
	broadcast(message: ServerMessage): void;
	/** The camera the browser last reported for one agent's canvas. */
	camera(agentId: string): Camera;
	/** Agents, for `stage.agents()` and for `inContext` on every board. */
	agents(): Array<{ id: string; name: string; state: string; context: string[]; tags: string[] }>;
}

/** The room `fit` leaves under the content — the margin a board's own components start at. */
const FIT_MARGIN = 48;
/** How long `fit` waits for the frame to load and report, before saying nobody looked. */
const FIT_WAIT_MS = 5000;

export class StageService {
	constructor(
		private deck: Deck,
		private readonly host: StageHost,
	) {}

	setDeck(deck: Deck): void {
		this.deck = deck;
	}

	// --- reads --------------------------------------------------------------------

	boards(): Board[] {
		const holders = this.host.agents();
		return this.deck.boards.map((board) => {
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

	move(path: string, at: { x: number; y: number }): Board {
		const board = this.deck.setPosition(path, at.x, at.y);
		if (!board) throw new Error(`No such board: ${path}`);
		this.host.broadcast({ type: "board.changed", path: board.path, rev: board.rev, board });
		return board;
	}

	/** A new board from a template — the shell, so the agent writes only the content. */
	newBoard(options: { title: string; kind: string; size?: { w?: number; h?: number } }): string {
		return this.host.newBoard(options);
	}

	/**
	 * A mirror: a board that is a live view of an agent's conversation.
	 *
	 * The file it writes is a stub and stays one — the turns arrive in the browser, from a
	 * transcript this app is already holding, so nothing here streams and nothing here is
	 * rewritten as the conversation grows (`lib/live-chat.js`).
	 */
	mirror(options: { agentId: string; name: string; size?: { w?: number; h?: number } }): string {
		return this.host.newMirror(options);
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
		return this.host.writeBoard(path, withBoardSize(html, size));
	}

	/**
	 * Size a board to what is on it.
	 *
	 * The height comes from the content and the width only grows, and that asymmetry is
	 * the whole design: narrowing a board reflows its text, which changes the height,
	 * which is what we were trying to measure. Growing the width is safe, and is what a
	 * component pushed past the right edge needs.
	 *
	 * The measurement comes from the browser, because the browser is the only place a
	 * board is laid out. Every frame reports one when it loads, so the usual case is
	 * instant; a board nobody is showing has never been measured and says so rather than
	 * guessing, which is the only honest answer and also a useful one — it means "put it
	 * on the canvas".
	 */
	async fit(path: string, options?: { margin?: number }): Promise<Board> {
		// The record first: an agent calls this straight after writing the content, and
		// the revision we wait for a measurement of has to be the one now on disk.
		this.deck.refresh(path);
		const board = this.deck.board(path);
		if (!board) throw new Error(`No such board: ${path}`);

		const margin = Math.max(0, Math.min(400, Math.round(options?.margin ?? FIT_MARGIN)));
		const extent = this.host.extent(path, board.rev) ?? (await this.host.awaitExtent(path, board.rev, FIT_WAIT_MS));
		if (!extent) {
			throw new Error(
				`Nothing has measured ${path} yet. A board is measured in the frame showing it, so put it on the canvas — stage.show("${path}") — and ask again.`,
			);
		}

		const h = extent.h + margin;
		const w = Math.max(board.w, extent.w + margin);
		if (w === board.w && h === board.h) return board;
		return this.resize(path, { w, h });
	}

	/** An agent's avatar, drawn by the agent, stored beside the deck. */
	writeAvatar(agentId: string, svg: string): string {
		const file = join(this.deck.path, ".decks", "avatars", `${agentId}.svg`);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, svg);
		// The revision is a fresh id rather than a hash: an avatar is written once per
		// change and the only job of the query is to get past the browser's cache.
		return `/api/avatar/${agentId}?rev=${randomUUID().slice(0, 8)}`;
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
	async setCamera(agentId: string, at: Camera): Promise<unknown> {
		return this.ask(agentId, { op: "camera", args: at });
	}

	async show(agentId: string, paths: string[], options: { fit?: "board" | "all"; highlight?: string } = {}): Promise<unknown> {
		for (const path of paths) {
			if (!this.deck.board(path)) throw new Error(`No such board: ${path}`);
		}
		return this.ask(agentId, { op: "show", args: { paths, ...options } });
	}

	async reload(agentId: string, path: string): Promise<void> {
		await this.ask(agentId, { op: "reload", args: { path } });
	}

	async cursor(agentId: string, path: string, at: { x: number; y: number } | null, label: string, color: string): Promise<void> {
		await this.ask(agentId, { op: "cursor", args: { path, at, label, color } });
	}

	/**
	 * Point at what just changed: bubbles with arrows, on the canvas, not in the file.
	 *
	 * `null` clears this agent's own — the browser filters by the id it is given, so one agent
	 * clearing does not wipe another's. The result carries the count *as drawn*, because the
	 * browser drops anything it cannot anchor and an agent that asked for four and got two
	 * should be told rather than assume.
	 */
	async annotate(agentId: string, path: string, marks: unknown): Promise<unknown> {
		if (!this.deck.board(path)) throw new Error(`No such board: ${path}`);
		return this.ask(agentId, { op: "annotate", args: { agentId, path, marks: marks ?? null } });
	}

	async toast(agentId: string, text: string): Promise<void> {
		await this.ask(agentId, { op: "toast", args: { text } });
	}

	private async ask(agentId: string, call: Omit<StageCall, "id" | "agentId">): Promise<unknown> {
		if (!this.host.connected()) {
			// Not an error: an agent can do useful work with nobody watching, and it
			// should be told rather than blocked.
			return { skipped: "no browser is connected to the canvas" };
		}
		return this.host.call({ ...call, agentId });
	}
}

export type { StageResult };
