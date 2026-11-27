import { identityReminder } from "../agents/identity-reminder.ts";
import { canvasNameReminder } from "../canvas/canvas-name.ts";
import { existsSync, readFileSync } from "node:fs";
import type { ActBox, ActKind, AgentKind, AgentState, Camera, Identity } from "@decks/protocol";
import { guidelinesFile } from "@decks/runtime";
import type { Verbs as Stage } from "@decks/sdk";
import type { CreateSpec, QueuedWork, SendSpec, CanvasSnapshot } from "../agents/work.ts";
import { penWriter } from "../canvas/pens.ts";
import type { CanvasService } from "../canvas/service.ts";
import { inCall, verbContext } from "./context.ts";
import { appsVerbs } from "./apps.ts";
import { webVerbs } from "./web.ts";
import { miscVerbs } from "./misc.ts";
import { canvasVerbs } from "./canvas.ts";
import { boardVerbs } from "./cards.ts";
import { fileVerbs } from "./files.ts";
import { agentVerbs } from "./agent.ts";
import { viewVerbs } from "./view.ts";
import { renamedVerb } from "./renamed.ts";
import { gestures, type Gestures } from "./gestures.ts";

/**
 * One caller's stage (DESIGN §6.3): the verbs bound to an agent, the person or an app.
 *
 * The verbs themselves are in `calls/`, a module per group, given a `VerbContext` built here; this
 * file puts them on one object, answers `call` (what `/api/v1/<verb>` runs) with the value, the
 * notes and the pictures, adds the agent's reminders, and keeps the snapshot a rewind restores.
 * Every runtime's agent reaches it the same way, through the `decks` command, so no runtime has
 * words of its own about what a board is for.
 */

export interface AgentHooks {
	id: string;
	identity(): Identity;
	context(): string[];
	inPlay(): string[];
	/**
	 * Put exactly these boards on the stage. `at` names where joining ones go, top-left corner,
	 * and is kept as given; any other joining board is placed beside the stage's newest.
	 */
	setInPlay(paths: string[], at?: Record<string, { x: number; y: number }>): void;
	/** Where this stage has put its boards. Optional so a host that does not arrange can omit it. */
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
	 * Store the board's current bytes as a revision and return its id.
	 *
	 * Called right after a write, so the session can record *which* version of a
	 * board existed at that point in the conversation (§6.7). Idempotent: the same
	 * bytes are the same revision.
	 */
	recordRevision(path: string): string | undefined;
	/** What waits for the caller: its messages (taken, for an agent that works outside Decks) and its canvases' news. Optional: an app has neither. */
	news?(): { messages: QueuedWork[]; changes: string[] };
	/**
	 * The agent worked on this board: it becomes its writer, and the board joins what the turn
	 * reports. Called by `decks.card.create`, `decks.canvas.fit` and `decks.agent.claim`. Optional so a host
	 * with no deck record (an app) can leave it out.
	 */
	worked?(path: string): void;
	/** The agent acted on a board with a stage verb: the canvas draws its cursor there (`agents/acts.ts`). */
	acted?(what: ActKind, path: string): void;
	/**
	 * The agent sized a board (`decks.canvas.fit`, `decks.canvas.update` with a size): the size goes to its own stage, in the stage file,
	 * which is the one record of how big a board is drawn there (`DeckAgent.setSize`).
	 */
	sized?(path: string, size: { w: number; h: number }): void;
	/** The agent edited its stage's drawing: the canvas outlines what it touched (`agents/acts.ts`). */
	drew?(stage: string, ids: string[], boxes: ActBox[]): void;
	/** Deck-relative path for an absolute one, or undefined if it is not a board. */
	boardPathOf(file: string): string | undefined;
	/** The folder this agent's stage drawing lives in, named on first use (`canvas/pens.ts`). Optional for hosts with no drawing. */
	stageName?(): string | undefined;
	/** Set when the caller is an app's own code (`calls/app-caller.ts`), not an agent: the app's name. */
	app?: string;
	/**
	 * Set when the caller is the person, in the browser, acting on this agent's stage (`calls/person.ts`):
	 * their change is theirs, so it draws no agent cursor, is undoable, and hears no agent's reminders.
	 */
	person?: boolean;
	/** Work on another stage: its boards become this agent's (`agents/session.ts`). */
	openStage?(name: string): void;
	/** Make an empty stage from a title, open it, and return its name. */
	newStage?(title: string): string;
	/**
	 * The canvas this caller is on when a call names none (`decks.here()`), where that is not its own
	 * stage: an app is on a canvas that shows it. Left out, it is `stageName()`.
	 */
	here?(): string | undefined;
	/** Deliver a message now: steer the running turn, start one, or queue it (`agent.send`). */
	deliver?(target: string, spec: { task: string; boards?: string[] }): { delivered: boolean; turn: "running" | "new" | "queued"; position?: number; note?: string };
	/** Wait until another agent's work is done (`agent.wait`): its turn over, nothing queued. */
	wait?(target: string, timeoutMs: number): Promise<{ name: string; state: AgentState; reply: string; waited: number; timedOut: boolean }>;
	/** Make another canvas this agent's home (`agent.update({ canvas })`). */
	setHome?(name: string): void;
}

