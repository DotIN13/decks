/**
 * The stage API, available inside `{{STAGE_TOOL}}` as `stage`. Your code is the body of an
 * async function: `await` and `return` work, and what you return comes back as JSON, with
 * anything you `console.log`. This is the whole API: if something is not here, it does not
 * exist. Board content is files: write it with your ordinary tools.
 */
export interface Board { path: string; title: string; x: number; y: number; w: number; h: number; box: Box; content?: { w: number; h: number }; clipped?: boolean; inContext: string[]; lastWrittenBy?: string }

export type WebTarget = string | { ref: string } | { name: string; nth?: number };

/** A box on the stage: both corners, so an edge is never a sum. */
export interface Box { x1: number; y1: number; x2: number; y2: number }
/** One item of a pen.dev `.pen` document: a `type`, an `id`, and pen's own fields (the pen-stage skill lists them). */
export type PenItem = { type: string; id?: string; children?: PenItem[]; [field: string]: unknown };
/** An edit to the drawing. Items are named by id; one inside an instance by its path, `"card-1/label"`. */
export type PenEdit =
	| { op: "insert"; node: PenItem; parent?: string; index?: number; box?: Partial<Box> }
	| { op: "update"; id: string; set?: Record<string, unknown>; box?: Partial<Box> }
	| { op: "replace"; id: string; node: PenItem }
	| { op: "delete"; id: string }
	| { op: "move"; id: string; parent?: string | null; index?: number; box?: Partial<Box> }
	| { op: "copy"; id: string; parent?: string; index?: number; box?: Partial<Box>; as?: string };

export interface Stage {
	/**
	 * Write a blank board and return its path. The title is the finding, as a sentence.
	 * `format`: "board" (default) is one HTML page you design, whose root-level blocks are
	 * placed where they say and whose height is measured; "slides" is a reveal deck of
	 * `<section>`s in a `.slides.html`. ("component" and "flow" named the two board formats
	 * that are now one, and both still mean "board".)
	 */
	newBoard(o: { title: string; format?: "board" | "slides"; w?: number; h?: number }): Promise<string>;
	/** Add these boards to your stage, beside what is there, and move the camera to them. `highlight` outlines one `data-id`. */
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
	/** Take boards off your stage, keeping them in your context. */
	hide(path: string | string[]): Promise<void>;
	/** Every board in the deck, placed as your stage has them. `inContext` names the agents holding each; `clipped` means content is past the edge. */
	boards(): Promise<Board[]>;
	/** The room your stage has on screen, in CSS pixels. */
	viewport(): Promise<{ width: number; height: number } | undefined>;
	move(path: string, at: { x: number; y: number }): Promise<Board>;
	/** Bubbles with arrows pointing at `data-id`s you changed. Nothing is written to the board. `null` clears. */
	annotate(path: string, marks: Array<{ to: string | { x: number; y: number }; label: string; tone?: "accent" | "ok" | "warn" | "danger" }> | null): Promise<unknown>;
	/** The URL of a board, for a Playwright screenshot. */
	url(path: string): Promise<string>;
	/** A file on disk -> the URL a board should embed. */
	resolve(file: string): Promise<string>;
	/** Where your stage is looking, or move it. `zoom` 1 is life size. */
	camera(): Promise<{ x: number; y: number; zoom: number }>;
	camera(at: { x: number; y: number; zoom: number }, o?: { animate?: boolean }): Promise<void>;
	/** Reload a board's frame, if you changed something the watcher cannot see. */
	reload(path: string): Promise<void>;
	/** A labelled dot on a board, at board coordinates; `null` removes it. */
	cursor(path: string, at: { x: number; y: number } | null): Promise<void>;
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
	 * Stages are files, `stages/<name>/stage.pen`, and you work on one at a time: its boards are the
	 * ones you show, hide and move, and the person sees it when talking to you. `stages` lists every
	 * stage and who has it open; `open` moves you to one; `newStage` makes an empty one and opens it.
	 * Two agents on one stage share its boards and its drawing.
	 */
	stages(): Promise<Array<{ name: string; open: string[]; boards: number; mine?: true }>>;
	open(name: string): Promise<{ stage: string; boards: string[] }>;
	newStage(title: string): Promise<{ stage: string }>;
	/**
	 * A picture of your stage, or part of it, as the person sees it: drawing and boards together.
	 * You see it in this call's result; it is also saved to `file`. `of` is an item's id, a board's
	 * path, a list of them, or a box; nothing is the whole stage. Check your drawing with it after a
	 * big change. `format` "jpeg" or "pdf", and `to` a deck path, make a file to hand on.
	 */
	screenshot(o?: { of?: string | string[] | Partial<Box>; scale?: number; format?: "png" | "jpeg" | "pdf"; to?: string; scheme?: "light" | "dark" }): Promise<{ file: string; width: number; height: number; box: Box }>;
	/**
	 * Your stage's drawing — notes, text, shapes, arrows and frames, drawn over the boards except a backdrop listed before the board it holds — kept as a
	 * native pen.dev `.pen` file in pen's own types and fields; the pen-stage skill teaches them.
	 * `read` gives every item as saved plus its `box` on the stage. `edit` applies edits together or
	 * not at all. A `box` places an item on the stage; the server turns it into pen's own x, y, width
	 * and height, so you never add a parent's corner. `file` is the path, to edit it by hand instead.
	 */
	pen: {
		file(): Promise<string>;
		read(): Promise<{ stage: string; file: string; version: string; error?: string; children: Array<PenItem & { box: Box }> }>;
		edit(edits: PenEdit[]): Promise<{ rev: number; results: Array<{ op: string; id: string; box?: Box; note?: string }> }>;
	};
	now(): Promise<{ iso: string; timezone: string; words: string; epoch: number }>;
	/**
	 * Who you are and what you are doing: read with nothing, change with a patch. Answers with the
	 * identity as stored — tags are slugged, deduped and capped at four, and `workspace` (the
	 * project you work in) is slugged too.
	 */
	me(patch?: { name?: string; avatar?: { emoji: string } | { svg: string }; tags?: string[]; workspace?: string }): Promise<{ name: string; avatar?: string; color: string; tags?: string[]; workspace?: string }>;
	/** Every agent; `filter.workspace` narrows to one project. */
	agents(o?: { filter?: { workspace?: string } }): Promise<Array<{ id: string; name: string; me: boolean; state: string; kind: string; tags: string[]; workspace?: string; queued: number }>>;
	/**
	 * Hand work over, and carry on. Two targets: a name from `agents()`, or `{ name, kind }`, which
	 * makes the agent first.
	 * Always returns at once — nothing can wait for a turn inside a 20-second run. `reply: true`
	 * puts their report in your transcript, to read on your next turn.
	 */
	send(
		to: string | { name: string; kind?: "pi" | "claude" | "opencode" | "antigravity"; model?: string; thinking?: string; mode?: "manual" | "acceptEdits" | "plan" | "auto"; tags?: string[]; workspace?: string },
		work: { task: string; boards?: string[]; reply?: boolean },
	): Promise<{ queued: true; position: number; agent?: string; name?: string }>;
}
declare const stage: Stage;
