import { isoIn, isZone, nowWords, offsetLabel, partsIn, processZone } from "../clock.ts";
import { existsSync, readFileSync } from "node:fs";
import type { ActKind, AgentKind, AgentMode, AgentState, Camera, Canvas, Identity, Schedule, ScheduleSpec, TaskResult, TaskSpec, ThinkingLevel } from "@decks/protocol";
import { guidelinesFile, toolDescription as toolDescriptionPath } from "@decks/runtime";
import type { Stage } from "../../../../runtime/stage.d.ts";
import { slug } from "../agents/slug.ts";
import { MAX_CANVAS_NAME } from "../canvas/store.ts";
import { cleanWorkspace, roster } from "../agents/workspaces.ts";
import { asBoardFormat, BOARD_FORMATS, boardWidth } from "../boards/templates.ts";
import { runEval, safeJson } from "./eval.ts";
import type { StageService, WebTarget } from "./service.ts";

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
	/**
	 * The dashboard task this item belongs to, when the dashboard made it.
	 *
	 * Carried so the drain can report back: the task turns `assigned` into `running`
	 * when this item pops, and `done` or `failed` when its turn ends. Without it a
	 * task would sit in `assigned` forever and the panel would have to guess.
	 */
	taskId?: string;
	/** The sender asked for the report back — see `SendSpec.reply`. */
	reply?: boolean;
	/**
	 * A dashboard task this item asks the *dispatcher* to place rather than to do. While it
	 * runs, a `send` from the dispatcher is read as the answer; ending without one blocks
	 * the task with what the dispatcher said.
	 */
	decide?: string;
}

