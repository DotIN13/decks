import { isoIn, isZone, nowWords, offsetLabel, partsIn, processZone } from "../clock.ts";
import { existsSync, readFileSync } from "node:fs";
import type { AgentKind, AgentMode, AgentState, Camera, Identity, Schedule, ScheduleSpec, TaskResult, TaskSpec, ThinkingLevel } from "@decks/protocol";
import { guidelinesFile, toolDescription as toolDescriptionPath } from "@decks/runtime";
import type { Stage } from "../../../../runtime/stage.d.ts";
import { roster } from "../agents/workspaces.ts";
import { BOARD_FORMATS, boardWidth, isBoardFormat } from "../boards/templates.ts";
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
export interface DelegateSpec {
	name?: string;
	task: string;
	/** Boards handed over: the child is given their source, not a description. */
	boards?: string[];
	/** "provider/model", if the child should run on something other than the default. */
	model?: string;
	/**
	 * The runtime the child is: fixed at creation, exactly as the `+` button fixes it.
	 *
	 * Omit it and the child gets the server's default. It is the one field that can never
	 * change afterwards, so asking for it here is the only way to get it.
	 */
	kind?: AgentKind;
	/**
	 * The thinking level, on its own scale from the model — the same reason the composer
	 * draws it as a separate control below the model list.
	 */
	thinking?: ThinkingLevel;
	/**
	 * How much the child asks before acting, from its runtime's own set.
	 *
	 * The runtimes do not all offer all four — pi has none at all, antigravity two — and
	 * asking for one a runtime does not have is not an error: the child does the work on
	 * its default mode and the parent is told it did not get what it asked for.
	 */
	mode?: AgentMode;
}

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

export interface DelegateReport {
	agent: string;
	name: string;
	report: string;
	/** Boards the child created or changed. */
	boards: string[];
}

export interface StageAgentHooks {
	id: string;
	identity(): Identity;
	context(): string[];
	setContext(paths: string[]): void;
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
	agents(): Array<{ id: string; name: string; state: AgentState; context: string[]; holding: number; kind: AgentKind; tags: string[]; workspace?: string; queued?: number }>;
	/** Where the browser last said it was looking. */
	camera(): Camera;
	/** Hand work to a new agent and wait for it. */
	spawn(spec: DelegateSpec): Promise<DelegateReport>;
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

	const stage: Stage = {
		// --- reads ---------------------------------------------------------------
		boards: async () => service.boards(),
		read: async (path: string) => service.read(path),
		roots: async () => service.roots(),
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
			 * `flow` is the default: an ordinary page the agent designs, on the theme tokens
			 * alone, whose height is measured. It was `component` until boards were tried in
			 * variants against a clean deck: the positioned vocabulary cost an agent twice the
			 * tool calls and money for the same one-screen board, and read no better. `component`
			 * is still written when asked for, and is what a person's double-click creates;
			 * `slides` is a reveal deck. The extension is derived from this and never named —
			 * see `boards/templates.ts`.
			 */
			const format = options.format ?? "flow";
			if (!isBoardFormat(format)) throw new Error(`Unknown format ${format}; use one of ${BOARD_FORMATS.join(", ")}`);
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
			agent.setContext([path, ...agent.context()]);
			agent.setInPlay([...agent.inPlay(), path]);
			agent.worked?.(path);
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
		 * A mirror: a live view of a conversation, on the canvas.
		 *
		 * The board it writes never changes — its turns arrive in the browser, from a
		 * transcript the app is already holding for every agent. So mirroring somebody
		 * you are not talking to costs a `postMessage`, which is the point of it: three
		 * mirrors side by side is what everyone is doing, without opening three chats.
		 *
		 * Attached and put on the canvas, camera unmoved, exactly as `newBoard` is. Asking
		 * twice for the same agent hands back the board you already have.
		 */
		mirror: async (options?: { of?: string; w?: number; h?: number }) => {
			const wanted = options?.of?.trim();
			const others = agent.agents();
			const found = wanted
				? (others.find((other) => other.id === wanted) ??
					others.find((other) => other.name.toLowerCase() === wanted.toLowerCase()))
				: others.find((other) => other.id === agent.id);
			if (!found) {
				throw new Error(
					wanted
						? `No agent called ${wanted}. Use an id or a name from stage.agents().`
						: "This conversation is not in the agent list yet, so there is nothing to mirror.",
				);
			}
			const path = service.mirror({
				agentId: found.id,
				name: found.name,
				size: { ...(options?.w ? { w: options.w } : {}), ...(options?.h ? { h: options.h } : {}) },
			});
			agent.setContext([path, ...agent.context().filter((held) => held !== path)]);
			agent.setInPlay([...agent.inPlay().filter((shown) => shown !== path), path]);
			return { path, of: found.name, agent: found.id };
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
				if (!service.boards().some((board) => board.path === one)) throw new Error(`No such board: ${one}`);
			}
			for (const one of paths) agent.worked?.(one);
			return { reported: paths };
		},

