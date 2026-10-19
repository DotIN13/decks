import { canvasFile } from "./canvas-files.ts";
import { isoIn, nowWords, offsetLabel, partsIn, processZone } from "../lib/clock.ts";
import { identityReminder } from "../agents/identity-reminder.ts";
import { canvasNameReminder } from "./canvas-name.ts";
import { isIsolatedStage } from "./isolated-stages.ts";
import { stageBoardsDir } from "../deck/stage-boards.ts";
import { existsSync, readFileSync } from "node:fs";
import type { ActBox, ActKind, AgentKind, AgentMode, AgentState, Camera, Identity, ThinkingLevel } from "@decks/protocol";
import { guidelinesFile } from "@decks/runtime";
import type { Verbs as Stage } from "../../../../packages/sdk/src/index.d.ts";
import { cleanWorkspace } from "../agents/workspaces.ts";
import { asBoardFormat, BOARD_FORMATS, boardWidth } from "../boards/templates.ts";
import { boxOf, placements, baseTheme, type Op } from "@decks/pen";
import { serverText } from "./text.ts";
import { STARTER_KIND, STARTERS, writeStarter, type Starter } from "../apps/starters.ts";
import type { StageService, WebTarget } from "./service.ts";
import { imageSize, type ShotFormat, type ShotOf } from "./shots.ts";
import { verbContext } from "../verbs/context.ts";
import { boardsVerbs } from "../verbs/boards.ts";
import { stageVerbs } from "../verbs/stage.ts";
import { agentsVerbs } from "../verbs/agents.ts";
import { stagesVerbs } from "../verbs/stages.ts";
import { penVerbs } from "../verbs/pen.ts";
import { appsVerbs } from "../verbs/apps.ts";
import { webVerbs } from "../verbs/web.ts";
import { miscVerbs } from "../verbs/misc.ts";
import { canvasVerbs } from "../verbs/canvas.ts";
import { boardVerbs } from "../verbs/board.ts";
import { agentVerbs } from "../verbs/agent.ts";
import { viewVerbs } from "../verbs/view.ts";
import { aliasNote, VERB_BY_NAME } from "@decks/api";

/**
 * One caller's stage (DESIGN §6.3): the verbs bound to an agent, the person, a board or an app.
 *
 * The verbs themselves are in `verbs/`, a module per group, given a `VerbContext` built here; this
 * file puts them on one object, answers `call` (what `/api/v1/<verb>` runs) with the value, the
 * notes and the pictures, adds the agent's reminders, and keeps the snapshot a rewind restores.
 * Every runtime's agent reaches it the same way, through the `decks` command, so no runtime has
 * words of its own about what a board is for.
 */

/** What a parent asks for when it hands work over (§6.2). */
/**
 * What one agent hands to another that already exists (the queue, not a spawn).
 *
 * No `model`: a delegation creates the agent it is about to run, so choosing its model is
 * part of creating it. A send lands in a conversation that is already somebody's, on
 * whatever model that conversation is having — changing it from outside would rewrite the
 * voice of a chat the user is reading. The same argument bars `kind`, `thinking` and
 * `mode`: they are all choices about how a piece of work is *created*, and a send creates
 * nothing.
 */
export interface SendSpec {
	task: string;
	/** Boards handed over: the receiver is given their source when the item runs. */
	boards?: string[];
	/**
	 * Tell the sender when the work is done.
	 *
	 * Off by default: most sends are genuinely *theirs* — you handed it over because you
	 * had nothing more to do with the answer, and a reply you did not ask for is an
	 * interruption. When set, the receiver's report is delivered to the sender as a notice
	 * in their transcript when the item runs — never as a queued task, because a task runs
	 * a turn of the sender's own, and a turn that answers a report with another report is
	 * two agents talking forever.
	 */
	reply?: boolean;
}

/**
 * A new agent made with no task, for a `send` to follow — `stage.create`.
 *
 * `delegate` makes an agent *and waits for it*, which is wrong for something that has to
 * hand work over and stop; `send` needs an agent that already exists. This is the gap
 * between them: an agent is made, idle, and the caller's next line is a send to it. It is
 * a peer, not a child: nobody is waiting for it, so it has no parent to report to.
 */
export interface CreateSpec {
	name: string;
	/** The workspace it opens in; the creator's when left out. */
	workspace?: string;
	/** What it is for, a few words each — set as its tags so the panel says so. */
	tags?: string[];
	kind?: AgentKind;
	/** `provider/model`. Left out, it opens on the creator's own model. */
	model?: string;
	thinking?: ThinkingLevel;
	mode?: AgentMode;
	/** Its home canvas, by folder name. */
	canvas?: string;
	/** With no `canvas`: give it a new, empty canvas of its own (`agent.create`). */
	newCanvas?: boolean;
}

