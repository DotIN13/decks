import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Board, Camera, ServerMessage, StageCall, StageResult } from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";
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
		return this.deck.boards.map((board) => ({
			...board,
			inContext: holders.filter((agent) => agent.context.includes(board.path)).map((agent) => agent.id),
		}));
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
