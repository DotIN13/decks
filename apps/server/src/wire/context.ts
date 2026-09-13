import type { Camera, ClientMessage, ServerMessage } from "@decks/protocol";
import type { Registry } from "../agents/registry.ts";
import type { Revisions } from "../boards/snapshots.ts";
import type { BoardFormat, BoardTemplate } from "../boards/templates.ts";
import type { ClaudeAccounts } from "../claude/accounts.ts";
import type { Deck } from "../deck/loader.ts";
import type { WebBridge } from "../web/bridge.ts";

/** How a frame answers the socket it came from — and only that socket. */
export type Reply = (message: ServerMessage) => void;

/**
 * One frame's handler.
 *
 * The message is narrowed to *that* frame's variant, so a handler for `board.move` cannot
 * read `message.patches` and a handler for `board.patch` cannot forget it. That narrowing
 * is the whole reason the table is typed this way rather than as
 * `Record<string, (message: ClientMessage, ...) => void>`: the second form would compile
 * and would move every mistake to run time.
 */
export type WireHandler<K extends ClientMessage["type"]> = (
	message: Extract<ClientMessage, { type: K }>,
	reply: Reply,
	wire: WireContext,
) => void;

/**
 * Every frame, and what answers it.
 *
 * A mapped type over the union, which is what makes an unhandled frame a **compile error**
 * rather than a notice at run time. Adding a variant to `ClientMessage` fails
 * `wire/index.ts` until somebody answers it — the one thing the 38-case switch could not do.
 */
export type WireTable = { [K in ClientMessage["type"]]: WireHandler<K> };

/**
 * What one domain module exports: the frames it answers, and not all of them.
 *
 * Each module is checked against the full table for the keys it *does* declare, and
 * `wire/index.ts` is checked for the keys that are left over.
 */
export type WirePart = Partial<WireTable>;

/** One browser-side `stage.call` in flight, and the timer that gives up on it. */
export interface PendingStage {
	resolve: (value: unknown) => void;
	timer: NodeJS.Timeout;
}

/**
 * What a frame handler may touch, and nothing else.
 *
 * `app.ts` is the composition root: it opens the deck, owns the bridges, and knows how a
 * board write works. This interface is the part of it that *frames* reach, so the router
 * can live in its own modules without importing the class back — a cycle that would work
 * by accident and break the moment a handler wanted a value at module load.
 *
 * It is deliberately an interface rather than `App`: what a handler may do is a decision,
 * and this is where it is written down. A handler that wants something new adds it here
 * first, which is also the place to notice that it should be reaching for a domain module
 * instead.
 */
export interface WireContext {
	readonly deck: Deck;
	readonly agents: Registry;
	readonly web: WebBridge;
	readonly revisions: Revisions;
	readonly claudeAccounts: ClaudeAccounts;

	/** The camera a browser last reported, and the per-agent readings beside it. */
	lastCamera: Camera;
	readonly cameras: Map<string, Camera>;
	/** The canvas calls waiting on a browser, keyed by call id. */
	readonly pendingStage: Map<string, PendingStage>;

	/** To every connected browser, including the one that asked. */
	send(message: ServerMessage): void;

	/** Point the whole app at another data directory (§2). */
	openDeck(path: string): void;

	/** The board-write path (`boards/`), which also records the revision. */
	newBoard(options: { title: string; template: BoardTemplate; format?: BoardFormat; size?: { w?: number; h?: number } }): string;
	newMirror(options: { agentId: string; name: string; size?: { w?: number; h?: number } }): string;
	newWebBoard(): string;
	deleteBoard(path: string, reply: Reply): void;
	patch(path: string, rev: number, patches: Extract<ClientMessage, { type: "board.patch" }>["patches"], reply: Reply): void;
	undo(path: string, reply: Reply): void;

	/** A reading from a frame's own layout, kept for whoever asks for it. */
	noteExtent(path: string, extent: { rev: number; w: number; h: number }): void;

	/** Which revision each board was at, at a point in a conversation (§6.7). */
	boardsAt(
		agent: { revisionsAt(entryId: string): Record<string, string>; timeline(): Array<{ id: string; at?: number }> },
		entryId: string,
	): Record<string, string>;

	/** The install's Claude subscriptions, republished after anything moves one. */
	publishAccounts(reply?: Reply, options?: { reread?: boolean }): Promise<void>;
	/** Refresh one account's token before several sessions race to (`claude/transient.ts`). */
	warmAccount(id: string): Promise<void>;
}
