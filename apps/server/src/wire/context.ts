import type { AgentKind, Camera, Canvas, ClientMessage, DeckState, ServerMessage } from "@decks/protocol";
import type { Registry } from "../agents/registry.ts";
import type { BoardService } from "../boards/service.ts";
import type { EvalTrust } from "../boards/eval-trust.ts";
import type { StageService } from "../stage/service.ts";
import type { TaskService } from "../tasks/service.ts";
import type { ClaudeAccounts } from "../runtimes/claude/accounts.ts";
import type { Deck } from "../deck/loader.ts";
import type { WebBridge } from "../web/bridge.ts";
import type { View } from "../ws.ts";
import type { CanvasStore } from "../canvas/store.ts";

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
	/** Writing, editing and deleting boards — `boards/service.ts`. */
	readonly boards: BoardService;
	readonly agents: Registry;
	readonly web: WebBridge;
	readonly claudeAccounts: ClaudeAccounts;
	/** Tasks and schedules — the dashboard's store (takes frames, not boards). */
	readonly tasks: TaskService;
	/**
	 * The stage, for the one frame that runs a board's own code (`wire/boards.ts`).
	 *
	 * It is here because a board's run is an agent's run with a different actor: the code
	 * gets the same `stage` object (`stage/tool.ts`) and the same service behind it.
	 */
	readonly stage: StageService;
	/** Which boards may run their own code, and the list the question writes (`boards/eval-trust.ts`). */
	readonly evalTrust: EvalTrust;
	/** The port this server is on, so a board's `stage.url()` answers like an agent's. */
	readonly port: number;

	/**
	 * The deck as the focused stage sees it, with any place that had to be worked out written down on
	 * that stage.
	 *
	 * Every frame that sends boards goes through this rather than `deck.state()`, because a bare
	 * `deck.state()` is the deck's auto-layout and not the arrangement the conversation is looking at.
	 * The seeding is the other half: what `Deck.arrange` computes is a *frontier* answer, and a board
	 * that is re-placed on every send chases whatever was moved last (see `Deck.arrange`).
	 */
	stageState(): DeckState;

	/** The deck's canvases: what holds the boards (`canvas/store.ts`). */
	readonly canvases: CanvasStore;
	/**
	 * The deck as one canvas sees it: its boards, in the places it has put them.
	 *
	 * The same seeding `stageState` does, written back onto the canvas rather than onto a
	 * chat — a board with no place of its own is placed once, beside the boards already there.
	 */
	canvasState(canvasId: string): DeckState;
	/** Every canvas as the browser needs it, with the agents working on each. */
	canvasList(): Canvas[];
	/** Say what canvases exist, to everyone, after one is made, renamed, joined or removed. */
	publishCanvases(): void;

	/** The camera a browser last reported, and the per-agent readings beside it. */
	lastCamera: Camera;
	readonly cameras: Map<string, Camera>;
	/** The canvas calls waiting on a browser, keyed by call id. */
	readonly pendingStage: Map<string, PendingStage>;

	/** The browser whose frame is being handled, for a handler that answers it later (`fork.from`). */
	readonly viewing: View | undefined;

	/** To every connected browser, including the one that asked. */
	send(message: ServerMessage): void;

	/** Point the whole app at another data directory (§2). */
	openDeck(path: string): void;

	/** Choose the deck's timezone, or `null` for the machine's. Returns a sentence when it is not one. */
	setTimezone(zone: string | null): { error: string } | undefined;
	/** Choose the dispatcher's runtime; an error names why that runtime cannot be used here. */
	setDispatcherKind(kind: AgentKind): { error: string } | undefined;

	/** The install's Claude subscriptions, republished after anything moves one. */
	publishAccounts(reply?: Reply, options?: { reread?: boolean }): Promise<void>;
	/** Refresh one account's token before several sessions race to (`claude/transient.ts`). */
	warmAccount(id: string): Promise<void>;
}
