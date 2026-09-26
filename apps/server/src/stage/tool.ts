import { isoIn, nowWords, offsetLabel, partsIn, processZone } from "../lib/clock.ts";
import { identityReminder } from "../agents/identity-reminder.ts";
import { isIsolatedStage } from "./isolated-stages.ts";
import { stageBoardsDir } from "../deck/stage-boards.ts";
import { existsSync, readFileSync } from "node:fs";
import type { ActKind, AgentKind, AgentMode, AgentState, Camera, Identity, ThinkingLevel } from "@decks/protocol";
import { guidelinesFile, toolDescription as toolDescriptionPath } from "@decks/runtime";
import type { Stage } from "../../../../runtime/stage.d.ts";
import { cleanWorkspace } from "../agents/workspaces.ts";
import { asBoardFormat, BOARD_FORMATS, boardWidth } from "../boards/templates.ts";
import { boxOf, placements, baseTheme, type Op } from "@decks/pen";
import { runEval, safeJson } from "./eval.ts";
import type { StageService, WebTarget } from "./service.ts";
import type { ShotFormat, ShotOf } from "./shots.ts";

/**
 * The canvas tool, defined once for every runtime (DESIGN §6.3).
 *
 * This file is the tool: its description, its guidelines, the `stage` object the code runs
 * against, and what a run returns. What it deliberately does not know is how a runtime is
 * told about a tool — Pi takes a definition with a TypeBox schema, the Claude SDK takes an
 * in-process MCP server with a Zod one — so each backend has a thin adapter and neither
 * owns the wording.
 *
 * The wording is the part that matters. Two runtimes drifting apart on what a board is for
 * would be two products.
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
	create?(spec: CreateSpec): Promise<{ agent: string; name: string }>;
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
	/** Deck-relative path for an absolute one, or undefined if it is not a board. */
	boardPathOf(file: string): string | undefined;
	/** The folder this agent's stage drawing lives in, named on first use (`stage/pens.ts`). Optional for hosts with no drawing. */
	stageName?(): string | undefined;
	/** Isolated mode (`agents/isolation.ts`): this agent may see only its own stage's boards. */
	isolated?(): boolean;
	/** Work on another stage: its boards become this agent's (`agents/session.ts`). */
	openStage?(name: string): void;
	/** Make an empty stage from a title, open it, and return its name. */
	newStage?(title: string): string;
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

export interface StageToolResult {
	/** What the model reads. */
	text: string;
	/** Whether the run failed, which each runtime signals in its own way. */
	isError: boolean;
	/**
	 * Pictures the run produced, for the model to look at alongside the text.
	 *
	 * One source today: `stage.web.screenshot()`. Base64, so each runtime can put it in
	 * its own kind of image block; a runtime with no image blocks drops them and the text
	 * still names the file.
	 */
	images?: Array<{ data: string; mimeType: string }>;
}

export interface StageTool {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly promptSnippet: string;
	readonly guidelines: string[];
	readonly parameterDescription: string;
	/**
	 * The `stage` object this tool runs code against.
	 *
	 * Exposed for the one other caller that needs a full stage with a different actor: a
	 * board running its own code (`stage/board-actor.ts`), which takes this same object and
	 * never goes through `run`.
	 */
	readonly stage: Stage;
	/**
	 * Whether the person is sharing a tab right now.
	 *
	 * The backends ask before they write the deck context, because the browser's thirteen
	 * verbs are only described to an agent that can use them (`agents/context.ts`).
	 */
	webShared(): boolean;
	run(code: string): Promise<StageToolResult>;
	snapshot(): StageSnapshot;
}

const STAGE_TOOL_NAME = "stage_eval";

/**
 * The tool's description, read from `runtime/tool-description.txt`.
 *
 * **A file, not a string in this module**, because three processes show this text to a
 * model and only one of them is this one. Pi and Claude get it through `StageTool`; opencode
 * reads the same file from its own tool loader, and antigravity's MCP server from its own
 * script (`runtime/opencode/tools/stage_eval.ts`, `runtime/antigravity/mcp-server.mjs`).
 * All three copies used to be hand-written, and two of them had already been shortened —
 * under a comment that still claimed they were "in the same words".
 *
 * The wording is the part that must not drift: four runtimes disagreeing about what a board
 * is for would be four products. Reading one file is the cheapest way to make that
 * impossible rather than merely discouraged.
 */
