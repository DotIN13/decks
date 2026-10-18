// Generated from packages/api by scripts/gen-sdk.mjs. Edit the table there, then run the script.
/** A board's top-left corner on the stage: { x1, y1 }, or { x, y }. */
export type Corner = { x1: number; y1: number } | { x: number; y: number };
/**
 * A board as your stage has it. `inContext` names the agents holding it; `clipped` means content is
 * past the edge.
 */
export type Board = { path: string; title: string; x: number; y: number; w: number; h: number; box: Box; content?: { w: number; h: number }; clipped?: boolean; inContext: string[]; lastWrittenBy?: string };
/** A box on the stage: both corners, so an edge is never a sum. */
export type Box = { x1: number; y1: number; x2: number; y2: number };
export type Point = { x: number; y: number };
/**
 * An edit to the drawing. Items are named by id; one inside an instance by its path,
 * "card-1/label".
 */
export type PenEdit = { op: "insert"; node: PenItem; parent?: string; index?: number; box?: { x1?: number; y1?: number; x2?: number; y2?: number } } | { op: "update"; id: string; set?: Record<string, unknown>; box?: { x1?: number; y1?: number; x2?: number; y2?: number } } | { op: "replace"; id: string; node: PenItem } | { op: "delete"; id: string } | { op: "move"; id: string; parent?: string | null; index?: number; box?: { x1?: number; y1?: number; x2?: number; y2?: number } } | { op: "copy"; id: string; parent?: string; index?: number; box?: { x1?: number; y1?: number; x2?: number; y2?: number }; as?: string };
/** One item of a pen.dev `.pen` document: a `type`, an `id`, and pen's own fields. */
export type PenItem = { type: string; id?: string; children?: unknown[]; [key: string]: unknown };
export type AppState = { name: string; title: string; kind: AppKind; status: "stopped" | "installing" | "building" | "starting" | "running" | "asleep" | "broken"; url: string; board: string; port?: number; error?: string; seenAt?: number; at?: number; version?: number };
export type AppKind = "static" | "build" | "server";
export type AppOutcome = { ok: boolean; status: "stopped" | "installing" | "building" | "starting" | "running" | "asleep" | "broken"; ms: number; errors: string[]; pending?: true };
/** A field or button: its label, { ref: "e42" } from read, or { name, nth }. */
export type WebTarget = string | { ref: string } | { name: string; nth?: number };