		// --- context -------------------------------------------------------------
		attach: async (path: string | string[]) => {
			const wanted = asList(path);
			for (const one of wanted) {
				if (!service.boards().some((board) => board.path === one)) throw new Error(`No such board: ${one}`);
			}
			// Most-recently-touched first: the boards just attached lead the list — the last one
			// named is the most recent — and boards already held that are not re-attached keep
			// their existing recency behind them. Re-attaching a board is a fresh touch, which is
			// why it leaves its old place and joins the front. `setContext` stores the order,
			// and the rail, the canvas and `stage.agents()` all read the same list.
			const retained = agent.context().filter((held) => !wanted.includes(held));
			const next = [...wanted].reverse().concat(retained);
			agent.setContext(next);
			// A board taken up is a board put on the canvas: attaching something the user
			// then cannot see would make the rail the only evidence it happened.
			agent.setInPlay([...agent.inPlay(), ...wanted]);
			return service.boards().filter((board) => next.includes(board.path));
		},
		detach: async (path: string | string[]) => {
			const dropping = new Set(asList(path));
			const next = agent.context().filter((held) => !dropping.has(held));
			agent.setContext(next);
			return service.boards().filter((board) => next.includes(board.path));
		},
		context: async () => {
			const held = agent.context();
			return service.boards().filter((board) => held.includes(board.path));
		},
		inPlay: async () => {
			const playing = agent.inPlay();
			return service.boards().filter((board) => playing.includes(board.path));
		},

		// --- the canvas ------------------------------------------------------------
		/**
		 * Put these boards on the canvas, and nothing else.
		 *
		 * `show` is the narrowing gesture: the canvas becomes exactly what is named, the
		 * camera fits it, and anything not already held is attached — showing a board is
		 * working on it, and requiring a separate attach would be a step to forget.
		 * `show(await stage.context())` puts everything back.
		 *
		 * `animate: true` makes the camera **arrive** rather than jump — 420ms, easing out. It is off
		 * by default: an op states where to look, and something watching the camera a frame later
		 * should see what was asked for. The board's own links and the panel glide without being
		 * asked, because those are a person's hands.
		 */
		show: async (path: string | string[], options?: { fit?: "board" | "all"; highlight?: string; animate?: boolean }) => {
			const paths = asList(path);
			for (const one of paths) {
				if (!service.boards().some((board) => board.path === one)) throw new Error(`No such board: ${one}`);
			}
			agent.setInPlay(paths);
			// One board named is the focusing gesture: "look at what I made". Several is arranging
			// the canvas — `show(context)` puts everything back — and is nobody's byline.
			const [only] = paths;
			if (only !== undefined && paths.length === 1) agent.worked?.(only);
			return service.show(agent.id, paths, options ?? {});
		},
		/** Take boards off the canvas, keeping them in context. */
		hide: async (path: string | string[]) => {
			const dropping = new Set(asList(path));
			agent.setInPlay(agent.inPlay().filter((playing) => !dropping.has(playing)));
		},
		move: async (path: string, at: { x: number; y: number }) => service.move(agent.id, path, at),
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
		toast: async (text: string) => service.toast(agent.id, text),

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