export interface StageAgentHooks {
	id: string;
	identity(): Identity;
	context(): string[];
	inPlay(): string[];
	setInPlay(paths: string[]): void;
	/** Where this stage has put its boards. Optional so a host that does not arrange can omit it. */
	positions?(): Record<string, { x: number; y: number }>;
	setPosition?(path: string, x: number, y: number): void;
	rename(name: string): void;
	setAvatar(url: string): void;
	/** Replaces the agent's own tags and returns them as stored — see `agents/tags.ts`. */
	setTags(tags: unknown): string[];
	/** Replaces the agent's workspace and returns it as stored — see `agents/workspaces.ts`. */
	setWorkspace(workspace: unknown): string | null;
	/**
	 * The canvas this agent works on, and the verbs that draw between its boards.
	 *
	 * Optional so a host with no canvases — a board running its own code — can leave it out;
	 * the verbs then refuse with a sentence rather than doing something to a canvas nobody
	 * meant. Every verb answers with the canvas as it now is, so an agent sees what it did.
	 */
	canvas?: {
		current(): Canvas | undefined;
		list(): Canvas[];
		use(name: string, workspace?: string): Canvas | undefined;
		link(from: string, to: string, label?: string): Canvas | undefined;
		unlink(from: string, to: string): Canvas | undefined;
		group(paths: string[], name: string): Canvas | undefined;
		ungroup(name: string): Canvas | undefined;
	};
	agents(): Array<{ id: string; name: string; state: AgentState; context: string[]; holding: number; kind: AgentKind; tags: string[]; workspace?: string; queued?: number }>;
	/** Where the browser last said it was looking. */
	camera(): Camera;
	/** Queue work for an agent that already exists, and return without waiting. */
	send(target: string, spec: SendSpec): { queued: true; position: number };
	/** Make an agent and return at once; optional so a host with no registry can omit it. */
	create?(spec: CreateSpec): Promise<{ agent: string; name: string }>;
	/** What is waiting for an agent — this one, unless another is named. */
	queue(agentId?: string): QueuedWork[];
	/**
	 * Make a dashboard task: the deck decides which agent it belongs to.
	 *
	 * An agent asking for work to be done *somewhere* — a fan-out it does not want to
	 * supervise, a board it has no right to write — hands the text to the same rule
	 * and the same queue the panel uses, and gets back where it went. Optional so a
	 * caller with no dashboard (a board actor) can leave it out; the stage verb then
	 * refuses with a sentence.
	 */
	task?(spec: TaskSpec): TaskResult;
	/** Make a schedule — `stage.schedule`. Optional on the same terms as `task`. */
	schedule?(spec: ScheduleSpec): Schedule | { error: string };
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

/** A canvas name as the store tells names apart: `Political LLM` and `political-llm` are one. */
const slugName = (name: string) => slug(name, MAX_CANVAS_NAME);

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
	workspaces: "stage.workspaces() is gone. stage.canvases({ workspace }) is the list, with who is working on each.",
	inPlay: "stage.inPlay() is now stage.boards(): with no filter it is the boards on your canvas.",
	attach: "stage.attach is gone: stage.show(path) puts a board on your canvas, and you hold what you show.",
	detach: "stage.detach is gone: stage.hide(path) takes a board off your canvas.",
	unlink: "stage.unlink(a, b) is now stage.link(a, b, null).",
	ungroup: 'stage.ungroup(name) is now stage.group([], { name }).',
	task: 'stage.task({ text }) is now stage.send("dispatcher", { task: text }).',
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
	/** The shared Chrome, or the sentence that says this server has none. */
	const needWeb = () => {
		if (!service.web) throw new Error("This server has no shared browser.");
		return service.web;
	};
	/** The goal-driven browser agent, or the sentence that says this server has none. */
	const needJev = () => {
		if (!service.jev) throw new Error("This server has no jev browser agent.");
		return service.jev;
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
	 * The boards as **this agent** sees them: its own canvas, which is the one `stage.move` writes
	 * to. Every read in this file goes through here, so a verb cannot quietly answer for somebody
	 * else's arrangement.
	 */
	const here = () => service.boards(agent.id);
	/** A workspace a caller named, cleaned as the store cleans it, or a sentence. */
	const askedWorkspace = (raw: unknown): string => {
		const clean = typeof raw === "string" ? cleanWorkspace(raw) : null;
		if (!clean) throw new Error('workspace is a project name, as in { workspace: "political-llm" }.');
		return clean;
	};
	/** A canvas by id or by name, as the store matches names, or a sentence naming the call that makes one. */
	const findCanvas = (raw: string): Canvas => {
		const list = canvasHooks().list();
		const found = list.find((canvas) => canvas.id === raw) ?? list.find((canvas) => slugName(canvas.name) === slugName(raw));
		if (!found) throw new Error(`No canvas "${raw}". stage.canvases() lists them; stage.newCanvas("${raw}") makes one.`);
		return found;
	};
	/** The rooms a `boards` filter names, or `undefined` for "your own canvas". */
	const canvasScope = (filter?: { canvas?: string; workspace?: string }): Canvas[] | undefined => {
		if (!filter || (filter.canvas === undefined && filter.workspace === undefined)) return undefined;
		const workspace = filter.workspace === undefined ? undefined : askedWorkspace(filter.workspace);
		const rooms = filter.canvas === undefined ? canvasHooks().list() : [findCanvas(filter.canvas)];
		return workspace === undefined ? rooms : rooms.filter((canvas) => (canvas.workspace ?? "") === workspace);
	};

	const stage: Stage = {
		// --- reads ---------------------------------------------------------------
		/**
		 * Every board in the deck, or the ones a filter names. `filter.canvas` is one room by name
		 * or id, `filter.workspace` every room in a project; both together narrow to that room
		 * when it is in the project. A filtered board says which canvas it was found on, placed as
		 * that canvas has it, so a board on two canvases comes back twice.
		 */
		boards: async (options?: { filter?: { canvas?: string; workspace?: string } }) => {
			const rooms = canvasScope(options?.filter);
			if (!rooms) return here();
			return rooms.flatMap((room) =>
				service
					.boards(agent.id, room.id)
					.filter((board) => room.boards.includes(board.path))
					.map((board) => ({ ...board, canvas: room.name })),
			);
		},
		resolve: async (file: string) => service.resolve(file),
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
		newBoard: async (options: { title: string; template?: string; kind?: string; format?: string; w?: number; h?: number }) => {
			const title = options?.title?.trim();
			if (!title) throw new Error("A board needs a title");
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
			const path = service.newBoard({
				title,
				format,
				size: { w: width, ...(options.h ? { h: options.h } : {}) },
			});
			agent.setInPlay([...agent.inPlay(), path]);
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

		// --- the canvas ------------------------------------------------------------
		/**
		 * Put these boards on the canvas, beside what is already there.
		 *
		 * **A canvas is added to, never narrowed.** `show` used to make the canvas exactly what
		 * was named, which let one call clear a room other agents and the person were working
		 * in, and agents used it to start a new topic on top of an old one. A new topic is a new
		 * canvas (`stage.canvas(name)`); on the same topic the boards pile up and only the ones
		 * that are truly out of date are taken off with `hide`. The camera fits what was named,
		 * and anything not already held is attached — showing a board is working on it.
		 *
		 * `animate: true` makes the camera **arrive** rather than jump — 420ms, easing out. It is off
		 * by default: an op states where to look, and something watching the camera a frame later
		 * should see what was asked for. The board's own links and the panel glide without being
		 * asked, because those are a person's hands.
		 */
		show: async (path: string | string[], options?: { fit?: "board" | "all"; highlight?: string; animate?: boolean }) => {
			const paths = asList(path);
			for (const one of paths) {
				if (!here().some((board) => board.path === one)) throw new Error(`No such board: ${one}`);
			}
			const up = agent.inPlay();
			agent.setInPlay([...up, ...paths.filter((one) => !up.includes(one))]);
			// One board named is the focusing gesture: "look at what I made". Several is arranging
			// the canvas, and is nobody's byline.
			const [only] = paths;
			if (only !== undefined && paths.length === 1) agent.worked?.(only);
			for (const one of paths) agent.acted?.("show", one);
			return service.show(agent.id, paths, options ?? {});
		},
		/**
		 * Take boards off the canvas, keeping them in context.
		 *
		 * Refused when it would leave the canvas empty: clearing a room is how an agent used to
		 * start a new topic, and the room is shared — the person and other agents lose what
		 * they were looking at. The sentence says what to do instead.
		 */
		hide: async (path: string | string[]) => {
			const dropping = new Set(asList(path));
			const up = agent.inPlay();
			const left = up.filter((playing) => !dropping.has(playing));
			if (left.length === 0 && up.length > 0) {
				throw new Error(
					"That would empty the canvas, and a canvas is not cleared. For a new topic, start a new canvas with stage.canvas(\"a name for the topic\") and show your boards there; on the same topic, add to this one and hide only the boards that are really out of date.",
				);
			}
			agent.setInPlay(left);
			for (const one of dropping) if (up.includes(one)) agent.acted?.("hide", one);
		},
		move: async (path: string, at: { x: number; y: number }) => {
			const board = service.move(agent.id, path, at);
			agent.acted?.("move", board.path);
			return board;
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
		 * Which canvas you work on is `stage.canvas(name)`, not a field here: it is a fact about
		 * the deck's boards rather than about you.
		 */
		me: async (patch?: { name?: string; avatar?: { emoji: string } | { svg: string }; tags?: string[] }) => {
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
			return agent.identity();
		},

		/**
		 * Hand work to somebody else, and carry on.
		 *
		 * One verb for the three that were: a **name or id** sends to an agent that exists; a
		 * **shape** — `{ name, kind }` — makes the agent and sends to it; and the word
		 * `"dispatcher"` makes a dashboard task, which the deck places for you. It always
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
			 * canvas unless it says otherwise, and the work goes into its queue. This is what
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
			if (!to) throw new Error('Say who: a name or id from stage.agents(), { name } to make one, or "dispatcher" to let the deck place it.');
			/*
			 * The dispatcher is not an agent you queue work into — it is the rule that decides
			 * who should have it — so this word makes a dashboard task instead. It is the one
			 * name `send` reads rather than resolves, which is what `task` used to be.
			 */
			if (to.toLowerCase() === "dispatcher") {
				if (!agent.task) throw new Error("This deck has no dashboard.");
				return agent.task({ text: spec.task.trim(), ...(spec.boards ? { boards: spec.boards } : {}) });
			}
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
		 * Make a schedule: a task the deck makes on its own, at a time, on the days named.
		 *
		 * The dashboard's Cron tab is the list of these. The server checks the fields — a
		 * time is "HH:MM", days are 0 (Sunday) to 6, a job needs its text — and answers
		 * with the schedule made, or a sentence saying what was wrong with it.
		 */
		schedule: async (spec: ScheduleSpec) => {
			if (!spec?.name?.trim()) throw new Error("A schedule needs a name");
			if (!spec.at || !Array.isArray(spec.days)) throw new Error("A schedule needs a time (HH:MM) and its days (0 Sunday to 6 Saturday)");
			if (!spec.workspace?.trim()) throw new Error("A schedule needs a workspace to write into");
			if (!spec.task?.trim()) throw new Error("A schedule needs `task`: the work, as an instruction to the agent that will run it");
			if (spec.timezone !== undefined && !isZone(spec.timezone)) throw new Error(`"${String(spec.timezone)}" is not a timezone. Use an IANA name, like "America/Los_Angeles", or leave it out for the person's own`);
			if (!agent.schedule) throw new Error("This deck has no dashboard.");
			const made = agent.schedule({
				name: spec.name.trim(),
				at: spec.at.trim(),
				days: spec.days,
				...(spec.timezone ? { timezone: spec.timezone } : {}),
				workspace: spec.workspace.trim(),
				task: spec.task.trim(),
				...(spec.boards ? { boards: spec.boards } : {}),
			});
			if ("error" in made) throw new Error(made.error);
			return made;
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
			/** Make (or find) the status board, attach it and put it on the canvas. */
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
		 * The goal-driven browser agent (jev-ultrafast), beside the shared Chrome.
		 *
		 * `web` is the person's own tab, driven one verb at a time and watched by them.
		 * `web_jev` is a whole goal run by an agent: one URL, one goal, and the agent decides its
		 * own clicks until the goal is done or blocked. Left alone it drives the tab the person
		 * shared, because that is the browser the logins are in — and two gates stop it there, so
		 * nothing is sent without an answer and the words typed into a field are yours, not its.
		 * `{ browser: "headless" }` is a Chromium of the server's own instead, for pages nobody is
		 * logged into. A run outlives a stage call, so `run` returns at once, `state` is how the
		 * run is followed, and `answer` is how a held one carries on — on the next turn, never in
		 * a loop inside this one.
		 */
		web_jev: {
			/** Whether a run can start, whether a Chrome is shared, and what the run going now is doing. */
			status: async () => needJev().status(),
			/** Start one run. One at a time; the answer says how to follow it. */
			run: async (spec?: { url?: string; goal?: string; browser?: string }) =>
				needJev().run({
					url: String(spec?.url ?? ""),
					goal: String(spec?.goal ?? ""),
					...(spec?.browser === "headless" || spec?.browser === "chrome" ? { browser: spec.browser } : {}),
				}),
			/** The run going now, or the last one: every step the agent took, and every gate it met. */
			state: async () => needJev().state(),
			/**
			 * Answer what a gate is holding. `{ allow: true }` lets a press that would send something
			 * through; `{ text: "…" }` is what actually gets typed, because the browser agent's own
			 * words never reach a field. `state()` says which of the two is being asked.
			 */
			answer: async (input?: { allow?: boolean; text?: string }) => needJev().answer({ ...(typeof input?.allow === "boolean" ? { allow: input.allow } : {}), ...(typeof input?.text === "string" ? { text: input.text } : {}) }),
			/** End the run; the browser it drove closes with it. */
			stop: async () => needJev().stop(),
		},

		/**
		 * Every agent, or the ones a filter names: `filter.workspace` is the project each agent
		 * declares (the same field it shows), `filter.canvas` the agents who have worked in that room.
		 */
		agents: async (options?: { filter?: { workspace?: string; canvas?: string } }) => {
			const filter = options?.filter;
			const room = filter?.canvas === undefined ? undefined : findCanvas(filter.canvas);
			const workspace = filter?.workspace === undefined ? undefined : askedWorkspace(filter.workspace);
			return agent
				.agents()
				.filter((other) => (room ? room.agents.includes(other.id) : true))
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

		/*
		 * The canvas verbs. Each answers with the canvas as it now is, so an agent that drew an
		 * arrow can see it, and each refuses in a sentence when there is nothing to draw on — a
		 * board running its own code has no canvas of its own.
		 */
		/**
		 * The canvas you work on, read-only. Moving is `useCanvas` and making one is `newCanvas`;
		 * a name handed here is refused with both, because it used to mean "move, and make it
		 * if it is not there" and a resumed transcript will still call it that way.
		 */
		canvas: async (name?: unknown) => {
			if (name !== undefined) throw new Error(`stage.canvas() only reads where you are. Move with stage.useCanvas(${JSON.stringify(name)}); make a canvas with stage.newCanvas(${JSON.stringify(name)}, { workspace }).`);
			return canvasHooks().current();
		},
		/**
		 * Move to a canvas that exists, by name or id.
		 *
		 * Moving takes nothing with you — what you have read is yours and stays; what you show
		 * from then on goes there, and pressing you in the app takes the person there. A name
		 * nobody has is refused rather than made: making a room is `newCanvas`, and a typo that
		 * quietly made one was a new room nobody would find.
		 */
		useCanvas: async (name: string) => {
			if (typeof name !== "string" || !name.trim()) throw new Error('stage.useCanvas("Political LLM") moves you to a canvas; stage.canvas() says which one you are on.');
			const found = findCanvas(name);
			return must(canvasHooks().use(found.name, found.workspace), "That canvas could not be joined.");
		},
		/**
		 * Make a canvas for a new topic, and move to it.
		 *
		 * In your own workspace, or in `workspace` when one is named. A name is used once per
		 * deck, so a name that is taken is refused with the call that joins it instead.
		 */
		newCanvas: async (name: string, options?: { workspace?: string }) => {
			if (typeof name !== "string" || !name.trim()) throw new Error('stage.newCanvas("Bench surfaces") makes a canvas and moves you to it.');
			const workspace = options?.workspace === undefined ? undefined : askedWorkspace(options.workspace);
			const taken = canvasHooks().list().find((canvas) => slugName(canvas.name) === slugName(name));
			if (taken) {
				throw new Error(
					`A canvas named "${taken.name}" already exists, in ${taken.workspace ? `the workspace ${taken.workspace}` : "no workspace"}, and a name is used once per deck. Move to it with stage.useCanvas("${taken.name}"), or pick another name.`,
				);
			}
			return must(canvasHooks().use(name.trim(), workspace || undefined), "That canvas could not be made.");
		},
		/** Every canvas, with who is working on each, or the ones in `filter.workspace`. */
		canvases: async (options?: { filter?: { workspace?: string } }) => {
			const filter = options?.filter;
			const workspace = filter?.workspace === undefined ? undefined : askedWorkspace(filter.workspace);
			const all = canvasHooks().list();
			return workspace === undefined ? all : all.filter((canvas) => (canvas.workspace ?? "") === workspace);
		},
		/**
		 * An arrow from one board to another on your canvas: this led to that.
		 *
		 * A label of `null` takes the arrow away, which is why there is no `unlink`: removing a
		 * line is the same act with nothing to write on it.
		 */
		link: async (from: string, to: string, label?: string | null) => {
			const [a, b] = [boardPath(from), boardPath(to)];
			if (a === b) throw new Error("An arrow needs two different boards.");
			if (label === null) return changed(canvasHooks().unlink(a, b), "There was no arrow between those two.");
			return must(canvasHooks().link(a, b, typeof label === "string" ? label.slice(0, 60) : undefined), "The arrow was already there.");
		},
		/**
		 * A dashed border round two or more boards: one piece of work.
		 *
		 * An empty list takes the group away, on the same argument as `link(a, b, null)`: the
		 * group with nothing in it is no group.
		 */
		group: async (paths: string[], options: { name: string }) => {
			if (typeof options?.name !== "string" || !options.name.trim()) throw new Error("A group needs a name, which is what is written on its border.");
			const name = options.name.trim();
			if (Array.isArray(paths) && paths.length === 0) return changed(canvasHooks().ungroup(name), `There is no group called ${name}.`);
			if (!Array.isArray(paths) || paths.length < 2) throw new Error("A group is two or more boards: stage.group([a, b], { name }), or [] to take one away.");
			return must(canvasHooks().group(paths.map(boardPath), name), "That group could not be drawn.");
		},
	};

	/** The canvas hooks, or a sentence saying there are none. */
	function canvasHooks(): NonNullable<StageAgentHooks["canvas"]> {
		if (!agent.canvas) throw new Error("There is no canvas here to draw on.");
		return agent.canvas;
	}

	/** A board this deck has, by the path an agent uses; a sentence when it is not one. */
	function boardPath(path: string): string {
		const wanted = typeof path === "string" ? path.replace(/^\.?\//, "") : "";
		if (!here().some((board) => board.path === wanted)) {
			throw new Error(`No such board: ${String(path)}. Use the path from stage.boards(), like "boards/plan.html".`);
		}
		return wanted;
	}

	/** For a removal: nothing to remove is worth saying, where drawing the same arrow twice is not. */
	function changed(canvas: Canvas | undefined, otherwise: string): Canvas {
		if (!canvas) throw new Error(otherwise);
		return canvas;
	}

	function must(canvas: Canvas | undefined, otherwise: string): Canvas {
		const now = canvas ?? canvasHooks().current();
		if (!now) throw new Error(otherwise);
		return now;
	}

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
		setWorkspace: async () => { throw new Error('stage.me.setWorkspace(name) is now stage.canvas(name): the canvas is what holds the boards.'); },
	});

	return {
		name: STAGE_TOOL_NAME,
		label: "Stage",
		description: toolDescription(),
		promptSnippet: "Run TypeScript against the canvas: show boards, hold them in context, name yourself",
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

function escapeXml(text: string): string {
	return text.replace(/[<>&"']/g, (character) => `&#${character.charCodeAt(0)};`);
}