/** One item waiting in an agent's queue. */
export interface QueuedWork {
	/** The agent that sent it, and what it was calling itself at the time. */
	from: string;
	fromName: string;
	task: string;
	boards: string[];
	at: number;
	/** The sender asked for the report back — see `SendSpec.reply`. */
	reply?: boolean;
}

export interface StageAgentHooks {
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
	agents(): Array<{ id: string; name: string; state: AgentState; context: string[]; holding: number; kind: AgentKind; tags: string[]; workspace?: string; queued?: number; stage?: string }>;
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
	/**
	 * The agent worked on this board: it becomes its writer, and the board joins what the turn
	 * reports. Called by `newBoard`, `fit`, a one-board `show` and `report`. Optional so a host
	 * with no deck record (a board actor) can leave it out.
	 */
	worked?(path: string): void;
	/** The agent acted on a board with a stage verb: the canvas draws its cursor there (`agents/acts.ts`). */
	acted?(what: ActKind, path: string): void;
	/**
	 * The agent sized a board (`fit`, `resize`): the size goes to its own stage, in the stage file,
	 * which is the one record of how big a board is drawn there (`DeckAgent.setSize`).
	 */
	sized?(path: string, size: { w: number; h: number }): void;
	/** The agent edited its stage's drawing: the canvas outlines what it touched (`agents/acts.ts`). */
	drew?(stage: string, ids: string[], boxes: ActBox[]): void;
	/** Deck-relative path for an absolute one, or undefined if it is not a board. */
	boardPathOf(file: string): string | undefined;
	/** The folder this agent's stage drawing lives in, named on first use (`stage/pens.ts`). Optional for hosts with no drawing. */
	stageName?(): string | undefined;
	/** Isolated mode (`agents/isolation.ts`): this agent may see only its own stage's boards. */
	isolated?(): boolean;
	/** Set when the caller is a board's own code (`stage/board-actor.ts`), not an agent. */
	board?: string;
	/**
	 * Set when the caller is the person, in the browser, acting on this agent's stage (`verbs/person.ts`):
	 * their change is theirs, so it draws no agent cursor, is undoable, and hears no agent's reminders.
	 */
	person?: boolean;
	/** Work on another stage: its boards become this agent's (`agents/session.ts`). */
	openStage?(name: string): void;
	/** Make an empty stage from a title, open it, and return its name. */
	newStage?(title: string): string;
	/**
	 * The canvas this caller is on when a call names none (`decks.here()`), where that is not its own
	 * stage: a board's button is on the board's canvas. Left out, it is `stageName()`.
	 */
	here?(): string | undefined;
	/** Deliver a message now: steer the running turn, start one, or queue it (`agent.send`). */
	deliver?(target: string, spec: { task: string; boards?: string[] }): { delivered: boolean; turn: "running" | "new" | "queued"; position?: number; note?: string };
	/** Make another canvas this agent's home (`agent.update({ canvas })`). */
	setHome?(name: string): void;
}

/**
 * What an agent was holding, showing and calling itself.
 *
 * Persisted by the shell rather than carried in the transcript (§6.2). Pi could ride it in
 * a tool result's `details` and rebuild from the session branch; the Claude SDK has no
 * equivalent — `structuredContent` looks like one but replaces the tool's own text — so
 * both runtimes now use one store and there is one code path to be wrong in.
 */
export interface StageSnapshot {
	context: string[];
	/** What was on the canvas — a set, so a rewind restores the whole view. */
	inPlay: string[];
	/**
	 * Where this stage had put its boards, so a rewind restores the arrangement too.
	 *
	 * Optional, and the only member here that is: a snapshot written before this existed has no
	 * `positions`, and restoring one must leave the stage to `arrange` rather than to nothing.
	 */
	positions?: Record<string, { x: number; y: number }>;
	camera: Camera;
	identity: Identity;
}

export interface StageTool {
	/** The guidelines appended to every agent's context (`runtime/guidelines.txt`). */
	readonly guidelines: string[];
	/**
	 * The `stage` object the verbs act through, bound to this caller: an agent, or a board or app
	 * acting for a conversation (`stage/board-actor.ts`).
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
	 * Call one verb by its name in the verb table (`move`, `pen.edit`), with its arguments as a list.
	 *
	 * What `/api/v1/<verb>` answers with (`verbs/router.ts`): the value, the notes the verb added
	 * (the viewport after `newBoard`, what `fit` measured, the reminders), and any pictures. A verb
	 * that throws is an answer too, `ok: false` with its sentence.
	 */
	call(name: string, args: readonly unknown[], on?: { stage?: string }): Promise<StageCallResult>;
	snapshot(): StageSnapshot;
}

/** One verb called over HTTP: see `StageTool.call`. */
export interface StageCallResult {
	ok: boolean;
	value?: unknown;
	error?: string;
	notes: string[];
	images?: Array<{ data: string; mimeType: string }>;
}