		me: {
			setName: async (name: string) => {
				const clean = name.trim().slice(0, 40);
				if (!clean) throw new Error("A name cannot be empty");
				agent.rename(clean);
			},
			/**
			 * What this agent is doing, in its own words. Replaces the list.
			 *
			 * Returns the tags **as stored**, which is not always what was passed: they are
			 * slugged, deduped and capped at four, so `["Reading panel.css and measuring"]`
			 * comes back as `["reading-panel-css-and"]`. Returning them is the only way a model
			 * finds that out, and the alternative — silently storing something different from
			 * what it thinks it set — is how an agent ends up re-setting the same tags forever.
			 */
			setTags: async (tags: string[]) => agent.setTags(tags),
			/**
			 * The workspace this agent is in. Replaces — one value, not a list.
			 *
			 * Returns it **as stored**: slugged, lowercased and cut at 24 characters, so
			 * `stage.me.setWorkspace("Political LLM (round 20)")` comes back as `political-llm`.
			 * Returning it is the only way a model finds that out, and it is also how two agents
			 * that named "the same" project differently end up in one group rather than two.
			 * `null` or an empty string leaves the workspace.
			 */
			setWorkspace: async (workspace: string | null) => agent.setWorkspace(workspace),
			setAvatar: async (avatar: { emoji: string } | { svg: string }) => {
				if ("emoji" in avatar) {
					// An emoji becomes a data URL rather than a special case in the
					// browser: one code path for "the agent has a picture".
					const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="44" font-size="44" text-anchor="middle">${escapeXml(avatar.emoji.slice(0, 4))}</text></svg>`;
					agent.setAvatar(service.writeAvatar(agent.id, svg));
					return;
				}
				if (!/^\s*<svg[\s>]/i.test(avatar.svg)) throw new Error("An SVG avatar must start with <svg>");
				agent.setAvatar(service.writeAvatar(agent.id, avatar.svg));
			},
			get: async () => agent.identity(),
		},

		/**
		 * Hand work to a subagent, with the boards it needs (§6.2).
		 *
		 * The child gets the *source* of each board rather than a summary, and the
		 * instruction that those boards are the plan of record. That is the whole
		 * point of boards being files: alignment is a paste, not a briefing.
		 */
		delegate: async (spec: DelegateSpec) => {
			if (!spec?.task?.trim()) throw new Error("A delegated task needs a description");
			return agent.spawn({
				...spec,
				// The parent's own context is the default handover: if it did not say
				// which boards, it means the ones it is working on.
				boards: spec.boards ?? agent.context(),
			});
		},

		/**
		 * Hand work to an agent that already exists, and carry on.
		 *
		 * The difference from `delegate` is the whole point: `delegate` makes a new agent and
		 * blocks until it reports, which is right when the work is a step in what you are
		 * doing. `send` puts an item in somebody else's queue and returns — right when the
		 * work is *theirs*, when they are the one holding that part of the deck, or when you
		 * have nothing to do with the answer.
		 *
		 * The receiver runs it once it has been quiet for a while, so it never interrupts a
		 * turn in progress, and it is handed the board *source* when it runs — not when you
		 * sent it, so a board that changes in between is read as it is.
		 */
		send: async (target: string, spec: SendSpec) => {
			if (!target?.trim()) throw new Error("Say which agent: an id or a name from stage.agents()");
			if (!spec?.task?.trim()) throw new Error("Sent work needs a description");
			return agent.send(target.trim(), {
				task: spec.task,
				...(spec.boards ? { boards: spec.boards } : {}),
				...(spec.reply ? { reply: true } : {}),
			});
		},
		/**
		 * Make an agent and return at once, so the next line can `send` to it.
		 *
		 * For work nobody on the deck covers: a dispatcher that finds no agent on the topic
		 * makes one here rather than blocking on a `delegate`, and hands the work over the
		 * way it would to anyone else.
		 */
		create: async (spec: CreateSpec) => {
			if (!spec?.name?.trim()) throw new Error("A new agent needs a name");
			if (!agent.create) throw new Error("This deck cannot make agents.");
			return agent.create({ ...spec, name: spec.name.trim() });
		},
		/** What is waiting for an agent: yours, or another's if you name it. */
		queue: async (agentId?: string) => agent.queue(agentId),

		/**
		 * Make a dashboard task and let the deck decide who takes it.
		 *
		 * The counterpart to `send` for work that has no obvious owner: instead of
		 * naming an agent, the text is handed to the dashboard's dispatcher rule, which
		 * picks by workspace, then by who is idle and least loaded, and puts it in that
		 * agent's queue. What the caller gets back says where it went and why — or that
		 * nobody could take it, which is a blocked task a person can retry on the panel.
		 */
		task: async (spec: TaskSpec) => {
			if (!spec?.text?.trim()) throw new Error("A task needs a description");
			if (!agent.task) throw new Error("This deck has no dashboard.");
			return agent.task({
				text: spec.text.trim(),
				...(spec.workspace ? { workspace: spec.workspace } : {}),
				...(spec.boards ? { boards: spec.boards } : {}),
				...(spec.agentId ? { agentId: spec.agentId } : {}),
			});
		},

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
				agent.setContext([path, ...agent.context().filter((held) => held !== path)]);
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

		agents: async () =>
			agent.agents().map((other) => ({
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
			})),

		/**
		 * The workspaces in use, biggest first — who is on which project, and what they hold.
		 *
		 * The field on `agents()` answers "which workspace is this one in"; this answers "which
		 * workspaces are there", which is the question an agent has before it joins one, and
		 * cannot be got by grouping the agents yourself if you do not already know the names.
		 *
		 * `boards` is the union of the members' held boards, **the ones most of them hold first** —
		 * so a new agent joining a project finds what the project is working from in one call, and
		 * the first entry is what everybody there has open. See `agents/workspaces.ts`: it is one
		 * pure function over the summaries this agent can already ask for.
		 */
		workspaces: async () =>
			roster(
				agent.agents().map((other) => ({
					id: other.id,
					name: other.name,
					state: other.state,
					tags: other.tags,
					workspace: other.workspace,
					context: other.context,
				})),
			),
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
		name: STAGE_TOOL_NAME,
		label: "Stage",
		description: toolDescription(),
		promptSnippet: "Run TypeScript against the canvas: show boards, hold them in context, name yourself",
		guidelines: GUIDELINES,
		parameterDescription: "TypeScript, run as an async function body with `stage` in scope. Return a value to see it.",
		stage,
		snapshot,

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
