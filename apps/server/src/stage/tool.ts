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
import { imageKind, imageSize, type ShotFormat, type ShotOf } from "./shots.ts";

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
	call(name: string, args: readonly unknown[]): Promise<StageCallResult>;
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
	/** Pictures produced during one call, which go back beside its value (`StageCallResult.images`). */
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
			notes.push(`No at was given, so ${path} went beside your newest board, at ${corner}. Say where each board goes with at: { x1, y1 }: decks pen read lists what is on your stage and where.`);
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
		// `null`, not nothing, when no browser has reported one: the answer travels as JSON.
		viewport: async () => viewport() ?? null,

		/**
		 * Start a board: the shell, written for you, so you write only the content.
		 *
		 * Attaches it and puts it on the canvas — without moving the camera, which stays
		 * where the user left it until `show` is called. Returns the deck-relative path to
		 * edit.
		 */
		newBoard: async (options: { title: string; template?: string; kind?: string; format?: string; w?: number; h?: number; at?: { x1: number; y1: number } | { x: number; y: number } }) => {
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
			agent.sized?.(board.path, { w: board.w, h: board.h });
			agent.acted?.("resize", board.path);
			return { path: board.path, w: board.w, h: board.h };
		},

		/**
		 * Size a board to its content on one canvas: the height, at the width the board has there.
		 *
		 * The canvas is named as `pen.read` names one (its name, its title, or `canvases/<name>/canvas.pen`),
		 * or is the one this agent's stage is showing. The width is never measured: it is the canvas's,
		 * and the height is measured at it. Both go to the board's file, as a person's resize writes
		 * them, and to that canvas; every other canvas keeps the size it has for the board.
		 */
		fit: async (path: string, options?: { margin?: number; canvas?: string }) => {
			const pens = service.pens;
			const asked = typeof options?.canvas === "string" ? options.canvas.trim().replace(/^canvases\//, "").replace(/\/canvas(\.pen)?$/, "") : undefined;
			const named = asked && pens ? (pens.names().includes(asked) ? asked : pens.names().find((one) => pens.titleOf(one).toLowerCase() === asked.toLowerCase())) : undefined;
			if (asked && !named) throw new Error(`No canvas is called "${options?.canvas}". decks stages lists them, by name and title.`);
			const on = named ?? agent.stageName?.();
			const held = on && pens ? pens.boards(on).find((one) => one.path === path) : undefined;
			if (!on || !held) throw new Error(`${path} is not on ${named ? `the canvas "${pens!.titleOf(named)}"` : "your stage's canvas"}, so there is no width to fit it at. Show it there first, or name a canvas that holds it: decks fit <path> --canvas <name>.`);
			const { board, content, reading, views } = await service.fit(path, { ...(options?.margin === undefined ? {} : { margin: options.margin }), w: held.w });
			if (named) pens!.sizeBoard(named, board.path, { w: board.w, h: board.h });
			else agent.sized?.(board.path, { w: board.w, h: board.h });
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
			/*
			 * An avatar is checked and repaired where it is written (`stage/avatar.ts`), and what it
			 * had to repair comes back here. An agent whose drawing was changed is told so in the
			 * result: it is the only way a model finds out, and one that is never told draws the
			 * same broken shape next time — which is exactly how an avatar with no `xmlns` went
			 * unnoticed, rendering as nothing while every call answered as though it had worked.
			 */
			let avatarChanged: string | undefined;
			if (patch?.avatar !== undefined) {
				const avatar = patch.avatar;
				if ("emoji" in avatar) {
					// An emoji becomes a data URL rather than a special case in the browser: one
					// code path for "the agent has a picture".
					const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="44" font-size="44" text-anchor="middle">${escapeXml(String(avatar.emoji).slice(0, 4))}</text></svg>`;
					agent.setAvatar(service.writeAvatar(agent.id, svg).url);
				} else {
					const written = service.writeAvatar(agent.id, avatar.svg);
					agent.setAvatar(written.url);
					avatarChanged = written.changed;
				}
			}
			if (patch?.tags !== undefined) agent.setTags(patch.tags);
			if (patch?.workspace !== undefined) agent.setWorkspace(patch.workspace);
			return avatarChanged === undefined ? agent.identity() : { ...agent.identity(), avatarChanged };
		},

		/**
		 * The ports forwarded through Decks, so a board can frame a server this machine runs
		 * (`ports.ts`): read with nothing, `{ open: port, label }` to forward one, `{ close: port }`
		 * to stop. Each comes back with its two addresses, as Open OnDemand names them: `node` keeps
		 * the path (for a server given that base path), `rnode` takes it off (for one at the root).
		 *
		 * An agent's verb, not a board's: a board's own code may read the list but not change it, and
		 * an isolated agent may do neither, since a forwarded port reaches outside its stage.
		 */
		ports: async (change?: { open?: number; close?: number; label?: string }) => {
			if (isolated()) notWhileIsolated("port forwarding");
			const forwards = service.forwards;
			if (!forwards) throw new Error("This server forwards no ports.");
			if (change && (change.open !== undefined || change.close !== undefined)) {
				if (agent.board) throw new Error("A board's own code cannot open or close ports; ask an agent.");
				if (change.open !== undefined) forwards.open(change.open, { ...(change.label ? { label: change.label } : {}), by: agent.identity().name });
				if (change.close !== undefined && !forwards.close(change.close)) throw new Error(`Port ${change.close} was not forwarded.`);
			}
			return forwards.all().map((one) => ({ ...one, node: `/node/localhost/${one.port}/`, rnode: `/rnode/localhost/${one.port}/` }));
		},

		/**
		 * Apps in the deck's `apps/` (`apps/service.ts`): an app is a folder the agent writes with its
		 * own tools, and these are what Decks does with it. Each answers at once or within fifteen
		 * seconds: an install can take minutes, and a stage run is abandoned after twenty, so a
		 * `pending` answer means ask `status` again on the next call.
		 *
		 * Agents' verbs: a board's own code may read the list and an app's state, nothing more, and an
		 * isolated agent may not use them, since an app's server reaches outside its stage.
		 */
		apps: (() => {
			const service_ = () => {
				const apps = service.apps;
				if (!apps) throw new Error("This server runs no apps.");
				return apps;
			};
			const agentOnly = (what: string) => {
				if (isolated()) notWhileIsolated(`apps (${what})`);
				if (agent.board) throw new Error(`A board's own code cannot ${what} an app; ask an agent.`);
			};
			const known = (name: unknown) => {
				const apps = service_();
				const text = String(name ?? "").trim();
				if (!apps.exists(text)) throw new Error(`There is no app called ${JSON.stringify(text)}. decks apps list names them; decks apps create <name> --starter … makes one.`);
				return text;
			};
			return {
				list: async () => service_().list(),
				status: async (name: string) => service_().state(known(name)),
				/**
				 * A new app from a starter, and the board that shows it. `static` is files served as they
				 * are; `node` a server with no packages; `solid` and `react` built with Vite; `next` a
				 * Next.js server. Take the lowest that does the job.
				 */
				create: async (name: string, options?: { starter?: string; title?: string }) => {
					agentOnly("make");
					const apps = service_();
					const text = String(name ?? "").trim();
					const folder = apps.folder(text);
					if (apps.exists(text)) throw new Error(`apps/${text} already exists; edit its files, or pick another name.`);
					const starter = (options?.starter ?? "static") as Starter;
					if (!STARTERS.includes(starter)) throw new Error(`Unknown starter ${JSON.stringify(options?.starter)}; one of ${STARTERS.join(", ")}.`);
					const title = options?.title?.trim() || text;
					const files = writeStarter(folder, starter, title);
					const board = service.appBoard(text, title);
					return {
						name: text,
						kind: STARTER_KIND[starter],
						folder: `apps/${text}`,
						files,
						board,
						url: `/app/${text}/`,
						next: STARTER_KIND[starter] === "static" ? `Edit the files, then decks apps check ${text} and decks show ${board}.` : STARTER_KIND[starter] === "build" ? `Edit the files, decks apps build ${text}, then decks apps check ${text} and decks show ${board}.` : `Edit the files, decks apps run ${text}, then decks apps check ${text} and decks show ${board}.`,
					};
				},
				/** The board for an app whose folder was written by hand. */
				board: async (name: string) => {
					const text = known(name);
					return service.appBoard(text, service_().state(text).title);
				},
				build: async (name: string) => {
					agentOnly("build");
					return service_().build(known(name));
				},
				run: async (name: string) => {
					agentOnly("run");
					return service_().run(known(name));
				},
				stop: async (name: string) => {
					agentOnly("stop");
					return { stopped: service_().stop(known(name)) };
				},
				/** Stop and start a server app, after its code changed; a built app is built again. The board reloads when it is back. */
				restart: async (name: string) => {
					agentOnly("restart");
					const text = known(name);
					service_().stop(text);
					return service_().run(text);
				},
				logs: async (name: string, options?: { tail?: number }) => service_().log(known(name), options?.tail ?? 80),
				/** The app opened in the server's own browser: errors, failed requests and a picture, as `fit` is for a board. */
				check: async (name: string) => {
					agentOnly("check");
					const text = known(name);
					if (!service.appCheck) throw new Error("This server has no browser to check an app with.");
					const kind = service_().state(text).kind;
					if (kind !== "static") {
						const ready = kind === "server" ? await service_().run(text, 6_000) : service_().state(text).status === "running" ? undefined : await service_().build(text, 6_000);
						if (ready && !ready.ok) return { verdict: ready.pending ? `apps/${text} is still ${ready.status}; check again in a moment.` : `apps/${text} is ${ready.status}: ${ready.errors.at(-1) ?? `see decks apps logs ${text}`}`, ...ready };
					}
					return service.appCheck(text);
				},
			};
		})(),

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
				if (!name) throw new Error('A new agent needs a name: decks send \'{"name":"Rune"}\' --task …');
				const made = await agent.create({ ...target, name });
				return { ...agent.send(made.agent, work), agent: made.agent, name: made.name };
			}
			const to = String(target ?? "").trim();
			if (!to) throw new Error("Say who: a name or id from decks agents, or { name } to make one.");
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
			fill: async (field: WebTarget, text: string) => needWeb().fill(needTarget(field, "fill needs the field's label, or a { ref } from decks web read"), String(text ?? "")),
			select: async (field: WebTarget, option: string) => needWeb().select(needTarget(field, "select needs the field's label, or a { ref } from decks web read"), option),
			click: async (what: WebTarget) => needWeb().click(needTarget(what, "click needs the button's or link's name, or a { ref } from decks web read")),
			press: async (key: string) => needWeb().press(key),
			/**
			 * Press the named button, or Enter, once the user has allowed it on the status
			 * board. Pass `{ ask: false }` only when the user has said they do not want to be
			 * asked for this site.
			 */
			submit: async (what?: WebTarget, options?: { ask?: boolean }) =>
				needWeb().submit(what === undefined ? undefined : needTarget(what, "submit needs the button's name, or a { ref } from decks web read"), options),
			/** Detach from the shared tab. */
			stop: async () => needWeb().stop(),
		},

		/**
		 * The stage's drawing: a native pen.dev document at `stages/<name>/stage.pen`.
		 *
		 * Notes, text, shapes, arrows and frames live here, all drawn over the boards by the canvas.
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
				title: pens.titleOf(name),
				open: everyone.filter((other) => (other.id === agent.id ? mine : other.stage) === name).map((other) => other.name),
				boards: pens.boards(name).length,
				...(name === mine ? { mine: true } : {}),
			}));
		},
		/** Work on another stage: its boards are yours from now on, and the person sees it when talking to you. */
		open: async (name: string) => {
			if (typeof name !== "string" || !name.trim()) throw new Error('open names a stage, as in decks open deploy; decks stages lists them.');
			if (!agent.openStage) throw new Error("This agent cannot change stages.");
			// By its folder, or by what it is called: the person reads names, and an agent is told them.
			const pens = service.pens;
			const asked = name.trim();
			const folder = pens && !pens.names().includes(asked) ? (pens.names().find((one) => pens.titleOf(one).toLowerCase() === asked.toLowerCase()) ?? asked) : asked;
			agent.openStage(folder);
			return { stage: folder, boards: agent.inPlay() };
		},
		/**
		 * Name the canvas you are on, or read its name. The name is what the person reads; the folder
		 * (`name` in `stages()`) stays as it is. Saying the same name again keeps it and marks what the
		 * canvas holds now as what the name is for (`stage/canvas-name.ts`).
		 */
		title: async (title?: string) => {
			const pens = needPens();
			const name = needStage();
			if (title !== undefined) {
				if (typeof title !== "string" || !title.trim()) throw new Error('title takes the canvas\'s new name, as in decks title "Launch plan"; decks title reads it.');
				const folder = service.retitle(name, title);
				service.stagesChanged?.();
				return { stage: folder, title: pens.titleOf(folder) };
			}
			return { stage: name, title: pens.titleOf(name) };
		},
		/** A new, empty stage named from a title, opened at once. */
		newStage: async (title: string) => {
			if (typeof title !== "string" || !title.trim()) throw new Error('newStage takes a title, as in decks new-stage "Launch plan".');
			if (!agent.newStage) throw new Error("This agent cannot make stages.");
			return { stage: agent.newStage(title.trim()) };
		},

		/**
		 * A picture of your stage, or of part of it, as the person sees it: the drawing and the live
		 * boards together. Attached to this call's result so you see it at once, and saved to `file`.
		 * `of` is an item's id, a board's path, a list of them, or a box; nothing is the whole stage.
		 * `to` saves it where you say instead, and `format: "pdf"` or `"jpeg"` for other kinds. It is
		 * drawn natively over the boards' pictures when it can be, and in the browser otherwise or with
		 * `live: true` (the boards as live pages); `how` says which, and why.
		 */
		screenshot: async (options?: { of?: ShotOf; scale?: number; format?: ShotFormat; to?: string; scheme?: "light" | "dark"; live?: boolean }) => {
			if (!service.shots) throw new Error("This server cannot take pictures of a stage.");
			const { of, scale, format, to, scheme, live } = options ?? {};
			/*
			 * One board, by its path: as the person's browser has it now, so the picture shows what
			 * they did on the page — drawn there by HTML-in-Canvas when it can be, from a snapshot of
			 * the page otherwise. With no live page to draw, the server's picture from the file, and
			 * the answer says it does not show their interaction.
			 */
			if (typeof of === "string" && format !== "pdf" && here().some((board) => board.path === of)) {
				const seen = await service.seenBoard(agent.id, of);
				let bytes: Buffer;
				let mime: string;
				let note: string;
				if (seen.how !== "none") {
					bytes = seen.bytes;
					mime = seen.mime;
					note = seen.how === "canvas" ? "As the person's browser shows it now, drawn there by HTML-in-Canvas: it includes what they did on the page." : "As the person's browser has it now, from a snapshot of the page: it includes what they did on the page, such as tabs pressed, text typed and boxes scrolled.";
				} else {
					if (!service.boardPicture) throw new Error("This server cannot take pictures of a board.");
					bytes = await service.boardPicture(of, scheme === "dark" ? "dark" : "light");
					mime = imageKind(bytes)?.mime ?? "image/jpeg";
					note = `Taken by the server from the board's file, because ${seen.why}. It does not show anything the person did on the page (tabs pressed, text typed, boxes scrolled); ask them to open the board if that matters.`;
				}
				// What the bytes are, not what they were said to be: the snapshot and the board's whole picture are WebP.
				if ((format === "png" || format === "jpeg") && imageKind(bytes)?.format !== format) bytes = await service.shots.convert(bytes, format);
				const kind = imageKind(bytes);
				if (kind) mime = kind.mime;
				const size = imageSize(bytes);
				const file = service.shots.keepBoard(of, bytes, kind?.ext ?? (mime === "image/jpeg" ? "jpg" : "png"), to);
				images.push({ data: bytes.toString("base64"), mimeType: mime });
				const at = here().find((board) => board.path === of)!;
				note += " Only the board: the drawing around it (arrows, labels, notes touching it) is not in this picture; pass its box as `of` to see that too.";
				return { file, width: size.width, height: size.height, box: { x1: at.x, y1: at.y, x2: at.x + at.w, y2: at.y + at.h }, how: seen.how === "none" ? ("server" as const) : seen.how, note };
			}
			/*
			 * A .pen file, whole: a saved frame (`"frames/ui/button.pen"`), another stage's file, any .pen
			 * by path. Named by a path that ends in .pen, or by one that is not an item on this stage and is a file.
			 */
			const pens = service.pens;
			const penFileOf = (asked: unknown): string | undefined => {
				if (!pens || typeof asked !== "string" || !asked.includes("/")) return undefined;
				if (!asked.endsWith(".pen") && pens.placedOf(needStage()).has(asked)) return undefined;
				try {
					return existsSync(pens.penFile(asked).file) ? asked : undefined;
				} catch {
					return undefined;
				}
			};
			const file = penFileOf(of);
			const shot = await service.shots.take({ stage: needStage(), ...(file ? { file } : { of }), ...(scale !== undefined ? { scale } : {}), ...(format ? { format } : {}), ...(to ? { to } : {}), ...(scheme ? { scheme } : {}), ...(live ? { live: true } : {}) });
			if (shot.format !== "pdf") images.push({ data: shot.bytes.toString("base64"), mimeType: shot.format === "jpeg" ? "image/jpeg" : "image/png" });
			return { file: shot.file, width: shot.width, height: shot.height, box: shot.box, how: shot.how };
		},

		pen: {
			file: async () => canvasFile(needStage()),
			read: async (path?: string) => {
				// Any .pen file by its path (relative to frames/, or absolute in the deck); the stage's own without one.
				if (path !== undefined) return needPens().readFile(path);
				const { file: _file, ...view } = needPens().read(needStage());
				return { ...view, file: canvasFile(view.stage) };
			},
			edit: async (ops: readonly unknown[], options?: { path?: string }) => {
				const pens = needPens();
				if (options?.path !== undefined) return pens.editFile(options.path, ops as readonly Op[]);
				// Checked by `apply`, which answers a malformed edit with a sentence naming it.
				const boards = new Map(here().map((board) => [board.path, { x: board.x, y: board.y, w: board.w, h: board.h }]));
				const { entry, results } = pens.edit(needStage(), ops as readonly Op[], (path) => boards.get(path));
				const placed = placements(pens.withImported(needStage(), entry.doc), { theme: baseTheme(entry.doc, "light"), measure: serverText.measure });
				const answered = results.map((result) => {
					const box = result.op === "delete" ? undefined : boxOf(placed.get(result.id));
					return { ...result, ...(box ? { box } : {}) };
				});
				const touched = answered.filter((result) => result.box && !result.id.startsWith("board:"));
				if (touched.length > 0) agent.drew?.(needStage(), touched.map((result) => result.id), touched.map((result) => result.box!));
				return { rev: entry.rev, results: answered };
			},
			/** A new frame file in frames/, with `item` as its one reusable item, ready to be placed by the ref it answers. */
			create: async (path: string, item?: Record<string, unknown>) => needPens().createFile(path, item as never),
			/** Save an item as a frame file and, unless `replace` is false, put a ref to it in its place. */
			save: async (id: string, path: string, options?: { replace?: boolean }) => {
				if (typeof id !== "string" || !id) throw new Error("decks pen save <id> <path> needs the item's id, from decks pen read.");
				return needPens().saveFrame(needStage(), id, path, options?.replace !== false);
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

	return {
		guidelines: GUIDELINES,
		stage,
		snapshot,
		webShared: () => service.web?.status().paired === true,

		async call(name: string, args: readonly unknown[]): Promise<StageCallResult> {
			notes = [];
			images = [];
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
			// The same lines a run adds after its value, in the same order (see `run`).
			const said = [...notes];
			const unsaid = identityReminder(agent.identity());
			if (unsaid) said.push(unsaid);
			const unnamed = canvasNameReminder(service.pens, agent.stageName?.());
			if (unnamed) said.push(unnamed);
			deps.persist?.(snapshot());
			return { ...answer, notes: said, ...(images.length > 0 ? { images: [...images] } : {}) };
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
