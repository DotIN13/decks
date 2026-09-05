/**
 * The stage API, available inside `{{STAGE_TOOL}}` as `stage`.
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
	/** What you last said you were doing, as stored — see `me.setTags`. */
	tags?: string[];
}

export interface AgentSummary {
	id: string;
	name: string;
	/** Whether this is you. */
	me: boolean;
	state: "idle" | "thinking" | "streaming" | "tool" | "waiting";
	/** Boards this agent is holding. */
	context: string[];
	/** What it says it is working on. Empty if it has not said. */
	tags: string[];
	/** How many handed-over items are waiting for it — see `send`. */
	queued: number;
}

/** One item waiting in an agent's queue. */
export interface QueuedWork {
	/** The agent that sent it, and the name it was going by. */
	from: string;
	fromName: string;
	task: string;
	boards: string[];
	at: number;
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

	/**
	 * How much room the canvas has, in CSS pixels — the size a board is looked at in.
	 *
	 * The window minus the chrome standing beside it, not divided by the zoom: it is the
	 * space a board has on screen, so `1440x900` means a board that wide is read at life
	 * size and a board twice that is read at half.
	 *
	 * `undefined` when nobody is looking, or before the browser's first reading. There is
	 * deliberately no default — a made-up number looks exactly like a measured one at the
	 * point you would use it.
	 */
	viewport(): Promise<{ width: number; height: number } | undefined>;

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
	 *
	 * **The result tells you the viewport** — `viewport 1440x900 px`, the room the canvas
	 * has — because that is the moment the number is worth knowing. There is no rule about
	 * what to do with it: size the board to the content, and let the number tell you what
	 * that will look like. `stage.viewport()` asks for it any other time.
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
	 *
	 * **The camera is per conversation.** If the user is reading another chat, the canvas
	 * does not move — your view is remembered and arrives, framed as you asked, the moment
	 * they open yours. The result says which happened: `{ shown }` when it moved,
	 * `{ shown, deferred }` when it is waiting. Either way the boards are in play, so this
	 * is worth doing whether or not anyone is watching.
	 */
	show(path: string | string[], options?: ShowOptions): Promise<{ shown: string[]; deferred?: string }>;

	/**
	 * Take boards off the canvas, keeping them in your context.
	 *
	 * For when something has served its purpose and would only be clutter — the canvas is
	 * closer to a slide than a desk.
	 */
	hide(path: string | string[]): Promise<void>;

	/** Move a board on the canvas. Persists to deck.json, so it is a real rearrangement. */
	move(path: string, at: { x: number; y: number }): Promise<Board>;

	/**
	 * Where **your** canvas is looking — not where the user is, unless they are reading you.
	 * Setting it follows the same rule as `show`: applied if you are on screen, remembered
	 * against your chat if you are not.
	 */
	camera(): Promise<Camera>;
	camera(at: Camera): Promise<void>;

	/** Reload a board's frame, if you changed something the watcher cannot see. */
	reload(path: string): Promise<void>;

	/**
	 * Put a labelled dot on a board, at board coordinates, in your colour — or
	 * `null` to take it away. For pointing at something while you talk about it.
	 */
	cursor(path: string, at: { x: number; y: number } | null): Promise<void>;

	/**
	 * Point at what you just changed: a bubble with a small arrow, on the canvas.
	 *
	 *     await stage.annotate("boards/plan.html", [
	 *       { to: "goal", label: "rewrote this" },
	 *       { to: "risk-auth", label: "and added this", tone: "ok" },
	 *     ]);
	 *     await stage.annotate("boards/plan.html", null);   // clear yours
	 *
	 * **Nothing is written to the board.** These live on the canvas and vanish, like
	 * `cursor` — a board that has been annotated is byte-identical to one that has not, so
	 * there is nothing to tidy up afterwards.
	 *
	 * `to` is a component's `data-id`, which is the point: the arrow is anchored to the
	 * *thing*, so a component that moves takes its arrow with it. A `{ x, y }` is a board
	 * coordinate, for pointing at somewhere rather than something.
	 *
	 * Use it when you have changed a board and want the reader's eye to land on where —
	 * which `show({ highlight })` cannot do, because it frames exactly one component and
	 * moves the camera to do it. Four at most, `tone` is `accent` | `ok` | `warn` | `danger`,
	 * and labels are cut at 80 characters. Yours are cleared when you are next prompted.
	 *
	 * Returns how many were drawn: anything pointing at a `data-id` the board does not have
	 * is dropped, so `{ annotated: 2, of: 3 }` means one of them missed.
	 */
	annotate(path: string, marks: Array<{ to: string | { x: number; y: number }; label: string; tone?: "accent" | "ok" | "warn" | "danger" }> | null): Promise<unknown>;

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
		/**
		 * What you are working on, in a few words. **Set these when you start on something and
		 * clear them when you stop**, so the person watching can see what each agent is up to
		 * without opening five conversations.
		 *
		 *     await stage.me.setTags(["panel-css", "measuring"]);
		 *     // when the work moves on
		 *     await stage.me.setTags(["panel-css", "writing-up"]);
		 *     // finished
		 *     await stage.me.setTags([]);
		 *
		 * **It replaces, it does not add.** So the list always says what is true now — which is
		 * the only thing it is asked. Four at most, and each is slugged: lowercased, spaces to
		 * hyphens, cut at 24 characters on a word boundary. It returns them **as stored**, so
		 * `["Reading panel.css and measuring"]` comes back `["reading-panel-css-and"]` — read
		 * the result if you care what it became.
		 *
		 * Short nouns beat sentences: `panel-css`, `e2e`, `thumbnails`. The name of the thing
		 * you are working on, not a description of the work.
		 */
		setTags(tags: string[]): Promise<string[]>;
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

	/**
	 * Hand work to an agent that **already exists**, and carry on without waiting.
	 *
	 * The counterpart to `delegate`, and the difference is who the work belongs to.
	 * `delegate` creates an agent and blocks until it reports: right when the result is a
	 * step in what *you* are doing. `send` puts an item in somebody else's queue and returns
	 * at once: right when the work is *theirs* — they are holding that part of the deck,
	 * they asked, or you have nothing to do with the answer.
	 *
	 *     await stage.send("Ada", {
	 *       task: "The panel numbers on boards/rows.html are stale — remeasure and update them.",
	 *       boards: ["boards/rows.html"],
	 *     });
	 *     // -> { queued: true, position: 1 }
	 *
	 * `to` is an id or a name from `stage.agents()`. The receiver starts it once it has been
	 * **idle for a quiet period**, so it never cuts into a turn in progress, and it is handed
	 * the board *source* at that moment — not at this one, so a board that changes while the
	 * item waits is read as it then is. It arrives as a notice in their transcript
	 * immediately, so nothing runs unannounced.
	 *
	 * Eight items per agent. Nothing is created, so it does not count against the subagent
	 * limit, and sending to yourself is allowed — it is how you leave yourself a follow-up.
	 */
	send(to: string, work: { task: string; boards?: string[] }): Promise<{ queued: true; position: number }>;

	/** What is waiting for an agent: yours, or another's if you name it. */
	queue(agentId?: string): Promise<QueuedWork[]>;
}

declare const stage: Stage;