/** Every verb Decks answers. */
export interface Verbs {
	/**
	 * Write a blank board and return its path. The title is the finding, as a sentence. `format`
	 * "board" (default) is one HTML page you design; "slides" is a reveal deck of <section>s. `at` is
	 * its top-left corner on your stage: say it every time, after reading the stage with pen.read. Left
	 * out, the board goes beside your newest board and the result says where.
	 */
	newBoard(options: { title: string; format?: "board" | "slides"; w?: number; h?: number; at?: Corner }): Promise<string>;
	/**
	 * Set a board's height from its content, measured at the width it has on a canvas (`canvas` names
	 * one, else your stage's). The board must be on it. The notes say what the browser found: the
	 * height, the word count, the smallest type, content wider than the board, boxes that cut off their
	 * content, and any view that breaks when a control is pressed. Use it instead of a screenshot.
	 */
	fit(path: string, options?: { canvas?: string; margin?: number }): Promise<{ path: string; w: number; h: number; content?: { w: number; h: number; page?: number } }>;
	/** Set a board's size outright. */
	resize(path: string, size: { w?: number; h?: number }): Promise<{ path: string; w: number; h: number }>;
	/** Name boards you edited without showing them, so they are listed as yours. */
	report(path: string | string[]): Promise<{ reported: string[] }>;
	/** Reload a board's frame, if you changed something the watcher cannot see. */
	reload(path: string): Promise<void>;
	/** Every board in the deck, placed as your stage has them. */
	boards(): Promise<Board[]>;
	/**
	 * Add these boards to your stage and move the camera to them. `at` places the one board named,
	 * top-left corner; for a board already on the stage it moves it. `highlight` outlines one data-id.
	 * A drawn item's id can be named instead of a board path: the camera goes to it.
	 */
	show(target: string | string[], options?: { fit?: "board" | "all"; highlight?: string; animate?: boolean; at?: Corner }): Promise<{ shown: string[] }>;
	/** Take boards off your stage, keeping them in your context. */
	hide(path: string | string[]): Promise<void>;
	/** Move a board on your stage: `at` is its top-left corner. */
	move(path: string, at: Point): Promise<Board>;
	/** A labelled dot on a board, at board coordinates; null removes it. */
	cursor(path: string, at: Point | null): Promise<void>;
	/** Where your stage is looking, or move it with { x, y, zoom }. `zoom` 1 is life size. */
	camera(at?: { x: number; y: number; zoom: number }, options?: { animate?: boolean }): Promise<{ x: number; y: number; zoom: number } | null>;
	/** The room your stage has on screen, in CSS pixels. */
	viewport(): Promise<{ width: number; height: number } | null>;
	/**
	 * A picture of your stage, or part of it, as the person sees it, saved to `file`. `of` is an item's
	 * id, a board's path, a list of them, or a box; nothing is the whole stage. A .pen file's path
	 * pictures that file whole. `format` "jpeg" or "pdf", and `to` a deck path, make a file to hand on.
	 * One board's path alone is that board as the browser has it now.
	 */
	screenshot(options?: { of?: string | string[] | { x1?: number; y1?: number; x2?: number; y2?: number }; scale?: number; format?: "png" | "jpeg" | "pdf"; to?: string; scheme?: "light" | "dark" }): Promise<{ file: string; width: number; height: number; box: Box; how?: "canvas" | "snapshot" | "server"; note?: string }>;
	/**
	 * Every stage (canvas) and who has it open. A stage's `name` is its folder and never changes; its
	 * `title` is what the person calls it.
	 */
	stages(): Promise<{ name: string; title: string; open: string[]; boards: number; mine?: true }[]>;
	/** Move to another stage, by name or title: its boards become the ones you show, hide and move. */
	open(name: string): Promise<{ stage: string; boards: string[] }>;
	/** Make an empty stage from a title, and open it. */
	newStage(title: string): Promise<{ stage: string }>;
	/**
	 * Name the canvas you are on, or read its name with nothing. Name it for what is on it, as a few
	 * words a person would look for.
	 */
	title(title?: string): Promise<{ stage: string; title: string }>;
	/**
	 * Who you are: read with nothing, change with a patch. Set all four first in every session: a short
	 * name of your own, an avatar (an <svg> with xmlns and a viewBox, or an emoji), the project as
	 * `workspace`, and up to four tags for what you are doing now.
	 */
	me(patch?: { name?: string; avatar?: { emoji: string } | { svg: string }; tags?: string[]; workspace?: string }): Promise<{ name: string; avatar?: string; color: string; tags?: string[]; workspace?: string; avatarChanged?: string }>;
	/** Every agent; `filter.workspace` narrows to one project. */
	agents(options?: { filter?: { workspace?: string } }): Promise<{ id: string; name: string; me: boolean; state: string; kind: string; tags: string[]; workspace?: string; queued: number }[]>;
	/**
	 * Hand work over, and carry on: to an agent by name, or to { name, kind }, which makes it first.
	 * Returns at once; `reply: true` brings their report back to you.
	 */
	send(to: string | { name: string; kind?: "pi" | "claude" | "opencode" | "opencode2" | "antigravity"; model?: string; thinking?: string; mode?: "manual" | "acceptEdits" | "plan" | "auto"; tags?: string[]; workspace?: string }, work: { task: string; boards?: string[]; reply?: boolean }): Promise<{ queued: true; position: number; agent?: string; name?: string }>;
	/** What is waiting in an agent's queue: yours, or another's. */
	queue(agentId?: string): Promise<{ from: string; fromName: string; task: string; boards: string[]; at: number }[]>;
	/** The URL of a board, for a Playwright screenshot. */
	url(path: string): Promise<string>;
	/** A file on disk -> the URL a board should embed. */
	resolve(file: string): Promise<string>;
	/**
	 * Servers on this machine, forwarded through Decks so a board can frame them: read with nothing, {
	 * open: port, label } to forward one, { close: port } to stop. `node` passes the path on; `rnode`
	 * strips it.
	 */
	ports(change?: { open?: number; close?: number; label?: string }): Promise<{ port: number; label?: string; by?: string; at: number; node: string; rnode: string }[]>;
	/** The time where the person is. */
	now(): Promise<{ iso: string; timezone: string; words: string; epoch: number }>;
	pen: {
		/**
		 * Your stage's drawing: every item as saved, plus its `box` on the stage. With `path`, any .pen
		 * file ("frames/ui/button", "canvases/<name>/canvas.pen").
		 */
		read(path?: string): Promise<{ stage?: string; file: string; ref?: string; version: string; error?: string; children: unknown[] }>;
		/**
		 * Edit your stage's drawing, or with `path` any .pen file; the edits apply together or not at all.
		 * A `box` places an item on the stage.
		 */
		edit(edits: PenEdit[], options?: { path?: string }): Promise<{ rev?: number; file?: string; ref?: string; results: { op: string; id: string; box?: Box; note?: string }[] }>;
		/**
		 * A new .pen file at `path` ("frames/ui/button"), with `item` as its one reusable item. One in
		 * frames/ is placed on any stage with { type: "ref", ref }.
		 */
		create(path: string, item?: PenItem): Promise<{ file: string; ref?: string; id: string }>;
		/**
		 * Save an item of your stage as a frame file at `path` in frames/, and put a ref to it in its place
		 * (`replace: false` leaves the stage alone).
		 */
		save(id: string, path: string, options?: { replace?: boolean }): Promise<{ frame: string; ref: string; replaced: boolean; overwrote: boolean }>;
		/** The path of your stage's .pen file, to edit it by hand instead. */
		file(): Promise<string>;
	};
	apps: {
		/** Every app in the deck's apps/ folder, with its status. */
		list(): Promise<AppState[]>;
		/** One app's state. */
		status(name: string): Promise<AppState>;
		/**
		 * Make an app folder from a starter ("static" default, "node", "solid", "react", "next"), and its
		 * board.
		 */
		create(name: string, options?: { starter?: "static" | "node" | "solid" | "react" | "next"; title?: string }): Promise<{ name: string; kind: AppKind; folder: string; files: string[]; board: string; url: string; next: string }>;
		/** The board for an app whose folder you wrote yourself. */
		board(name: string): Promise<string>;
		/** Build an app; waits up to fifteen seconds, and `pending` means ask status later. */
		build(name: string): Promise<AppOutcome>;
		/** Start an app; waits up to fifteen seconds. */
		run(name: string): Promise<AppOutcome>;
		/** Stop an app. */
		stop(name: string): Promise<{ stopped: boolean }>;
		/** After you change a server app's code: stop it and start it again. Its board reloads by itself. */
		restart(name: string): Promise<AppOutcome>;
		/** An app's log lines. */
		logs(name: string, options?: { tail?: number }): Promise<string[]>;
		/**
		 * The app opened in the server's browser: what fit is to a board. Read `verdict`; `file` is a
		 * picture.
		 */
		check(name: string): Promise<{ verdict: string; url?: string; title?: string; errors: string[]; failed?: string[]; words?: number; file?: string }>;
	};
	web: {
		/** Whether the person is sharing a Chrome tab through the Decks extension, and which. */
		status(): Promise<{ paired: boolean; connected: boolean; tab?: { title: string; url: string }; pending?: { id: string; text: string }; closed?: string }>;
		/** A code to pair the Decks extension. */
		pairing(): Promise<{ code: string; path: string; note: string }>;
		/** A fresh pairing code. */
		repair(): Promise<{ code: string }>;
		/** The board that shows the shared tab. */
		board(): Promise<string>;
		/** Open an address in the shared tab. */
		open(url: string): Promise<{ url: string; title: string }>;
		/**
		 * The shared page: address, title, and an accessibility tree that names every field and button with
		 * a [ref=e42]. References die when the tab navigates.
		 */
		read(): Promise<{ url: string; title: string; snapshot: string; truncated?: boolean }>;
		/** A picture of the shared tab. */
		screenshot(options?: { full?: boolean }): Promise<{ file: string; width: number; height: number }>;
		/** Type into a field. Never passwords or codes. */
		fill(field: WebTarget, text: string): Promise<{ field: string }>;
		/** Pick an option in a select. */
		select(field: WebTarget, option: string): Promise<{ field: string; option: string }>;
		/** Click a button or link. */
		click(what: WebTarget): Promise<{ clicked: string }>;
		/** Press a key. */
		press(key: string): Promise<{ pressed: string }>;
		/** Submit a form; asks the person first and may come back with allowed: false. */
		submit(what?: WebTarget, options?: { ask?: boolean }): Promise<{ submitted: string; allowed: boolean }>;
		/** Stop driving the shared tab. */
		stop(): Promise<void>;
	};
}

