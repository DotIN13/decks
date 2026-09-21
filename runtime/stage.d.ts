/**
 * The stage API, available inside `{{STAGE_TOOL}}` as `stage`. Your code is the body of an
 * async function: `await` and `return` work, and what you return comes back as JSON, with
 * anything you `console.log`. This is the whole API: if something is not here, it does not
 * exist. Board content is files: write it with your ordinary tools.
 */
export interface Board { path: string; title: string; x: number; y: number; w: number; h: number; content?: { w: number; h: number }; clipped?: boolean; inContext: string[]; lastWrittenBy?: string }

export type WebTarget = string | { ref: string } | { name: string; nth?: number };

/**
 * A canvas: the boards on it, the arrows and groups drawn between them, and who works there.
 * Boards belong to canvases, not to agents. Two agents on one canvas see one arrangement.
 */
export interface Canvas { id: string; name: string; boards: string[]; links: Array<{ from: string; to: string; label?: string }>; groups: Array<{ name: string; boards: string[] }>; changedAt: number; agents: string[] }

export interface Stage {
	/**
	 * Write a blank board and return its path. The title is the finding, as a sentence.
	 * `format`: "board" (default) is one HTML page you design, whose root-level blocks are
	 * placed where they say and whose height is measured; "slides" is a reveal deck of
	 * `<section>`s in a `.slides.html`. ("component" and "flow" named the two board formats
	 * that are now one, and both still mean "board".)
	 */
	newBoard(o: { title: string; format?: "board" | "slides"; w?: number; h?: number }): Promise<string>;
	/** Put exactly these boards on the canvas and move the camera to them. `highlight` outlines one `data-id`. */
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
	/** Take boards off the canvas, keeping them in your context. */
	hide(path: string | string[]): Promise<void>;
	/** Every board in the deck; `clipped` means content is past the edge. */
	boards(): Promise<Board[]>;
	/** The room the canvas has, in CSS pixels. */
	viewport(): Promise<{ width: number; height: number } | undefined>;
	attach(path: string | string[]): Promise<Board[]>;
	detach(path: string | string[]): Promise<Board[]>;
	move(path: string, at: { x: number; y: number }): Promise<Board>;
	/** Bubbles with arrows pointing at `data-id`s you changed. Nothing is written to the board. `null` clears. */
	annotate(path: string, marks: Array<{ to: string | { x: number; y: number }; label: string; tone?: "accent" | "ok" | "warn" | "danger" }> | null): Promise<unknown>;
	/** The URL of a board, for a Playwright screenshot. */
	url(path: string): Promise<string>;
	/** A file on disk -> the URL a board should embed. */
	resolve(file: string): Promise<string>;
	/** The boards on the canvas: what the person can see of your context. */
	inPlay(): Promise<Board[]>;
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
	now(): Promise<{ iso: string; timezone: string; words: string; epoch: number }>;
	/**
	 * Who you are and what you are doing: read with nothing, change with a patch. Answers with the
	 * identity as stored — tags are slugged, deduped and capped at four. Your canvas is `canvas()`.
	 */
	me(patch?: { name?: string; avatar?: { emoji: string } | { svg: string }; tags?: string[] }): Promise<{ name: string; avatar?: string; color: string; tags?: string[]; workspace?: string }>;
	/** The canvas you work on. With a name, join that one (made if there is none); with nothing, read where you are. */
	canvas(name?: string): Promise<Canvas | undefined>;
	/** Every canvas in the deck, with who is working on each. Check it before making one, and reuse a name. */
	canvases(): Promise<Canvas[]>;
	/** An arrow between two boards on your canvas: this led to that. A label of `null` takes it away. Drawn under the boards; nothing is written into either file. */
	link(from: string, to: string, label?: string | null): Promise<Canvas>;
	/** A dashed border round two or more boards: one piece of work. The same name replaces it; `[]` takes it away. */
	group(paths: string[], o: { name: string }): Promise<Canvas>;
	agents(): Promise<Array<{ id: string; name: string; me: boolean; state: string; kind: string; tags: string[]; workspace?: string; queued: number }>>;
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
