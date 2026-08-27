/**
 * The stage API, available inside `stage_eval` as `stage`.
 *
 * This file is injected into your context verbatim, so it is the whole contract:
 * if something is not here, it does not exist. Your code runs as the body of an
 * async function, so you can `await` and `return` — whatever you return comes back
 * to you as JSON, and anything you `console.log` comes back with it.
 *
 *     await stage.show("boards/plan.html", { highlight: "risk" });
 *     const boards = await stage.boards();
 *     return boards.filter((b) => b.inContext.length === 0).map((b) => b.path);
 *
 * Board *content* is files: read and edit it with your ordinary tools. This is for the
 * things a file cannot express — what is on the canvas, what is in your context, and who
 * you are.
 *
 * Three tiers, and they are worth keeping straight:
 *
 * - the **deck** is every board file (`boards()`)
 * - your **context** is what you are holding (`attach` / `detach` / `context`) — the rail
 *   beside the canvas lists it, and the user can take a board off the canvas but cannot
 *   take one out of your context
 * - what is **in play** is the subset on the canvas (`show` / `hide` / `inPlay`)
 */

export interface Board {
	/** Deck-relative, e.g. "boards/plan.html". */
	path: string;
	title: string;
	/** Where it sits on the canvas. The user may have dragged it. */
	x: number;
	y: number;
	w: number;
	h: number;
	/** Ids of agents holding this board in context. */
	inContext: string[];
	/** Who wrote it last: an agent id, or "you" for the user. */
	lastWrittenBy?: string;
}

export interface Root {
	path: string;
	writable: boolean;
	exists: boolean;
}

export interface Camera {
	/** The world point under the centre of the user's viewport. */
	x: number;
	y: number;
	/** 1 is life size; 0.25 is zoomed out to four boards across. */
	zoom: number;
}

export interface Identity {
	name: string;
	avatar?: string;
	color: string;
}

export interface AgentSummary {
	id: string;
	name: string;
	/** Whether this is you. */
	me: boolean;
	state: "idle" | "thinking" | "streaming" | "tool" | "waiting";
	/** Boards this agent is holding. */
	context: string[];
}

export interface ShowOptions {
	/** "board" fits the one board (default); "all" fits everything named. */
	fit?: "board" | "all";
	/** A `data-id` on the board to outline, so the user's eye lands on it. */
	highlight?: string;
}

export interface Stage {
	// --- looking at the deck ------------------------------------------------------

	/** Every board in the deck, with where it sits and who is holding it. */
	boards(): Promise<Board[]>;

	/** A board's source, without spending a `read` turn on it. */
	read(path: string): Promise<string>;

	/** Directories outside the deck that embeds may reach (from deck.json). */
	roots(): Promise<Root[]>;

	/**
	 * A path you found on disk -> the URL a board should embed.
	 * Throws if the file is outside the deck and every declared root.
	 */
	resolve(file: string): Promise<string>;

	/** The URL to open in Playwright when you want to look at a board. */
	url(path: string): Promise<string>;

	// --- starting a board ----------------------------------------------------------

	/**
	 * Write the shell of a new board and return its path, ready to fill in.
	 *
	 * This exists so that answering on a board costs about as little as answering in
	 * chat: doctype, meta, stylesheet, script and a titled first section, written for
	 * you. Edit the returned path to put the content in.
	 *
	 * The board is attached and put on the canvas. The camera does not move — call `show`
	 * when you want the user looking at it.
	 *
	 *     const path = await stage.newBoard({ title: "Why the second tab fails", kind: "answer" });
	 *     // then: edit(path) to replace the placeholder section
	 *
	 * Kinds are shapes, not rules — change anything afterwards:
	 *
	 * - `answer` — a question as the heading, the answer in one screen
	 * - `design` — options as columns, with a callout for the recommendation
	 * - `report` — method, result, what is left; for when work is done
	 * - `plan`   — goal, approach, steps
	 * - `blank`  — a heading and nothing else
	 */
	newBoard(options: { title: string; kind?: "answer" | "design" | "report" | "plan" | "blank"; w?: number; h?: number }): Promise<string>;