/** Something Decks said went wrong: a refused call, a verb that threw, or no Decks at all. */
export declare class DecksError extends Error {
	/** The HTTP status Decks answered with, when it answered. */
	status?: number;
	/** The notes the verb added before it failed. */
	notes: string[];
}

export interface ConnectOptions {
	/** Decks' address, as in http://127.0.0.1:4329. Default: `DECKS_URL`, or a page's own. */
	url?: string;
	/** The agent the calls are for, by id or name. Default: `DECKS_AGENT`. */
	agent?: string;
	/** The app the calls are from. Default: `DECKS_APP`, or the page's app. */
	app?: string;
	/** An opencode session, which Decks maps to its agent. Default: `DECKS_SESSION`. */
	session?: string;
	/** Where the notes a verb adds go. Default: stderr in Node, nowhere in a page. */
	notes?: (lines: string[]) => void;
	/** A fetch to use instead of the global one. */
	fetch?: typeof fetch;
}

export type AgentSpec = Exclude<Parameters<Verbs["send"]>[0], string>;
export type Work = Parameters<Verbs["send"]>[1];

export interface Decks extends Verbs {
	/** Where this connection reaches Decks. (`url` is the verb that gives a board's address.) */
	readonly address: string;
	/** Call a verb by its name in the table, and get its value, notes and pictures. */
	call(verb: string, args?: unknown[]): Promise<{ value: unknown; notes: string[]; images?: Array<{ data: string; mimeType: string }> }>;
	/** The same verbs, for code written when they lived under `stage`. */
	readonly stage: Verbs;
	/** Hand work to the agent with this name, making it from the spec first when there is none. */
	sendTo(agent: AgentSpec, work: Work | string): Promise<{ queued: true; position: number; name: string; made: boolean; agent?: string }>;
}

/** A connection to Decks; with nothing passed, the one the environment or the page names. */
export declare function connect(options?: ConnectOptions): Decks;

/** A connection from the environment, made on first use. */
export declare const decks: Decks;

/** Every verb's name and its parameters, `?` for optional and `...` for a list of paths. */
export declare const VERBS: ReadonlyArray<readonly [string, readonly string[]]>;
