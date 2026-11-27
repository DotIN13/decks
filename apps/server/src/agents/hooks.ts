import type { ActBox, ActKind, AgentKind, AgentState, Camera, Identity } from "@decks/protocol";
import type { CanvasService } from "../canvas/service.ts";
import type { CanvasSnapshot, CreateSpec, QueuedWork, SendSpec } from "./work.ts";

/**
 * What a caller's canvas may reach on the agent behind it, and what that canvas is made from.
 *
 * The agent (`session.ts`) is what implements these, so they live with it: the calls (`calls/tool.ts`)
 * take an agent's hooks and build the verbs on them, and a runtime (`runtimes/pi/extension.ts`)
 * reads the hooks it needs, without either of them pointing the agents up at the calls.
 */

export interface AgentHooks {
	id: string;
	identity(): Identity;
	context(): string[];
	inPlay(): string[];
	/**
	 * Put exactly these cards on the canvas. `at` names where joining ones go, top-left corner,
	 * and is kept as given; any other joining card is placed beside the canvas's newest.
	 */
	setInPlay(paths: string[], at?: Record<string, { x: number; y: number }>): void;
	/** Where this canvas has put its cards. Optional so a host that does not arrange can omit it. */
	positions?(): Record<string, { x: number; y: number }>;
	setPosition?(path: string, x: number, y: number): void;
	rename(name: string): void;
	setAvatar(url: string): void;
	/** Replaces the agent's own tags and returns them as stored — see `agents/tags.ts`. */
	setTags(tags: unknown): string[];
	/** Replaces the agent's workspace and returns it as stored — see `agents/workspaces.ts`. */
	setWorkspace(workspace: unknown): string | null;
	agents(): Array<{ id: string; name: string; state: AgentState; context: string[]; holding: number; kind: AgentKind; tags: string[]; workspace?: string; queued?: number; stage?: string; avatar?: string; outside?: { client: string; seen: number; waiting: number } }>;
	/** Where the browser last said it was looking. */
	camera(): Camera;
	/** Queue work for an agent that already exists, and return without waiting. */
	send(target: string, spec: SendSpec): { queued: true; position: number };
	/** Make an agent and return at once; optional so a host with no registry can omit it. */
	create?(spec: CreateSpec): Promise<{ agent: string; name: string; kind?: AgentKind; model?: string; thinking?: string; mode?: string; canvas?: string }>;
	/** What is waiting for an agent — this one, unless another is named. */
	queue(agentId?: string): QueuedWork[];
	/**
	 * Store the card's current bytes as a revision and return its id.
	 *
	 * Called right after a write, so the session can record *which* version of a
	 * card existed at that point in the conversation (§6.7). Idempotent: the same
	 * bytes are the same revision.
	 */
	recordRevision(path: string): string | undefined;
	/** What waits for the caller: its messages (taken, for an agent that works outside Decks) and its canvases' news. Optional: an app has neither. */
	news?(): { messages: QueuedWork[]; changes: string[] };
	/**
	 * The agent worked on this card: it becomes its writer, and the card joins what the turn
	 * reports. Called by `decks.card.create`, `decks.canvas.fit` and `decks.agent.claim`. Optional so a host
	 * with no deck record (an app) can leave it out.
	 */
	worked?(path: string): void;
	/** The agent acted on a card with a canvas verb: the canvas draws its cursor there (`agents/acts.ts`). */
	acted?(what: ActKind, path: string): void;
	/**
	 * The agent sized a card (`decks.canvas.fit`, `decks.canvas.update` with a size): the size goes to its own canvas, in the canvas file,
	 * which is the one record of how big a card is drawn there (`DeckAgent.setSize`).
	 */
	sized?(path: string, size: { w: number; h: number }): void;
	/** The agent edited its canvas's drawing: the canvas outlines what it touched (`agents/acts.ts`). */
	drew?(canvas: string, ids: string[], boxes: ActBox[]): void;
	/** Deck-relative path for an absolute one, or undefined if it is not a card. */
	cardPathOf(file: string): string | undefined;
	/** The folder this agent's canvas drawing lives in, named on first use (`canvas/pens.ts`). Optional for hosts with no drawing. */
	canvasName?(): string | undefined;
	/** Set when the caller is an app's own code (`calls/app-caller.ts`), not an agent: the app's name. */
	app?: string;
	/**
	 * Set when the caller is the person, in the browser, acting on this agent's canvas (`calls/person.ts`):
	 * their change is theirs, so it draws no agent cursor, is undoable, and hears no agent's reminders.
	 */
	person?: boolean;
	/** Work on another canvas: its cards become this agent's (`agents/session.ts`). */
	openCanvas?(name: string): void;
	/** Make an empty canvas from a title, open it, and return its name. */
	newCanvas?(title: string): string;
	/**
	 * The canvas this caller is on when a call names none (`decks.here()`), where that is not its own
	 * canvas: an app is on a canvas that shows it. Left out, it is `canvasName()`.
	 */
	here?(): string | undefined;
	/** Deliver a message now: steer the running turn, start one, or queue it (`agent.send`). */
	deliver?(target: string, spec: { task: string; boards?: string[] }): { delivered: boolean; turn: "running" | "new" | "queued"; position?: number; note?: string };
	/** Wait until another agent's work is done (`agent.wait`): its turn over, nothing queued. */
	wait?(target: string, timeoutMs: number): Promise<{ name: string; state: AgentState; reply: string; waited: number; timedOut: boolean }>;
	/** Make another canvas this agent's home (`agent.update({ canvas })`). */
	setHome?(name: string): void;
}

/**
 * What a canvas tool for one caller is made from (`calls/tool.ts`, `createDecksTool`): the canvases,
 * the caller's hooks, the port, and where its snapshot goes after every run, so a resume or a rewind
 * can restore it. An agent hands out one for itself and one for the person on its canvas
 * (`DeckAgent.toolSpec`); the calls make the tool from it and keep it (`calls/agent-tools.ts`).
 */
export interface DecksToolSpec {
	canvas: CanvasService;
	agent: AgentHooks;
	port: number;
	/** Where the snapshot goes after every run, so a resume or a rewind can restore it. */
	persist?: (snapshot: CanvasSnapshot) => void;
}

/**
 * The part of the agent's Decks tool a backend reads: what its briefing says (`agentBriefing`),
 * the guidelines and whether a Chrome tab is shared. The canvas itself every runtime reaches
 * through the `decks` command in its shell.
 */
export interface ToolBriefing {
	/** The guidelines appended to every agent's context (`runtime/guidelines.txt`, `guidelines.ts`). */
	readonly guidelines: readonly string[];
	/**
	 * Whether the person is sharing a tab right now.
	 *
	 * The backends ask before they write the deck context, because the browser's thirteen
	 * verbs are only described to an agent that can use them (`agents/context.ts`).
	 */
	webShared(): boolean;
}