	// --- your context -------------------------------------------------------------

	/**
	 * Hold a board in context, and put it on the canvas. Returns the boards now held.
	 *
	 * Attaching does not put the source in your context — call `read` for that. It tells
	 * the environment which boards you are working on: the rail lists them, a subagent
	 * inherits them, and they appear on the canvas, because a board you are holding that
	 * the user cannot see is a board they have no way of knowing about.
	 */
	attach(path: string | string[]): Promise<Board[]>;

	/** Stop holding a board. It leaves the canvas with it. */
	detach(path: string | string[]): Promise<Board[]>;

	/** The boards you are holding. */
	context(): Promise<Board[]>;

	/** The boards on the canvas: what the user can see of your context. */
	inPlay(): Promise<Board[]>;

	// --- what the user sees -------------------------------------------------------

	/**
	 * Set what is on the canvas, and fit the camera to it.
	 *
	 * This is the narrowing gesture and the only thing that moves the camera: the canvas
	 * becomes exactly what you name. Anything not already held is attached, because a
	 * board you show is a board you are working on. To put everything back:
	 * `await stage.show((await stage.context()).map((b) => b.path))`.
	 */
	show(path: string | string[], options?: ShowOptions): Promise<void>;

	/**
	 * Take boards off the canvas, keeping them in your context.
	 *
	 * For when something has served its purpose and would only be clutter — the canvas is
	 * closer to a slide than a desk.
	 */
	hide(path: string | string[]): Promise<void>;

	/** Move a board on the canvas. Persists to deck.json, so it is a real rearrangement. */
	move(path: string, at: { x: number; y: number }): Promise<Board>;

	/** Where the user is looking. Reading it tells you what they can see. */
	camera(): Promise<Camera>;
	camera(at: Camera): Promise<void>;

	/** Reload a board's frame, if you changed something the watcher cannot see. */
	reload(path: string): Promise<void>;

	/**
	 * Put a labelled dot on a board, at board coordinates, in your colour — or
	 * `null` to take it away. For pointing at something while you talk about it.
	 */
	cursor(path: string, at: { x: number; y: number } | null): Promise<void>;

	/** A short message in the corner of the canvas. Sparingly. */
	toast(text: string): Promise<void>;

	// --- who you are --------------------------------------------------------------

	me: {
		/** Your name in the chat list. Pick one and keep it. */
		setName(name: string): Promise<void>;
		/**
		 * Your avatar. An emoji is one line; an SVG lets you draw your own face,
		 * which is the intended use — keep it square, simple, and legible at 18px.
		 */
		setAvatar(avatar: { emoji: string } | { svg: string }): Promise<void>;
		get(): Promise<Identity>;
	};

	/** The other agents on this deck, and what they are holding. */
	agents(): Promise<AgentSummary[]>;

	/**
	 * Hand work to a subagent and wait for its report.
	 *
	 * The child is a fresh session on this same deck: its own context, its own row in
	 * the chat list, the same canvas. It is *given the source* of the boards you hand
	 * it — not a summary — so it starts from the same plan you are working to, and it
	 * reports by changing those boards.
	 *
	 * Omit `boards` and it inherits the ones you are holding. Four at a time.
	 *
	 *     const done = await stage.delegate({
	 *       name: "layout",
	 *       task: "Rework the risks board so nothing overlaps at 1400x900.",
	 *       boards: ["boards/risks.html"],
	 *     });
	 *     return done.report;
	 */
	delegate(spec: {
		name?: string;
		task: string;
		boards?: string[];
		/** "provider/model", if it should not use the default. */
		model?: string;
	}): Promise<{ agent: string; name: string; report: string; boards: string[] }>;
}

declare const stage: Stage;
