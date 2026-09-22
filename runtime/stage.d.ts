/**
 * The stage API, available inside `{{STAGE_TOOL}}` as `stage`. Your code is the body of an
 * async function: `await` and `return` work, and what you return comes back as JSON, with
 * anything you `console.log`. This is the whole API: if something is not here, it does not
 * exist. Board content is files: write it with your ordinary tools.
 */
export interface Board { path: string; title: string; x: number; y: number; w: number; h: number; content?: { w: number; h: number }; clipped?: boolean; inContext: string[]; lastWrittenBy?: string; canvas?: string }

export type WebTarget = string | { ref: string } | { name: string; nth?: number };

/**
 * A canvas: the boards on it, the arrows and groups drawn between them, and who works there.
 * Boards belong to canvases, not to agents. Two agents on one canvas see one arrangement.
 */
export interface Canvas { id: string; name: string; workspace?: string; boards: string[]; links: Array<{ from: string; to: string; label?: string }>; groups: Array<{ name: string; boards: string[] }>; changedAt: number; agents: string[] }

export interface Stage {
	/**
	 * Write a blank board and return its path. The title is the finding, as a sentence.
	 * `format`: "board" (default) is one HTML page you design, whose root-level blocks are
	 * placed where they say and whose height is measured; "slides" is a reveal deck of
	 * `<section>`s in a `.slides.html`. ("component" and "flow" named the two board formats
	 * that are now one, and both still mean "board".)
	 */
	newBoard(o: { title: string; format?: "board" | "slides"; w?: number; h?: number }): Promise<string>;
	/** Add these boards to your canvas, beside what is there, and move the camera to them. `highlight` outlines one `data-id`. */
	show(path: string | string[], o?: { fit?: "board" | "all"; highlight?: string; animate?: boolean }): Promise<{ shown: string[] }>;
	/**
	 * Set a board's height from its measured content; the board must be shown first. The result
	 * also says, in a sentence, what the browser found: the height, the word count, the smallest
	 * type, content wider than the board, boxes that cut off their own content, and any view
	 * that breaks when a control is pressed. Use it instead of a screenshot.
	 */
	fit(path: string, o?: { margin?: number }): Promise<{ path: string; w: number; h: number }>;
	/** Set a size outright. */
	resize(path: string, size: { w?: number; h?: number }): Promise<{ path: string; w: number; h: number }>;
	/** Name boards you edited without showing them, so they are listed as yours. */
	report(path: string | string[]): Promise<{ reported: string[] }>;
	/** Take boards that are out of date off the canvas, keeping them in your context. Refused when it would empty the canvas: a new topic is a new canvas. */
	hide(path: string | string[]): Promise<void>;
	/**
	 * Every board in the deck, or with `filter` the boards on one canvas (name or id) or on every
	 * canvas of a workspace, each saying which `canvas` it was found on. `clipped` means content
	 * is past the edge.
	 */
	boards(o?: { filter?: { canvas?: string; workspace?: string } }): Promise<Board[]>;
	/** The room the canvas has, in CSS pixels. */
	viewport(): Promise<{ width: number; height: number } | undefined>;
	move(path: string, at: { x: number; y: number }): Promise<Board>;
	/** Bubbles with arrows pointing at `data-id`s you changed. Nothing is written to the board. `null` clears. */
	annotate(path: string, marks: Array<{ to: string | { x: number; y: number }; label: string; tone?: "accent" | "ok" | "warn" | "danger" }> | null): Promise<unknown>;
	/** The URL of a board, for a Playwright screenshot. */
	url(path: string): Promise<string>;
	/** A file on disk -> the URL a board should embed. */
	resolve(file: string): Promise<string>;
	/** Where your canvas is looking, or move it. `zoom` 1 is life size. */
	camera(): Promise<{ x: number; y: number; zoom: number }>;
	camera(at: { x: number; y: number; zoom: number }, o?: { animate?: boolean }): Promise<void>;
	/** Reload a board's frame, if you changed something the watcher cannot see. */
	reload(path: string): Promise<void>;
	/** A labelled dot on a board, at board coordinates; `null` removes it. */
	cursor(path: string, at: { x: number; y: number } | null): Promise<void>;
	/** A board that is a live view of a conversation: yours, or `of` another agent's. */
	/** What is waiting in an agent's queue: yours, or another's. */
	queue(agentId?: string): Promise<Array<{ from: string; fromName: string; task: string; boards: string[]; at: number }>>;
	/**
	 * The person's own Chrome, shared through the Decks extension: one tab, logged in as
	 * them. `read` is how you see the page (address, title, and an accessibility tree that
	 * names every field and button and gives each a `[ref=e42]`); `screenshot` is for what a
	 * tree cannot say. Name a target by its label, or `{ ref: "e42" }`, or
	 * `{ name: "Degree", nth: 2 }`; a name matching two things is refused. References die
	 * when the tab navigates: read again. Every call throws a sentence when no tab is
	 * shared; relay it. `submit` asks the person first and may return `allowed: false`.
	 * Never ask for or fill passwords and codes.
	 */
	web: {
		status(): Promise<{ paired: boolean; connected: boolean; tab?: { title: string; url: string }; pending?: { id: string; text: string }; closed?: string }>;
		pairing(): Promise<{ code: string; path: string; note: string }>;
		repair(): Promise<{ code: string }>;
		board(): Promise<string>;
		open(url: string): Promise<{ url: string; title: string }>;
		read(): Promise<{ url: string; title: string; snapshot: string; truncated?: boolean }>;
		screenshot(o?: { full?: boolean }): Promise<{ file: string; width: number; height: number }>;
		fill(field: WebTarget, text: string): Promise<{ field: string }>;
		select(field: WebTarget, option: string): Promise<{ field: string; option: string }>;
		click(what: WebTarget): Promise<{ clicked: string }>;
		press(key: string): Promise<{ pressed: string }>;
		submit(what?: WebTarget, o?: { ask?: boolean }): Promise<{ submitted: string; allowed: boolean }>;
		stop(): Promise<void>;
	};
	/**
	 * A goal-driven browser agent (jev-ultrafast), beside `web`: a headless browser of the
	 * server's, never the person's Chrome. Give `run` one URL and one goal in plain words;
	 * the agent picks its own clicks and typing until the goal is done or blocked. A run
	 * outlives a stage call, so `run` returns at once — follow it with `state()` on your
	 * next turn, one run at a time. `status()` says whether the server has the model keys
	 * a run needs; relay its sentence when it says no.
	 */
	/**
	 * A goal-driven browser agent (jev-ultrafast), beside the shared Chrome: one URL, one
	 * goal, and the agent decides its own clicks until the goal is done or blocked.
	 *
	 * Left alone it drives the tab the person shared through the extension, because that is
	 * the browser their logins are in — and two gates hold it there: nothing is sent without
	 * an answer, and the words typed into a field are the supervising agent's, never its own.
	 * `{ browser: "headless" }` is a Chromium of the server's own instead, for pages nobody is
	 * logged into. A run outlives a stage call (a run is seconds to minutes; a stage run is
	 * abandoned after twenty), so `run` returns at once, `state` follows the run, and `answer`
	 * is how a held one carries on — on your next turn, never in a loop inside this one.
	 */
	web_jev: {
		/** Whether a run can start, whether a Chrome is shared, and what the run going now is doing. */
		status(): Promise<{ ready: boolean; missing: string[]; shared: boolean; note: string; running?: { id: string; url: string; goal: string; startedAt: number; steps: number; browser: "chrome" | "headless"; waiting?: { id: string; kind: "allow" | "words"; action: string; tab?: string; field?: string; since: number } }; last?: { id: string; status: string; steps: number; elapsedMs: number; note?: string } }>;
		/**
		 * Start one run. One at a time. Without `browser` it uses the shared Chrome when there is
		 * one, and `headless` forces a browser of the server's own.
		 */
		run(o: { url: string; goal: string; browser?: "chrome" | "headless" }): Promise<{ id: string; note: string }>;
		/** The run going now, or the last one: every step it took and every gate it met. */
		state(): Promise<{ id: string; url: string; goal: string; status: "starting" | "running" | "done" | "blocked" | "failed" | "stopped"; elapsedMs: number; browser: "chrome" | "headless"; waiting?: { id: string; kind: "allow" | "words"; action: string; tab?: string; field?: string; since: number }; gate: Array<{ at: number; kind: string; text: string }>; steps: Array<{ at: number; status: string; elapsedMs: number; steps: number; url?: string; last?: { action: string; operation: string; text: string | null } }>; note?: string; endedAt?: number }>;
		/**
		 * Answer what a gate is holding. `{ allow: true }` lets a press that would send something
		 * through; `{ text: "…" }` is what actually gets typed, because the browser agent's own
		 * words never reach a field. `state()` says which of the two is being asked.
		 */
		answer(o: { allow?: boolean; text?: string }): Promise<{ answered: string }>;
		stop(): Promise<void>;
	};
	now(): Promise<{ iso: string; timezone: string; words: string; epoch: number }>;
	/**
	 * Who you are and what you are doing: read with nothing, change with a patch. Answers with the
	 * identity as stored — tags are slugged, deduped and capped at four. Your canvas is `canvas()`.
	 */
	me(patch?: { name?: string; avatar?: { emoji: string } | { svg: string }; tags?: string[] }): Promise<{ name: string; avatar?: string; color: string; tags?: string[]; workspace?: string }>;
	/** The canvas you are working on, or undefined before you have shown anything. */
	canvas(): Promise<Canvas | undefined>;
	/**
	 * Move to a canvas that exists, by name or id: what you show from then on goes there, and
	 * pressing you in the app takes the person there.
	 */
	useCanvas(name: string): Promise<Canvas>;
	/**
	 * Make a canvas for a new topic and move to it: in your own workspace, or in `workspace`.
	 * A name is used once per deck; a taken one is refused.
	 */
	newCanvas(name: string, o?: { workspace?: string }): Promise<Canvas>;
	/** Every canvas, with who is working on each; `filter.workspace` narrows to one project. Check it before making one. */
	canvases(o?: { filter?: { workspace?: string } }): Promise<Canvas[]>;
	/** An arrow between two boards on your canvas: this led to that. A label of `null` takes it away. Drawn under the boards; nothing is written into either file. */
	link(from: string, to: string, label?: string | null): Promise<Canvas>;
	/** A dashed border round two or more boards: one piece of work. The same name replaces it; `[]` takes it away. */
	group(paths: string[], o: { name: string }): Promise<Canvas>;
	/** Every agent; `filter.workspace` narrows to one project, `filter.canvas` to who has worked in that room. */
	agents(o?: { filter?: { workspace?: string; canvas?: string } }): Promise<Array<{ id: string; name: string; me: boolean; state: string; kind: string; tags: string[]; workspace?: string; queued: number }>>;
	/**
	 * Hand work over, and carry on. Three targets: a name from `agents()`; `{ name, kind }`, which
	 * makes the agent first; or `"dispatcher"`, which makes a dashboard task for the deck to place.
	 * Always returns at once — nothing can wait for a turn inside a 20-second run. `reply: true`
	 * puts their report in your transcript, to read on your next turn.
	 */
	send(
		to: string | { name: string; kind?: "pi" | "claude" | "opencode" | "antigravity"; model?: string; thinking?: string; mode?: "manual" | "acceptEdits" | "plan" | "auto"; tags?: string[]; workspace?: string },
		work: { task: string; boards?: string[]; reply?: boolean },
	): Promise<{ queued?: true; position?: number; agent?: string; name?: string; id?: string; state?: string; why?: string }>;
	/** A repeating task. `at` is HH:MM in the person's timezone; never convert it yourself. */
	schedule(spec: { name: string; at: string; days: number[]; timezone?: string; workspace: string; task: string; boards?: string[] }): Promise<{ id: string; nextRunAt: number }>;
}
declare const stage: Stage;