let description: string | undefined;
function toolDescription(): string {
	if (description === undefined) {
		description = readFileSync(toolDescriptionPath(), "utf8").trim();
	}
	return description;
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

/**
 * Verbs this build removed, and the sentence each one answers with for a release.
 *
 * Four runtimes' transcripts contain these names, and a resumed conversation will call them.
 * Each sentence names the call that does the same job, so the next line a model writes is the
 * right one — a refusal it can act on beats a `TypeError` it cannot.
 */
const GONE: Record<string, string> = {
	mirror: "stage.mirror is gone. A mirror board is made from the Agents tab; nothing in the API makes one.",
	toast: "stage.toast is gone. Say it in your turn: what you write reaches the person.",
	read: "stage.read is gone. A board is a file — read it with your own file tools.",
	roots: "stage.roots is gone. stage.resolve(file) answers, and says which roots it may reach when it cannot.",
	context: "stage.context() is gone. stage.boards() marks what each agent holds, in inContext.",
	workspaces: "stage.workspaces() is gone. stage.agents({ filter: { workspace } }) lists who is on a project.",
	inPlay: "stage.inPlay() is now stage.boards(), whose inContext says what each agent holds.",
	attach: "stage.attach is gone: stage.show(path) puts a board on your stage, and you hold what you show.",
	detach: "stage.detach is gone: stage.hide(path) takes a board off your stage.",
	task: "stage.task is gone, with the dashboard. Hand work to an agent with stage.send(name, { task }).",
	schedule: "stage.schedule is gone, with the dashboard's cron list. Nothing in the deck runs on a timer.",
	canvas: "stage.canvas is gone: each agent has its own stage now, and stage.boards() is what is on it.",
	canvases: "stage.canvases is gone: each agent has its own stage now. stage.agents() lists who else is working.",
	useCanvas: "stage.useCanvas is gone: each agent has its own stage now, and there is nothing to move to.",
	newCanvas: "stage.newCanvas is gone: each agent has its own stage now. Show your boards with stage.show.",
	link: "stage.link is gone with canvases. Link one board to another with an <a href> inside the board.",
	group: "stage.group is gone with canvases.",
	unlink: "stage.unlink is gone with canvases.",
	ungroup: "stage.ungroup is gone with canvases.",
	web_jev: "stage.web_jev is gone. stage.web drives the person's shared Chrome one step at a time.",
	delegate: "stage.delegate is gone: a stage run is abandoned after 20 seconds, so it could never return a subagent's report. Use stage.send({ name, kind }, { task, reply: true }) — the agent is made, the work is queued, and its report reaches you on your next turn.",
	create: 'stage.create({ name }) is now the first argument of send: stage.send({ name, kind }, { task }).',
};

export function createStageTool(deps: {
	stage: StageService;
	agent: StageAgentHooks;
	port: number;
	/** Where the snapshot goes after every run, so a resume or a rewind can restore it. */
	persist?: (snapshot: StageSnapshot) => void;
}): StageTool {
	const { stage: service, agent, port } = deps;
	const asList = (path: string | string[]) => (Array.isArray(path) ? path : [path]);

	/**
	 * Lines added to the tool's result that the code did not return.
	 *
	 * There is exactly one today — the viewport, after `newBoard` — and it is here rather
	 * than in the return value because the return value is an API: `const path = await
	 * stage.newBoard(...)` is in every board this deck has written, and a call that started
	 * answering with an object instead of a path would break all of them. The model reads
	 * the result text, so that is where a number it should notice belongs.
	 */
	let notes: string[] = [];
	/** Pictures produced during one run — see `StageToolResult.images`. */
	let images: Array<{ data: string; mimeType: string }> = [];

	/** The canvas's own size, or nothing if no browser has ever reported one. */
	const viewport = () => service.viewport(agent.id);
	/** The drawing's files, or the sentence that says this server keeps none. */
	const needPens = () => {
		if (!service.pens) throw new Error("This server keeps no stage drawing.");
		return service.pens;
	};
	/** This agent's stage folder, claimed the first time it draws. */
	const needStage = () => {
		const name = agent.stageName?.();
		if (!name) throw new Error("This stage has no drawing: the server keeps no stage files.");
		return name;
	};
	/**
	 * Where a drawn item is on this stage, or nothing when there is no item by that id.
	 *
	 * What makes `show` work on the drawing as well as on the boards. An id is looked up in the
	 * layout rather than in the file, because the layout is the only thing that knows where a
	 * note inside a frame ends up, and "fly to it" is a question about the stage, not the JSON.
	 */
	const itemBox = (id: string): { x: number; y: number; w: number; h: number } | undefined => {
		const name = agent.stageName?.();
		if (!service.pens || !name) return undefined;
		const box = service.pens.placedOf(name).get(id)?.box;
		return box ? { x: box.x, y: box.y, w: box.w, h: box.h } : undefined;
	};

	/** The shared Chrome, or the sentence that says this server has none. */
	const needWeb = () => {
		if (!service.web) throw new Error("This server has no shared browser.");
		return service.web;
	};
	/**
	 * A target as the agent wrote it, checked here rather than in the bridge.
	 *
	 * Three forms, and anything else gets the verb's own sentence: a name, a `{ ref }` from
	 * `read`, or a `{ name, nth }`. Checking it here keeps the bridge free to assume a target
	 * it can act on, and keeps the wording beside the verb it belongs to.
	 */
	const needTarget = (value: unknown, sentence: string): WebTarget => {
		if (typeof value === "string") {
			if (!value.trim()) throw new Error(sentence);
			return value.trim();
		}
		if (value && typeof value === "object") {
			const ref = (value as { ref?: unknown }).ref;
			if (typeof ref === "string" && ref.trim()) return { ref: ref.trim() };
			const named = (value as { name?: unknown }).name;
			const nth = (value as { nth?: unknown }).nth;
			if (typeof named === "string" && named.trim()) return { name: named.trim(), ...(typeof nth === "number" ? { nth } : {}) };
		}
		throw new Error(sentence);
	};

	/**
	 * The boards as **this agent** sees them: its own stage, which is the one `stage.move` writes
	 * to. Every read in this file goes through here, so a verb cannot quietly answer for somebody
	 * else's arrangement.
	 */
	const isolated = () => agent.isolated?.() === true;
	/*
	 * Isolated mode (`agents/isolation.ts`): the stage is all there is. Every read goes through
	 * `here`, so filtering it is what keeps the rest of the deck out of every verb at once.
	 */
	const here = () => {
		const all = service.boards(agent.id);
		if (!isolated()) return all;
		const mine = new Set(agent.inPlay());
		return all.filter((board) => mine.has(board.path));
	};
	/**
	 * Where a board goes, as an agent writes it: its top-left corner, `{ x1, y1 }` (`{ x, y }` is
	 * taken too, the shape `move` uses). Nothing when it was not given; a sentence when it is not
	 * two numbers, rather than a board quietly placed somewhere else.
	 */
	const cornerOf = (at: unknown): { x: number; y: number } | undefined => {
		if (at === undefined || at === null) return undefined;
		const raw = at as { x1?: unknown; y1?: unknown; x?: unknown; y?: unknown };
		const x = raw.x1 ?? raw.x;
		const y = raw.y1 ?? raw.y;
		if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
			throw new Error("at is the board's top-left corner on the stage, as in at: { x1: 1160, y1: 0 }.");
		}
		return { x: Math.round(x), y: Math.round(y) };
	};
	/**
	 * Say where a board that just joined the stage went, when the agent needs telling.
	 *
	 * The agent is asked to say where every board goes, so the two cases worth a sentence are the
	 * two where it did not get what it should want: it gave no place, and one was chosen for it;
	 * or it gave one that sits on something already there. A place given and clear says nothing.
	 */
	const reportPlace = (path: string, named: { x: number; y: number } | undefined, before?: { x: number; y: number }) => {
		const board = here().find((one) => one.path === path);
		if (!board) return;
		const box = { x: board.x, y: board.y, w: board.w, h: board.h };
		const corner = `x1 ${box.x}, y1 ${box.y}`;
		// A board shown again that came back to the place it had: nothing was chosen for it.
		if (!named && before && before.x === box.x && before.y === box.y) return;
		if (!named) {
			notes.push(`No at was given, so ${path} went beside your newest board, at ${corner}. Say where each board goes with at: { x1, y1 }: stage.pen.read() lists what is on your stage and where.`);
			return;
		}
		const hits = (other: { x: number; y: number; w: number; h: number }) =>
			box.x < other.x + other.w && other.x < box.x + box.w && box.y < other.y + other.h && other.y < box.y + box.h;
		const onStage = new Set(agent.inPlay());
		const under = here()
			.filter((one) => one.path !== path && onStage.has(one.path) && hits(one))
			.map((one) => one.path);
		const name = agent.stageName?.();
		let drawn = 0;
		try {
			if (service.pens && name) drawn = service.pens.drawn(name).filter(hits).length;
		} catch {
			// A stage file that does not parse has no drawing to overlap.
		}
		if (under.length || drawn) {
			const what = [...under, ...(drawn ? [`${drawn} drawn item${drawn === 1 ? "" : "s"}`] : [])].join(", ");
			notes.push(`${path} is at ${corner}, as asked, and sits on ${what}. Move it with stage.move if that was not meant.`);
		}
	};
	const notWhileIsolated = (what: string): never => {
		throw new Error(`Isolated mode: ${what} is not available while this agent can see only its own stage.`);
	};
	/** A workspace a caller named, cleaned as the store cleans it, or a sentence. */
	const askedWorkspace = (raw: unknown): string => {
		const clean = typeof raw === "string" ? cleanWorkspace(raw) : null;
		if (!clean) throw new Error('workspace is a project name, as in { workspace: "political-llm" }.');
		return clean;
	};

	const stage: Stage = {
		// --- reads ---------------------------------------------------------------
		/** Every board in the deck, placed as this agent's stage has them, with its box's two corners. */
		boards: async () => here().map(withBox),
		resolve: async (file: string) => {
			if (isolated()) {
				const path = agent.boardPathOf(file) ?? file;
				if (!agent.inPlay().includes(path)) notWhileIsolated(`resolving ${file}, which is not on this stage,`);
			}
			return service.resolve(file);
		},
		url: async (path: string) => service.url(path, port),
		/**
		 * How much room the canvas has, in CSS pixels — the window minus the chrome standing
		 * beside it, not divided by the zoom.
		 *
		 * `undefined` when nobody is looking, or before the first reading. There is no default
		 * on purpose: a made-up number is indistinguishable from a measured one at the point
		 * it is used, and a board sized against a fiction is worse than a board sized against
		 * your own judgement.
		 */
		viewport: async () => viewport(),

		/**
		 * Start a board: the shell, written for you, so you write only the content.
		 *
		 * Attaches it and puts it on the canvas — without moving the camera, which stays
		 * where the user left it until `show` is called. Returns the deck-relative path to
		 * edit.
		 */
		newBoard: async (options: { title: string; template?: string; kind?: string; format?: string; w?: number; h?: number; at?: { x1: number; y1: number } }) => {
			const title = options?.title?.trim();
			if (!title) throw new Error("A board needs a title");
			const named = cornerOf(options.at);
			/*
			 * What the board *is as a file*, which is all a new board is allowed to choose.
			 *
			 * `board` is the default and is nearly always the answer: one HTML document, whose
			 * root-level blocks are placed where they say and flow where they do not, and whose
			 * height is measured. `slides` is a reveal deck, which is a different thing to read
			 * rather than a different way to write one. The two words that used to name the two
			 * board formats, `component` and `flow`, both mean `board` now. The extension is
			 * derived from this and never named — see `boards/templates.ts`.
			 */
			const format = asBoardFormat(options.format ?? "board");
			if (!format) throw new Error(`Unknown format ${options.format}; use one of ${BOARD_FORMATS.join(", ")}`);
			/*
			 * There are no templates any more — every board starts blank — but the arguments
			 * are still accepted rather than refused. This signature is in the `stage.d.ts`
			 * every agent has already read: an agent mid-turn is working from the contract as
			 * it was when its session opened, and breaking that costs somebody a turn to save
			 * a deprecation. What used to be a shape is now nothing shaped; the board is blank
			 * however it was asked for.
			 */
			if (options.template ?? options.kind) {
				notes.push("new boards are blank — there are no templates any more, so the shape asked for was ignored.");
			}

			/*
			 * The width, when nobody said one: the format's own, held inside the screen.
			 *
			 * A phone is what makes it worth doing rather than suggesting: at a 390px
			 * viewport every default is wider than the screen, and the board has to fit the
			 * room it is read in. There is no ceiling of ours in it any more — a width that
			 * *was* asked for is used at any size, and 1200 is advice in the note below.
			 */
			const view = viewport();
			const width = boardWidth(options.w, view?.width, format);
			// Isolated, a new board is the stage's own from the start (`deck/stage-boards.ts`).
			const stageName = isolated() ? agent.stageName?.() : undefined;
			const path = service.newBoard({
				title,
				format,
				size: { w: width, ...(options.h ? { h: options.h } : {}) },
				...(stageName ? { folder: stageBoardsDir(stageName) } : {}),
			});
			agent.setInPlay([...agent.inPlay(), path], named ? { [path]: named } : undefined);
			reportPlace(path, named);
			agent.worked?.(path);
			agent.acted?.("new", path);
			/*
			 * The size of the thing you are about to fill, and the advice that goes with it.
			 *
			 * The number used to be the whole of it, on the reasoning that an agent that
			 * knows the canvas is 1400×900 does not need telling how wide a board should be.
			 * It did: knowing the room and choosing 1900 anyway is exactly what kept
			 * happening, because nothing joined the two. So the advice goes beside the
			 * number, at the moment it would be used — **as advice**, since the clamp that
			 * used to enforce it is gone and a board wider than this is now allowed to
			 * exist.
			 */
			if (view) notes.push(`viewport ${view.width}×${view.height} px`);
			notes.push(
				`board width ${width}. One screen: about ${Math.round(width * 0.7)} px tall, about 120 words, body text 17px or larger and nothing under 14px. stage.fit will say which of these a board is over.`,
			);
			return path;
		},

		/**
		 * Set a board's size, in one call, without opening the file.
		 *
		 * Either dimension on its own is allowed, because the one that is usually wrong is
		 * the height.
		 */
		resize: async (path: string, size: { w?: number; h?: number }) => {
			if (!size || (size.w === undefined && size.h === undefined)) throw new Error("A resize needs a width, a height, or both");
			const board = service.resize(path, size);
			agent.acted?.("resize", board.path);
			return { path: board.path, w: board.w, h: board.h };
		},

		/**
		 * Size a board to its content: the height, and only the height.
		 *
		 * The width is left exactly as the file has it. A fit that changed it would be a call that
		 * reflows somebody's document to a number it measured for a moment, and it was wrong in a
		 * second way on a flow board, where the width it read back was the frame's own.
		 */
		fit: async (path: string, options?: { margin?: number }) => {
			const { board, content, reading, views } = await service.fit(path, options);
			agent.worked?.(board.path);
			agent.acted?.("resize", board.path);
			/*
			 * What the browser read, said as sentences, so the check costs no screenshot.
			 *
			 * An agent told "one screen, about 120 words, nothing under 14px" used to find out
			 * whether it had managed it by driving Playwright and reading a picture, which was
			 * a third of what a board cost. The frame that measures the height can count the
			 * words and find the smallest type in the same pass, so `fit` says them. Only what
			 * is over is mentioned: a board inside all three gets the numbers and no advice.
			 */
			const screen = Math.round(board.w * 0.72);
			const over: string[] = [];
			if (content.h > screen) over.push(`${content.h} px tall, which is more than one screen (about ${screen} px at this width)`);
			if (reading.words !== undefined && reading.words > 170) over.push(`${reading.words} words, where about 120 is what gets read`);
			if (reading.minFont !== undefined && reading.minFont < 14) over.push(`its smallest text is ${reading.minFont}px, and under 14px is not readable once the board is fitted to a window`);
			if (reading.overflowX !== undefined) over.push(`${reading.overflowX} px wider than the board, so its right edge is cut off: something (a table, a row, a long word) does not fit the width`);
			if (reading.cut !== undefined) over.push(`${reading.cut} box${reading.cut === 1 ? "" : "es"} on it cut off their own content: a fixed-height panel is too short for what is in it, and a board cannot scroll`);
			if (reading.overlaps !== undefined) over.push(`${reading.overlaps} pair${reading.overlaps === 1 ? "" : "s"} of labels in a drawing overlap each other: move them apart or shorten them, then look at it with a screenshot`);
			for (const view of views?.views ?? [])
					over.push(
						`after pressing "${view.label}" it is ${view.h} px tall${view.overflowX ? ` and ${view.overflowX} px too wide` : ""}, where it opens at ${views?.opening} px: a board's height is measured in the view it opens on, so a taller view has its last lines cut. Give the panel a min-height, or move that view to its own board`,
					);
			for (const error of views?.errors ?? []) over.push(`a script on it throws: ${error}`);
			if (over.length) notes.push(`This board is ${over.join("; ")}. Cut it, enlarge the type, or move the second idea to its own board. A document the person asked for in full (a message, a list, code) is exempt from the height and the word count.`);
			else if (reading.words !== undefined) notes.push(`One screen: ${content.h} px tall, ${reading.words} words${reading.minFont === undefined ? "" : `, smallest text ${reading.minFont}px`}${views ? `, ${views.controls} control${views.controls === 1 ? "" : "s"} pressed and every view fits` : ""}. Nothing to fix.`);
			return { path: board.path, w: board.w, h: board.h, content };
		},

		/**
		 * Say which boards carry your work, without moving anything.
		 *
		 * `fit` and a one-board `show` already say it. This is for the rest: a board edited and
		 * left where it was, or several at once. You become each board's writer, and they are
		 * what a task you were handed lists as its boards.
		 */
		report: async (path: string | string[]) => {
			const paths = asList(path);
			for (const one of paths) {
				if (!here().some((board) => board.path === one)) throw new Error(`No such board: ${one}`);
			}
			for (const one of paths) agent.worked?.(one);
			return { reported: paths };
		},

		// --- the stage -------------------------------------------------------------
		/**
		 * Put these boards on this agent's stage, beside what is already there — or look at a
		 * **drawn item**, by its id in `stage.pen`.
		 *
		 * Added to, never narrowed: taking a board off is `hide`. The camera fits what was named,
		 * and anything not already held is held from now on — showing a board is working on it. An
		 * item is not held, because it is part of the stage already; naming one is only "look at
		 * this", and naming an item and a board together frames both.
		 *
		 * `animate: true` makes the camera **arrive** rather than jump — 420ms, easing out. It is off
		 * by default: an op states where to look, and something watching the camera a frame later
		 * should see what was asked for. The board's own links and the panel glide without being
		 * asked, because those are a person's hands.
		 */
		show: async (target: string | string[], options?: { fit?: "board" | "all"; highlight?: string; animate?: boolean; at?: { x1: number; y1: number } }) => {
			const wanted = asList(target);
			const named = cornerOf(options?.at);
			if (named && wanted.length !== 1) throw new Error("at places one board: show them one at a time, each with its own at.");
			const paths: string[] = [];
			const items: Array<{ id: string; box: { x: number; y: number; w: number; h: number } }> = [];
			for (const one of wanted) {
				if (here().some((board) => board.path === one)) {
					paths.push(one);
					continue;
				}
				const box = itemBox(one);
				if (!box && isolated()) notWhileIsolated(`showing ${one}, which is not on this stage,`);
				if (!box) throw new Error(`No such board or drawn item: ${one}`);
				items.push({ id: one, box });
			}
			const up = agent.inPlay();
			const joining = paths.filter((one) => !up.includes(one));
			const had = agent.positions?.() ?? {};
			const [one] = paths;
			if (named && one !== undefined && up.includes(one)) {
				// Already on the stage: a place named for it is a move.
				service.move(agent.id, one, named);
				agent.acted?.("move", one);
			}
			agent.setInPlay([...up, ...joining], named && one !== undefined && joining.includes(one) ? { [one]: named } : undefined);
			for (const path of joining) reportPlace(path, named, had[path]);
			// One board named is the focusing gesture: "look at what I made". Several is arranging
			// the canvas, and is nobody's byline. A drawn item is neither: it is already on the
			// stage, and looking at it is not authorship of anything.
			const [only] = paths;
			if (only !== undefined && wanted.length === 1) agent.worked?.(only);
			for (const one of paths) agent.acted?.("show", one);
			const { at: _at, ...showing } = options ?? {};
			return service.show(agent.id, paths, { ...showing, ...(items.length > 0 ? { items } : {}) });
		},
		/** Take boards off this agent's stage, keeping them in context. */
		hide: async (path: string | string[]) => {
			const dropping = new Set(asList(path));
			const up = agent.inPlay();
			const left = up.filter((playing) => !dropping.has(playing));
			agent.setInPlay(left);
			for (const one of dropping) if (up.includes(one)) agent.acted?.("hide", one);
		},
		move: async (path: string, at: { x: number; y: number }) => {
			const board = service.move(agent.id, path, at);
			agent.acted?.("move", board.path);
			return withBox(board);
		},
		camera: (async (at?: Camera, options?: { animate?: boolean }) => {
			if (!at) return agent.camera();
			await service.setCamera(agent.id, at, options ?? {});
			return undefined;
		}) as {
			(): Promise<Camera>;
			(at: Camera, options?: { animate?: boolean }): Promise<void>;
		},
		reload: async (path: string) => service.reload(agent.id, path),
		cursor: async (path: string, at: { x: number; y: number } | null) =>
			service.cursor(agent.id, path, at, agent.identity().name, agent.identity().color),

		// --- identity -------------------------------------------------------------
		/**
		 * Point at something on a board: a bubble with a small arrow, drawn on the canvas.
		 *
		 * Transient — nothing is written to the board file, so a board that has been annotated
		 * is byte-identical to one that has not. `to` is a component's `data-id`, which is what
		 * makes the arrow follow it when it moves; a `{ x, y }` is taken as a board coordinate.
		 * Four at most per board, and `null` clears the ones this agent put there.
		 */
		annotate: async (path: string, marks: unknown) => service.annotate(agent.id, path, marks),

		/**
		 * Who you are, and what you are doing: read it with nothing, change it with a patch.
		 *
		 * One verb where there were five, because they were one act with five names — and the
		 * patch is what a model can hold in its head: `stage.me({ name: "Sable", tags: ["panel"] })`.
		 * What comes back is the identity **as stored**, which is not always what was passed:
		 * tags are slugged, deduped and capped at four, so `["Reading panel.css and measuring"]`
		 * comes back as `["reading-panel-css-and"]`. Returning it is the only way a model finds
		 * that out, and the alternative — silently storing something other than what it thinks it
		 * set — is how an agent ends up setting the same tags forever.
		 *
		 * `workspace` is the project it works in, as a slug: `"Political LLM"` comes back as
		 * `political-llm`, the word the others on that project use too.
		 */
		me: async (patch?: { name?: string; avatar?: { emoji: string } | { svg: string }; tags?: string[]; workspace?: string }) => {
			if (patch?.name !== undefined) {
				const clean = String(patch.name).trim().slice(0, 40);
				if (!clean) throw new Error("A name cannot be empty");
				/*
				 * One name, one agent. A name is an address — the bar reads `@Sable` and the
				 * deck has to know which Sable — so a second agent taking one is refused rather
				 * than quietly numbered: the model picked a word, and it is the one who should
				 * pick the next one.
				 */
				const mine = agent.identity().name.trim().toLowerCase();
				const taken = clean.toLowerCase() !== mine && agent.agents().some((other) => other.id !== agent.id && other.name.trim().toLowerCase() === clean.toLowerCase());
				if (taken) throw new Error(`Another agent is already called ${clean}. Pick a different name.`);
				agent.rename(clean);
			}
			if (patch?.avatar !== undefined) {
				const avatar = patch.avatar;
				if ("emoji" in avatar) {
					// An emoji becomes a data URL rather than a special case in the browser: one
					// code path for "the agent has a picture".
					const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="44" font-size="44" text-anchor="middle">${escapeXml(String(avatar.emoji).slice(0, 4))}</text></svg>`;
					agent.setAvatar(service.writeAvatar(agent.id, svg));
				} else {
					if (!/^\s*<svg[\s>]/i.test(avatar.svg)) throw new Error("An SVG avatar must start with <svg>");
					agent.setAvatar(service.writeAvatar(agent.id, avatar.svg));
				}
			}
			if (patch?.tags !== undefined) agent.setTags(patch.tags);
			if (patch?.workspace !== undefined) agent.setWorkspace(patch.workspace);
			return agent.identity();
		},

		/**
		 * Hand work to somebody else, and carry on.
		 *
		 * One verb for the two that were: a **name or id** sends to an agent that exists, and a
		 * **shape** — `{ name, kind }` — makes the agent and sends to it. It always
		 * returns at once, because it has to: a stage run is abandoned after twenty seconds and
		 * a turn is minutes, so there is no honest way to wait for an answer inside a call.
		 * `reply: true` is how the answer reaches you — their report lands in your transcript
		 * and you read it on your next turn.
		 *
		 * The receiver starts when it has been quiet for a while, so nothing interrupts a turn in
		 * progress, and it is handed the board *source* when it runs rather than when you sent it,
		 * so a board that changes in between is read as it is.
		 */
		send: async (target: string | CreateSpec, spec: SendSpec) => {
			if (!spec?.task?.trim()) throw new Error("Sent work needs a description");
			const work = {
				task: spec.task,
				...(spec.boards ? { boards: spec.boards } : {}),
				...(spec.reply ? { reply: true } : {}),
			};
			/*
			 * A shape rather than a name: the agent is made first, on your runtime, account and
			 * workspace unless it says otherwise, and the work goes into its queue. This is what
			 * `create` and `delegate` were, minus the wait that could not be kept.
			 */
			if (target && typeof target === "object") {
				if (!agent.create) throw new Error("This deck cannot make agents.");
				const name = String(target.name ?? "").trim();
				if (!name) throw new Error('A new agent needs a name: stage.send({ name: "Rune" }, { task });');
				const made = await agent.create({ ...target, name });
				return { ...agent.send(made.agent, work), agent: made.agent, name: made.name };
			}
			const to = String(target ?? "").trim();
			if (!to) throw new Error("Say who: a name or id from stage.agents(), or { name } to make one.");
			return agent.send(to, work);
		},
		/** What is waiting for an agent: yours, or another's if you name it. */
		queue: async (agentId?: string) => agent.queue(agentId),

		/**
		 * The time where the person is: the deck's timezone (Settings, Time), which the
		 * server's own clock follows. For "since yesterday" and "by Friday", and for a
		 * session long enough that the date it was started on has passed.
		 */
		now: async () => {
			const at = Date.now();
			const zone = processZone();
			const parts = partsIn(at, zone);
			return {
				iso: isoIn(at, zone),
				timezone: zone,
				offset: offsetLabel(at, zone),
				weekday: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][parts.weekday] ?? "",
				words: nowWords(at, zone),
				epoch: at,
			};
		},

		/**
		 * The user's own Chrome, shared with the deck through the Decks extension.
		 *
		 * Every call throws a sentence when no tab is shared, which is the state to expect
		 * first: the user has to pair the extension once and share a tab each time. There is
		 * no picture of the tab — it is on the user's own screen — so `read` is how the agent
		 * sees it: the address, the title, and the accessibility tree with every field's
		 * label and value.
		 */
		web: {
			/** Connected or not, which tab, what the agent did; the status board draws this. */
			status: async () => needWeb().status(),
			/** What to put in the extension: the address is the one the browser uses for Decks. */
			pairing: async () => ({ code: needWeb().code(), path: "/api/web/relay", note: "Paste the Decks address and this code into the Decks extension's popup, then share a tab." }),
			/** A fresh code; the extension has to be paired again. */
			repair: async () => ({ code: needWeb().repair() }),
			/** Make (or find) the status board, and put it on this agent's stage. */
			board: async () => {
				const path = needWeb().board();
				agent.setInPlay([...agent.inPlay().filter((shown) => shown !== path), path]);
				return path;
			},
			open: async (url: string) => {
				if (!url?.trim()) throw new Error("open needs a URL");
				return needWeb().open(url.trim());
			},
			read: async () => needWeb().read(),
			/**
			 * A picture of the tab, attached to this call's result so you see it at once, and
			 * saved to `file` for a second look. `full: true` is the whole page.
			 */
			screenshot: async (options?: { full?: boolean }) => {
				const shot = await needWeb().screenshot(options);
				images.push({ data: shot.png.toString("base64"), mimeType: "image/png" });
				return { file: shot.file, width: shot.width, height: shot.height };
			},
			fill: async (field: WebTarget, text: string) => needWeb().fill(needTarget(field, "fill needs the field's label, or a { ref } from stage.web.read()"), String(text ?? "")),
			select: async (field: WebTarget, option: string) => needWeb().select(needTarget(field, "select needs the field's label, or a { ref } from stage.web.read()"), option),
			click: async (what: WebTarget) => needWeb().click(needTarget(what, "click needs the button's or link's name, or a { ref } from stage.web.read()")),
			press: async (key: string) => needWeb().press(key),
			/**
			 * Press the named button, or Enter, once the user has allowed it on the status
			 * board. Pass `{ ask: false }` only when the user has said they do not want to be
			 * asked for this site.
			 */
			submit: async (what?: WebTarget, options?: { ask?: boolean }) =>
				needWeb().submit(what === undefined ? undefined : needTarget(what, "submit needs the button's name, or a { ref } from stage.web.read()"), options),
			/** Detach from the shared tab. */
			stop: async () => needWeb().stop(),
		},

		/**
		 * The stage's drawing: a native pen.dev document at `stages/<name>/stage.pen`.
		 *
		 * Notes, text, shapes, arrows and frames live here, drawn over the boards by the canvas, backdrops under them.
		 * `read` gives every item as saved plus its `box` on the stage; `edit` applies pen operations
		 * together or not at all and answers with each item's new box; `file` is the path, for an
		 * agent that would rather edit the JSON with its own tools. The wording of the format is
		 * pen.dev's, untranslated — the skill `pen-stage` teaches it.
		 */
		/** Every stage in the deck, who has it open, and how much is on it. */
		stages: async () => {
			const pens = needPens();
			const mine = agent.stageName?.();
			const everyone = agent.agents();
			// Isolated, the isolated stages are all there are (`stage/isolated-stages.ts`).
			return pens.names().filter((name) => !isolated() || isIsolatedStage(pens, name)).map((name) => ({
				name,
				open: everyone.filter((other) => (other.id === agent.id ? mine : other.stage) === name).map((other) => other.name),
				boards: pens.boards(name).length,
				...(name === mine ? { mine: true } : {}),
			}));
		},
		/** Work on another stage: its boards are yours from now on, and the person sees it when talking to you. */
		open: async (name: string) => {
			if (typeof name !== "string" || !name.trim()) throw new Error('open names a stage, as in stage.open("deploy"); stage.stages() lists them.');
			if (!agent.openStage) throw new Error("This agent cannot change stages.");
			agent.openStage(name.trim());
			return { stage: name.trim(), boards: agent.inPlay() };
		},
		/** A new, empty stage named from a title, opened at once. */
		newStage: async (title: string) => {
			if (typeof title !== "string" || !title.trim()) throw new Error('newStage takes a title, as in stage.newStage("Launch plan").');
			if (!agent.newStage) throw new Error("This agent cannot make stages.");
			return { stage: agent.newStage(title.trim()) };
		},

		/**
		 * A picture of your stage, or of part of it, as the person sees it: the drawing and the live
		 * boards together. Attached to this call's result so you see it at once, and saved to `file`.
		 * `of` is an item's id, a board's path, a list of them, or a box; nothing is the whole stage.
		 * `to` saves it where you say instead, and `format: "pdf"` or `"jpeg"` for other kinds.
		 */
		screenshot: async (options?: { of?: ShotOf; scale?: number; format?: ShotFormat; to?: string; scheme?: "light" | "dark" }) => {
			if (!service.shots) throw new Error("This server cannot take pictures of a stage.");
			const { of, scale, format, to, scheme } = options ?? {};
			const shot = await service.shots.take({ stage: needStage(), of, ...(scale !== undefined ? { scale } : {}), ...(format ? { format } : {}), ...(to ? { to } : {}), ...(scheme ? { scheme } : {}) });
			if (shot.format !== "pdf") images.push({ data: shot.bytes.toString("base64"), mimeType: shot.format === "jpeg" ? "image/jpeg" : "image/png" });
			return { file: shot.file, width: shot.width, height: shot.height, box: shot.box };
		},

		pen: {
			file: async () => `stages/${needStage()}/stage.pen`,
			read: async () => {
				const { file: _file, ...view } = needPens().read(needStage());
				return { ...view, file: `stages/${view.stage}/stage.pen` };
			},
			edit: async (ops: readonly unknown[]) => {
				const pens = needPens();
				// Checked by `apply`, which answers a malformed edit with a sentence naming it.
				const boards = new Map(here().map((board) => [board.path, { x: board.x, y: board.y, w: board.w, h: board.h }]));
				const { entry, results } = pens.edit(needStage(), ops as readonly Op[], (path) => boards.get(path));
				const placed = placements(entry.doc, { theme: baseTheme(entry.doc, "light") });
				return {
					rev: entry.rev,
					results: results.map((result) => {
						const box = result.op === "delete" ? undefined : boxOf(placed.get(result.id));
						return { ...result, ...(box ? { box } : {}) };
					}),
				};
			},
		},

		/** Every agent, or with `filter.workspace` the ones that say they work on that project. */
		agents: async (options?: { filter?: { workspace?: string } }) => {
			const filter = options?.filter;
			const workspace = filter?.workspace === undefined ? undefined : askedWorkspace(filter.workspace);
			return agent
				.agents()
				.filter((other) => (workspace === undefined ? true : (other.workspace ?? "") === workspace))
				.map((other) => ({
					id: other.id,
					name: other.name,
					me: other.id === agent.id,
					state: other.state,
					kind: other.kind,
					context: other.context,
					// The true total rides beside the twenty shown, so a reader can tell a slice
					// from everything (agents/registry.ts caps; this passes the cap through).
					holding: other.holding,
					tags: other.tags,
					// Which project they are on, so "who else is on this" is one call rather than two.
					workspace: other.workspace,
					/** How much is already waiting for them — a queue of six is a reason to send elsewhere. */
					queued: other.queued ?? 0,
				}));
		},

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

	/*
	 * The names that are gone, and what to say instead.
	 *
	 * A verb that stops existing becomes "stage.mirror is not a function", which is a turn
	 * thrown away and a model with no idea what to do next. So each removed name stays
	 * callable for one release and refuses with the call that replaces it. They are added
	 * after the object rather than declared in `Stage`, because the whole point is that they
	 * are not part of the API any more — nothing in the type, nothing in the prompt.
	 */
	Object.assign(stage, Object.fromEntries(Object.entries(GONE).map(([name, sentence]) => [name, async () => { throw new Error(sentence); }])));
	/*
	 * `me` was five verbs and is one, and it is the busiest thing that moved — 129 calls to
	 * `me.setTags` alone on this deck. A call to the old shape has to say so rather than read
	 * as a missing property, so the function carries the five names and each throws its own
	 * sentence.
	 */
	Object.assign(stage.me, {
		get: async () => { throw new Error("stage.me.get() is now stage.me()."); },
		setName: async () => { throw new Error('stage.me.setName(name) is now stage.me({ name }).'); },
		setAvatar: async () => { throw new Error("stage.me.setAvatar(avatar) is now stage.me({ avatar })."); },
		setTags: async () => { throw new Error("stage.me.setTags(tags) is now stage.me({ tags })."); },
		setWorkspace: async () => { throw new Error('stage.me.setWorkspace(name) is now stage.me({ workspace }).'); },
	});

	return {
		name: STAGE_TOOL_NAME,
		label: "Stage",
		description: toolDescription(),
		promptSnippet: "Run TypeScript against your stage: show boards, hold them in context, name yourself",
		guidelines: GUIDELINES,
		parameterDescription: "TypeScript, run as an async function body with `stage` in scope. Return a value to see it.",
		stage,
		snapshot,
		webShared: () => service.web?.status().paired === true,

		async run(code: string): Promise<StageToolResult> {
			notes = [];
			images = [];
			const outcome = await runEval(code, stage);
			const parts: string[] = [];
			if (outcome.logs.length > 0) parts.push(outcome.logs.join("\n"));
			if (outcome.error) parts.push(`Error: ${outcome.error}`);
			else if (outcome.value !== undefined) parts.push(safeJson(outcome.value));
			else parts.push("(done)");
			// After the value, because the value is the answer and this is a fact about the
			// canvas the call happened on.
			if (notes.length > 0) parts.push(...notes);
			// Last, and after the run, so a call that has just set them hears nothing
			// (`agents/identity-reminder.ts`).
			const unsaid = identityReminder(agent.identity());
			if (unsaid) parts.push(unsaid);

			// Written after every run, failed ones included: a run that threw halfway may
			// still have attached a board, and the snapshot is what the canvas is restored
			// from.
			deps.persist?.(snapshot());

			// A timed-out eval is reported rather than raised — the code may well have done
			// its work before the timer — which is the one case that is an error to read
			// and not an error to fail.
			return {
				text: parts.join("\n"),
				isError: Boolean(outcome.error) && !outcome.timedOut,
				...(images.length > 0 ? { images: [...images] } : {}),
			};
		},
	};
}

/** A board with its box as both corners, beside `x`, `y`, `w`, `h`, so a reader never adds a width. */
function withBox<B extends { x: number; y: number; w: number; h: number }>(board: B): B & { box: { x1: number; y1: number; x2: number; y2: number } } {
	return { ...board, box: { x1: board.x, y1: board.y, x2: board.x + board.w, y2: board.y + board.h } };
}

function escapeXml(text: string): string {
	return text.replace(/[<>&"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