export interface DecksTool {
	/** The guidelines appended to every agent's context (`runtime/guidelines.txt`). */
	readonly guidelines: string[];
	/**
	 * The `stage` object the verbs act through, bound to this caller: an agent, the person, or an
	 * app acting for a conversation (`calls/app-caller.ts`).
	 */
	readonly stage: Stage;
	/**
	 * Whether the person is sharing a tab right now.
	 *
	 * The backends ask before they write the deck context, because the browser's thirteen
	 * verbs are only described to an agent that can use them (`agents/context.ts`).
	 */
	webShared(): boolean;
	/**
	 * Call one verb by its name in the verb table (`canvas.move`, `canvas.batch`); an old name is refused with its new call, with its arguments as a list.
	 *
	 * What `/api/v1/<verb>` answers with (`calls/run.ts`): the value, the notes the verb added
	 * (where an item went, what `decks.canvas.fit` measured, the reminders), and any pictures. A verb
	 * that throws is an answer too, `ok: false` with its sentence.
	 */
	call(name: string, args: readonly unknown[], on?: { stage?: string }): Promise<CallResult>;
	/** What the person's hands did on the canvas, sent over the socket (`calls/gestures.ts`): not a verb. */
	gesture<G extends keyof Gestures>(name: G, args: Parameters<Gestures[G]>): Promise<CallResult>;
	snapshot(): CanvasSnapshot;
}

/** One verb called over HTTP: see `DecksTool.call`. */
export interface CallResult {
	ok: boolean;
	value?: unknown;
	error?: string;
	notes: string[];
	images?: Array<{ data: string; mimeType: string }>;
}

/** What an agent is told when `runtime/guidelines.txt` is missing: the one rule the rest hang from. */
const BUILT_IN_GUIDELINES = [
	"Answer on the canvas: draw designs, maps and diagrams with decks canvas batch (the canvas-design skill); write an HTML card for demos and interactive mockups (decks card create, write/edit, decks canvas insert, decks canvas fit); build an app for a reusable tool. decks view focus shows it.",
];

/**
 * The guidelines an agent is given: `runtime/guidelines.txt` when there is one, a line each,
 * and the list above when there is not. A file for the reason the description is one: the
 * words can then be changed, and tried in variants, without touching this module.
 */
function guidelines(): string[] {
	const file = guidelinesFile();
	if (!existsSync(file)) return BUILT_IN_GUIDELINES;
	return readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
}
const GUIDELINES = guidelines();

export function createDecksTool(deps: {
	stage: CanvasService;
	agent: AgentHooks;
	port: number;
	/** Where the snapshot goes after every run, so a resume or a rewind can restore it. */
	persist?: (snapshot: CanvasSnapshot) => void;
}): DecksTool {
	const { stage: service, agent, port } = deps;
	const ctx = verbContext({ stage: service, agent, port });

	/**
	 * The verbs, one module per group (`calls/`), on one object: what `call` looks a verb up on, and
	 * what a board or an app acts through. Typed by the SDK's generated `Verbs`, so the table, the
	 * routes and these handlers cannot disagree about a verb's name or its arguments.
	 */
	const stage: Stage = {
		...miscVerbs(ctx),
		...canvasVerbs(ctx),
		...boardVerbs(ctx),
		...fileVerbs(ctx),
		...agentVerbs(ctx),
		...viewVerbs(ctx),
		...appsVerbs(ctx),
		...webVerbs(ctx),
	};

	const hands = gestures(ctx);

	const snapshot = (): CanvasSnapshot => ({
		// The arrangement this stage is looking at, so a resume or a rewind restores where the boards
		// were and not merely which ones were up.
		positions: deps.agent.positions?.(),
		context: agent.context(),
		inPlay: agent.inPlay(),
		camera: agent.camera(),
		identity: agent.identity(),
	});

	return {
		guidelines: GUIDELINES,
		stage,
		snapshot,
		webShared: () => service.web?.status().paired === true,

		async gesture(name, args) {
			return inCall(undefined, async (frame) => {
				let answer: CallResult;
				try {
					const value = await (hands[name] as (...given: unknown[]) => Promise<unknown>)(...args);
					answer = { ok: true, value, notes: [...frame.notes] };
				} catch (error) {
					answer = { ok: false, error: error instanceof Error ? error.message : String(error), notes: [] };
				}
				deps.persist?.(snapshot());
				return answer;
			});
		},

		async call(name: string, args: readonly unknown[], on: { stage?: string } = {}): Promise<CallResult> {
			// A frame of its own: its notes, pictures and canvas (what `here()` means for it), whatever runs beside it.
			return inCall(on.stage, (frame) => runCall(name, args, frame));
		},
	};

	async function runCall(name: string, args: readonly unknown[], frame: { notes: string[]; images: Array<{ data: string; mimeType: string }> }): Promise<CallResult> {
			const path = name.split(".");
			let owner: unknown = stage;
			for (const key of path.slice(0, -1)) owner = (owner as Record<string, unknown> | undefined)?.[key];
			const verb = (owner as Record<string, unknown> | undefined)?.[path[path.length - 1]!];
			if (typeof verb !== "function") return { ok: false, error: renamedVerb(name) ?? `${name} is not a verb.`, notes: [] };
			let answer: CallResult;
			try {
				const run = () => (verb as (...given: unknown[]) => Promise<unknown>).apply(owner, [...args]);
				// What an agent draws is its own: the canvas remembers it as the last writer (`penWriter`).
				const value = await (agent.person ? run() : penWriter.run(agent.id, run));
				answer = { ok: true, value, notes: [] };
			} catch (error) {
				answer = { ok: false, error: error instanceof Error ? error.message : String(error), notes: [] };
			}
			// After the verb's own notes, the agent's reminders: who it is, and what its canvas is called.
			// Not for the person, whose clicks are theirs and not the agent's.
			const said = [...frame.notes];
			if (!agent.person) {
				const unsaid = identityReminder(agent.identity(), { afterCall: true });
				if (unsaid) said.push(unsaid);
				const unnamed = canvasNameReminder(service.pens, agent.stageName?.());
				if (unnamed) said.push(unnamed);
			}
			deps.persist?.(snapshot());
			return { ...answer, notes: said, ...(frame.images.length > 0 ? { images: [...frame.images] } : {}) };
	}
}
