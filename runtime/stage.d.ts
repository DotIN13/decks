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
	/**
	 * How much room the content actually takes, as the canvas last measured it.
	 *
	 * Only present for a board somebody is looking at, and only while the measurement
	 * matches the file — a reading of a version you have since rewritten is left off
	 * rather than reported, because a number gets believed.
	 */
	content?: { w: number; h: number };
	/** Content past the edge of the board: written, rendered, and invisible. */
	clipped?: boolean;
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
	/**
	 * The runtime this agent is. Fixed at creation, and not interchangeable: a Claude agent
	 * can rewind, an opencode one cannot, an antigravity one has no thinking scale in the
	 * picker and applies a mode change only at its next start. It is the same word the chat
	 * list shows the user.
	 */
	kind: "pi" | "claude" | "opencode" | "antigravity";
	/**
	 * The boards this agent is holding, **newest first** and capped at twenty.
	 *
	 * `held` is most-recently-touched-first, so this slice is the answer to "what is it
	 * working on" — attaching a board already held moves it to the front. The cap is a
	 * screen of it, not a truncation: `holding` is the true total, so a reader can tell
	 * a slice from everything before deciding whether to ask for more.
	 */
	context: string[];
	/** How many boards it really holds — `context` is capped, this is not. */
	holding: number;
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
	 * **`format` is what the board is as a file**, which is a different question from its
	 * shape — an answer can be written as boxes or as prose:
	 *
	 * - `component` (default) — absolutely-positioned boxes with `data-id`s. Every board this
	 *   deck has ever written, and the only format the drag-and-retype editor can work on.
	 * - `flow` — a `.md` file that reflows. Its height is measured rather than stored, so it
	 *   cannot clip; write it with an ordinary file write, not with positioned components.
	 * - `slides` — a `.slides.html` deck in **reveal's own format**: one `<section>` per
	 *   slide inside `.reveal > .slides`. Nested sections become consecutive slides. Speaker
	 *   notes are `<aside class="notes">`. Every slide is laid out at 960×540 and scaled, so
	 *   nothing reflows when it is presented — and a `<script>` in it does not run, so a deck
	 *   cannot bring its own runtime.
	 *
	 * A format that is not `component` has no shape to choose, so `kind` is ignored for one
	 * and the result says so. The **file extension is derived** from the format and is not
	 * yours to name: a board's format is read back out of its filename, so the two must not
	 * be able to disagree.
	 *
	 *     const deck = await stage.newBoard({ title: "The plan, out loud", format: "slides" });
	 *     // -> "boards/the-plan-out-loud.slides.html", three sections in it to replace
	 *
	 * **The result tells you the viewport and the width it chose** — `viewport 1440x900 px`,
	 * `board width 1000 — the rule is min(viewport width, 1600)` — because that is the moment
	 * both are worth knowing. `stage.viewport()` asks any other time.
	 *
	 * **Width.** The smallest width that holds the content, capped at `min(viewport width,
	 * 1600)`. 1600 is a ceiling, not a target: a board wider than the room the canvas has is
	 * read scaled down, and past 1600 a line of prose is too long to track back to. Viewport
	 * 1920 → never wider than 1600. Viewport 1440 → never wider than 1440. Viewport 390, a
	 * phone → never wider than 390, and the template folds its columns to fit. This is
	 * applied for you when you pass no `w`; an explicit `w` is still yours.
	 *
	 * **Reading order.** DOM order is visual order, top to bottom. One column or two; where
	 * two components share a row, write the left one first. The reader has the picture and
	 * you have the file, and the two have to be the same document.
	 *
	 * Aim for the smallest board that explains the thing: a summary at the top, then
	 * diagrams, tables and embeds in preference to prose. Once the height is near twice the
	 * width, it is two boards.
	 */
	newBoard(options: {
		title: string;
		kind?: "answer" | "design" | "report" | "plan" | "blank";
		format?: "component" | "flow" | "slides";
		w?: number;
		h?: number;
	}): Promise<string>;

	/**
	 * A **mirror**: a board that is a live view of a conversation.
	 *
	 *     await stage.mirror();                          // this conversation
	 *     await stage.mirror({ of: "Vale", w: 560, h: 900 });
	 *     // -> { path: "boards/mirrors/vale.html", of: "Vale", agent: "7f3a…" }
	 *
	 * Unlike every other board, its file never changes: it is a stub, and the turns arrive
	 * in the browser from a transcript the app is already holding. So it costs no writes, it
	 * cannot go stale, and **mirroring an agent you are not talking to is free** — which is
	 * the point of `of`. Three mirrors side by side is what everyone is doing, without
	 * opening three conversations.
	 *
	 * It scrolls, inside its own rectangle, and hands the scroll back to the canvas at the
	 * ends. It is pinned to the newest turn until you scroll away from it, and says how many
	 * arrived while you were reading further up. Below half zoom a board takes no pointer
	 * events at all, so a mirror seen small is a glance and a mirror zoomed into is a
	 * transcript.
	 *
	 * A **view, not a document**: you cannot retype a turn in it or drag one out. If you
	 * want part of a conversation as material on the canvas, write it onto a board yourself.
	 *
	 * Attached and put on the canvas, camera unmoved, exactly as `newBoard` is. Asking twice
	 * for the same agent hands back the board you already have rather than a second window.
	 */
	mirror(options?: { of?: string; w?: number; h?: number }): Promise<{ path: string; of: string; agent: string }>;

	/**
	 * Set a board's size. Either dimension on its own is fine.
	 *
	 *     await stage.resize("boards/plan.html", { h: 1800 });
	 *
	 * A board's size is one number in its own `<meta name="board">`, and editing that tag
	 * by hand works — but it is JSON inside an HTML attribute, and the write has to leave
	 * every other byte alone. This does it, and refreshes the deck's record as part of the
	 * write, so a resize is never a change the canvas has to be told about twice.
	 */
	resize(path: string, size: { w?: number; h?: number }): Promise<{ path: string; w: number; h: number }>;

	/**
	 * Size a board to what is on it — **both dimensions**.
	 *
	 *     await stage.fit("boards/plan.html");            // -> { path, w, h, content }
	 *     await stage.fit("boards/plan.html", { margin: 80 });
	 *
	 * The width shrinks as well as grows: a board left at the width it was guessed at has a
	 * column of empty grid down its right-hand side, and a reader cannot tell that from a
	 * board whose author meant it. It is clamped to `min(viewport width, 1600)` — the same
	 * ceiling `newBoard` uses.
	 *
	 * **Two passes, because narrowing reflows.** Changing the width changes the height that
	 * was being measured, so `fit` sets the width, waits for the browser to lay the board
	 * out again, and takes the height from that second reading. You do not have to do
	 * anything about this; it is why one call can take two round trips.
	 *
	 * Content wider than the ceiling is left clipped rather than papered over: the board
	 * stops at the ceiling, `clipped` says so on `stage.boards()`, and the answer is a
	 * narrower component rather than a wider board.
	 *
	 * The measurement is taken in the frame showing the board, because that is the only
	 * place a board is laid out. So **the board has to be on the canvas**: a board nobody
	 * is showing has never been measured, and this says so rather than guessing. Write the
	 * content, `show` it, then `fit` — which is the loop that replaces screenshotting a
	 * board to find out whether it clips.
	 */
	fit(path: string, options?: { margin?: number }): Promise<{ path: string; w: number; h: number; content?: { w: number; h: number } }>;

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
		/**
		 * The runtime the child is: fixed at creation, exactly as the `+` button fixes it.
		 * Omit it and the child gets the server's default. The one field that can never
		 * change afterwards.
		 */
		kind?: "pi" | "claude" | "opencode" | "antigravity";
		/**
		 * The thinking level, on its own scale from the model. Whatever you ask, the child is
		 * still created — a request a runtime cannot hold is a notice in your transcript, not
		 * an error. Every runtime takes these; only the set offered per model varies.
		 */
		thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
		/**
		 * How much the child asks before acting, from its runtime's own set.
		 *
		 * A request a runtime cannot hold is not an error: the child does the work on its
		 * default mode and your transcript says so. pi has no modes at all, opencode offers
		 * three of the four (not `plan`), antigravity two (`acceptEdits` and `plan`), Claude
		 * all four.
		 */
		mode?: "manual" | "acceptEdits" | "plan" | "auto";
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
	send(to: string, work: {
		task: string;
		boards?: string[];
		/**
		 * Tell you when the work is done: the receiver's report lands in your transcript as
		 * a notice when the item runs. Never a queued task — a task runs a turn of your own,
		 * and two agents answering each other's reports is a conversation that never ends.
		 * Off by default, because most sends are work you have nothing more to do with, and
		 * a reply you did not ask for is an interruption.
		 */
		reply?: boolean;
	}): Promise<{ queued: true; position: number }>;

	/** What is waiting for an agent: yours, or another's if you name it. */
	queue(agentId?: string): Promise<QueuedWork[]>;
}

declare const stage: Stage;