/** What an agent is told when `runtime/guidelines.txt` is missing: the one rule the rest hang from. */
const BUILT_IN_GUIDELINES = [
	"Answer on a board: stage.newBoard for the page, write/edit for the content, stage.show then stage.fit to put it in front of the person. A board is one screen, read in about ten seconds.",
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

export function createStageTool(deps: {
	stage: StageService;
	agent: StageAgentHooks;
	port: number;
	/** Where the snapshot goes after every run, so a resume or a rewind can restore it. */
	persist?: (snapshot: StageSnapshot) => void;
}): StageTool {
	const { stage: service, agent, port } = deps;
	const ctx = verbContext({ stage: service, agent, port });
	const { notes, images } = ctx;

	/**
	 * The verbs, one module per group (`verbs/`), on one object: what `call` looks a verb up on, and
	 * what a board or an app acts through. Typed by the SDK's generated `Verbs`, so the table, the
	 * routes and these handlers cannot disagree about a verb's name or its arguments.
	 */
	const stage: Stage = {
		// The old names, kept for one release (`ALIASES` in @decks/api); each answer says its new call.
		...boardsVerbs(ctx),
		...stageVerbs(ctx),
		...stagesVerbs(ctx),
		...agentsVerbs(ctx),
		...miscVerbs(ctx),
		...penVerbs(ctx),
		// The calls of the redesign.
		...canvasVerbs(ctx),
		...boardVerbs(ctx),
		...agentVerbs(ctx),
		...viewVerbs(ctx),
		...appsVerbs(ctx),
		...webVerbs(ctx),
	};

	/*
	 * The old names whose new call answers the same question take that call's answer, so there is
	 * one implementation of each; the rest keep their own code, for the answer shape and placement
	 * their callers were written against (`ALIASES` in @decks/api says which new call each maps to).
	 */
	stage.url = (path) => stage.board.url(path);
	stage.resolve = (file) => stage.file.url(file);
	stage.viewport = () => stage.view.viewport();
	stage.cursor = (path, at) => stage.view.cursor(path, at);
	stage.reload = async (path) => {
		await stage.view.reload({ board: path });
	};
	stage.report = async (path) => ({ reported: await stage.agent.claim(path) });
	stage.pen = {
		...stage.pen,
		file: () => stage.canvas.file(),
		create: (path, item) => stage.frame.create(path, item),
		save: async (id, path, options) => ({ overwrote: false, ...(await stage.canvas.save(id, path, options?.replace === undefined ? {} : { replace: options.replace })) }),
	};
	const openStage = stage.open;
	// `open` is agent.update({ canvas }) and then view.goto: the home moves, and the screen follows.
	stage.open = async (name) => {
		const opened = await openStage(name);
		if (!agent.person && !agent.board) await service.goto(agent.id, opened.stage).catch(() => undefined);
		return opened;
	};

	const snapshot = (): StageSnapshot => ({
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

		async call(name: string, args: readonly unknown[], on: { stage?: string } = {}): Promise<StageCallResult> {
			notes.length = 0;
			images.length = 0;
			// The canvas the request says it was made on, which is what `here()` means for this call.
			ctx.callOn.stage = on.stage;
			const path = name.split(".");
			let owner: unknown = stage;
			for (const key of path.slice(0, -1)) owner = (owner as Record<string, unknown> | undefined)?.[key];
			const verb = (owner as Record<string, unknown> | undefined)?.[path[path.length - 1]!];
			if (typeof verb !== "function") return { ok: false, error: `${name} is not a verb.`, notes: [] };
			let answer: StageCallResult;
			try {
				const value = await (verb as (...given: unknown[]) => Promise<unknown>).apply(owner, [...args]);
				answer = { ok: true, value, notes: [] };
			} catch (error) {
				answer = { ok: false, error: error instanceof Error ? error.message : String(error), notes: [] };
			}
			// After the verb's own notes, the agent's reminders: who it is, and what its canvas is called.
			// Not for the person, whose clicks are theirs and not the agent's.
			const said = [...notes];
			// An old name says its new call, every time, so a caller learns it from using the old.
			const known = VERB_BY_NAME.get(name);
			const renamed = known ? aliasNote(known) : undefined;
			if (renamed) said.push(renamed);
			ctx.callOn.stage = undefined;
			if (!agent.person) {
				const unsaid = identityReminder(agent.identity());
				if (unsaid) said.push(unsaid);
				const unnamed = canvasNameReminder(service.pens, agent.stageName?.());
				if (unnamed) said.push(unnamed);
			}
			deps.persist?.(snapshot());
			return { ...answer, notes: said, ...(images.length > 0 ? { images: [...images] } : {}) };
		},
	};
}
