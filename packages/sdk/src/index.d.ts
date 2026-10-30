// Generated from packages/api by scripts/gen-sdk.mjs. Edit the table there, then run the script.
/**
 * Anything on a canvas: a note, text, a shape, an arrow, a frame, a ref, or a card, with its own
 * pen.dev fields and its `box`. A card is { type: "card", card: <path>, width? }, or { type:
 * "card", html, title? } to write one; an old board reads as { type: "board", board: <path> }.
 */
export type Item = { type: string; id?: string; card?: string; html?: string; title?: string; board?: string; box?: Box; children?: unknown[]; [key: string]: unknown };
/** A box on a canvas: both corners, so an edge is never a sum. */
export type Box = { x1: number; y1: number; x2: number; y2: number };
/** A top-left corner on a canvas: { x1, y1 }, or { x, y }. */
export type Corner = { x1: number; y1: number } | { x: number; y: number };
/** A width, a height, or both. */
export type Size = { w?: number; h?: number };
/** One change in a batch: the same as the call of that name, with the item or id in the op. */
export type CanvasOp = { op: "insert"; item: Item; at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number } | { op: "update"; id: string; set?: Record<string, unknown>; at?: Corner; size?: Size } | { op: "replace"; id: string; item: Item } | { op: "delete"; id: string } | { op: "move"; id: string; at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number } | { op: "copy"; id: string; as?: string; at?: Corner; parent?: string | null } | { op: "variables"; set: Record<string, unknown>; themes?: Record<string, string[]> | null };
/**
 * An edit to a .pen file, as the old pen.edit took it. Items are named by id; one inside an
 * instance by its path, "card-1/label".
 */
export type PenEdit = { op: "insert"; node: PenItem; parent?: string | null; index?: number; box?: { x1?: number; y1?: number; x2?: number; y2?: number } } | { op: "update"; id: string; set?: Record<string, unknown>; box?: { x1?: number; y1?: number; x2?: number; y2?: number } } | { op: "replace"; id: string; node: PenItem } | { op: "delete"; id: string } | { op: "move"; id: string; parent?: string | null; index?: number; box?: { x1?: number; y1?: number; x2?: number; y2?: number } } | { op: "copy"; id: string; parent?: string | null; index?: number; box?: { x1?: number; y1?: number; x2?: number; y2?: number }; as?: string } | { op: "variables"; set: Record<string, unknown>; themes?: Record<string, string[]> | null };
/** One item of a pen.dev `.pen` document: a `type`, an `id`, and pen's own fields. */
export type PenItem = { type: string; id?: string; children?: unknown[]; [key: string]: unknown };
/** What the browser measured while fitting a board. */
export type Fit = { board: string; canvas: string; w: number; h: number; notes: string };
/** A saved image of a canvas, or of part of it. */
export type Screenshot = { file: string; width: number; height: number; box: Box; how?: string; note?: string };
/**
 * A canvas and who has it open. `name` is its folder (canvases/<name>/, or shared/<owner>/<canvas>
 * for one a friend shared, in shared/canvases/) and never changes; `title` is what the person calls
 * it. `shared` says who shared a friend's canvas and whether you may edit it; `studio` is the
 * Studio canvas it syncs with.
 */
export type Canvas = { name: string; title: string; open: string[]; boards: number; shared?: { owner: string; role: "edit" | "view"; studio?: string }; studio?: string };
/** A board file in the deck. `title` is the finding it states. */
export type Board = { path: string; title: string; lastWrittenBy?: string };
/**
 * A board on one canvas: where it sits and how big it is there. `clipped` means its content runs
 * past that box.
 */
export type Placement = { board: string; canvas: string; box: Box; clipped?: boolean };
/**
 * Who works. `canvas` is the agent's home canvas; `state` and `queued` say what it is doing and how
 * much is waiting for it.
 */
export type Agent = { id?: string; name: string; avatar?: string; color?: string; kind?: string; workspace?: string; tags: string[]; canvas?: string; state?: string; queued?: number; model?: string; thinking?: string; mode?: string; avatarChanged?: string };
/**
 * A hand-off in an inbox: who sent it, the task, the boards it names, when, and whether they want a
 * reply.
 */
export type Message = { from: string; task: string; boards: string[]; at: number; reply?: boolean };
/** Where a screen looks on a canvas, and its zoom (1 is life size). */
export type Camera = { x: number; y: number; zoom: number };
export type Point = { x: number; y: number };
export type AppState = { name: string; title: string; kind: AppKind; status: "stopped" | "installing" | "building" | "starting" | "running" | "asleep" | "broken"; url: string; board: string; port?: number; error?: string; seenAt?: number; at?: number; version?: number };
export type AppKind = "static" | "build" | "server";
export type AppOutcome = { ok: boolean; status: "stopped" | "installing" | "building" | "starting" | "running" | "asleep" | "broken"; ms: number; errors: string[]; pending?: true };
/** A field or button: its label, { ref: "e42" } from read, or { name, nth }. */
export type WebTarget = string | { ref: string } | { name: string; nth?: number };
/** A board as the old `boards` call has it, placed on the caller's canvas. */
export type PlacedBoard = { path: string; title: string; x: number; y: number; w: number; h: number; box: Box; content?: { w: number; h: number }; clipped?: boolean; inContext: string[]; lastWrittenBy?: string };

/** Every call Decks answers: the new names, and the old ones kept for one release (marked deprecated). */
export interface Verbs {
	/**
	 * The canvas a call means when it names none: your home canvas for an agent, the card's canvas for
	 * a card's button, the canvas on screen for the person. Asked, never set.
	 */
	here(): Promise<Canvas>;
	/**
	 * Forward a local server so a card can frame it: read with nothing, { open: port, label } to
	 * forward one, { close: port } to stop. `node` passes the path on; `rnode` strips it.
	 */
	ports(change?: { open?: number; close?: number; label?: string }): Promise<{ port: number; label?: string; by?: string; at: number; node: string; rnode: string }[]>;
	/** The time where the person is. */
	now(): Promise<{ iso: string; timezone: string; words: string; epoch: number; [key: string]: unknown }>;
	/**
	 * Old name: write a blank board and place it on your canvas at `at`. @deprecated Use
	 * decks.board.create, then decks.canvas.insert.
	 */
	newBoard(options: { title: string; w?: number; h?: number; at?: Corner }): Promise<string>;
	/** Old name: size a board's height to its content on a canvas. @deprecated Use decks.canvas.fit. */
	fit(path: string, options?: { canvas?: string; margin?: number }): Promise<{ path: string; w: number; h: number; content?: { w: number; h: number; page?: number } }>;
	/** Old name: set a board's size outright. @deprecated Use decks.canvas.update(board, { size }). */
	resize(path: string, size: { w?: number; h?: number }): Promise<{ path: string; w: number; h: number }>;
	/** Old name: claim boards as your work. @deprecated Use decks.agent.claim. */
	report(path: string | string[]): Promise<{ reported: string[] }>;
	/** Old name: reload a board's page. @deprecated Use decks.view.reload({ board }). */
	reload(path: string): Promise<void>;
	/**
	 * Old name: every board, placed as your canvas has them. @deprecated Use decks.canvas.read, or
	 * decks.board.list.
	 */
	boards(): Promise<PlacedBoard[]>;
	/**
	 * Old name: put boards on your canvas and move the camera to them. @deprecated Use
	 * decks.canvas.insert({ type: "board", board }) to place it, then decks.view.focus.
	 */
	show(target: string | string[], options?: { fit?: "board" | "all"; highlight?: string; animate?: boolean; at?: Corner }): Promise<{ shown: string[] }>;
	/** Old name: take boards off your canvas. @deprecated Use decks.canvas.delete. */
	hide(path: string | string[]): Promise<void>;
	/** Old name: move a board on your canvas. @deprecated Use decks.canvas.move(board, { at }). */
	move(path: string, at: Point): Promise<PlacedBoard>;
	/** Old name: a labelled dot on a board. @deprecated Use decks.view.cursor. */
	cursor(path: string, at: Point | null): Promise<void>;
	/**
	 * Old name: read the camera, or move it with { x, y, zoom }. @deprecated Use decks.view.camera to
	 * read, decks.view.move to move.
	 */
	camera(at?: { x: number; y: number; zoom: number }, options?: { animate?: boolean }): Promise<{ x: number; y: number; zoom: number } | null>;
	/** Old name: the room the screen has. @deprecated Use decks.view.viewport. */
	viewport(): Promise<{ width: number; height: number } | null>;
	/** Old name: a picture of your canvas or part of it. @deprecated Use decks.canvas.screenshot. */
	screenshot(options?: { of?: string | string[] | { x1?: number; y1?: number; x2?: number; y2?: number }; scale?: number; format?: "png" | "jpeg" | "pdf"; to?: string; scheme?: "light" | "dark"; live?: boolean }): Promise<{ file: string; width: number; height: number; box: Box; how?: string; note?: string }>;
	/** Old name: every canvas and who has it open. @deprecated Use decks.canvas.list. */
	stages(): Promise<{ name: string; title: string; open: string[]; boards: number; mine?: true }[]>;
	/**
	 * Old name: make another canvas your home and show it. @deprecated Use decks.agent.update({ canvas
	 * }), then decks.view.goto.
	 */
	open(name: string): Promise<{ stage: string; boards: string[] }>;
	/**
	 * Old name: make an empty canvas and move to it. @deprecated Use decks.canvas.create, then
	 * decks.agent.update({ canvas }).
	 */
	newStage(title: string): Promise<{ stage: string }>;
	/**
	 * Old name: name your canvas, or read its name. @deprecated Use decks.canvas.rename, or
	 * decks.here() to read.
	 */
	title(title?: string): Promise<{ stage: string; title: string }>;
	/**
	 * Old name: who you are, read with nothing, changed with a patch. @deprecated Use decks.agent.me to
	 * read, decks.agent.update to change.
	 */
	me(patch?: { name?: string; avatar?: { emoji: string } | { svg: string }; tags?: string[]; workspace?: string }): Promise<{ name: string; avatar?: string; color: string; tags?: string[]; workspace?: string; avatarChanged?: string }>;
	/** Old name: every agent. @deprecated Use decks.agent.list. */
	agents(options?: { filter?: { workspace?: string } }): Promise<{ id: string; name: string; me: boolean; state: string; kind: string; tags: string[]; workspace?: string; queued: number }[]>;
	/**
	 * Old name: queue work for an agent, making it first from { name, kind }. @deprecated Use
	 * decks.agent.queue (and decks.agent.create to make the agent first; decks.agent.send now delivers
	 * at once).
	 */
	send(to: string | { name: string; kind?: "pi" | "claude" | "opencode" | "opencode2" | "antigravity"; model?: string; thinking?: string; mode?: "manual" | "acceptEdits" | "plan" | "auto"; tags?: string[]; workspace?: string }, work: { task: string; boards?: string[]; reply?: boolean }): Promise<{ queued: true; position: number; agent?: string; name?: string }>;
	/** Old name: what is waiting in an agent's queue. @deprecated Use decks.agent.inbox. */
	queue(agentId?: string): Promise<{ from: string; fromName: string; task: string; boards: string[]; at: number }[]>;
	/** Old name: a board's address. @deprecated Use decks.board.url. */
	url(path: string): Promise<string>;
	/** Old name: a file's address for a board. @deprecated Use decks.file.url. */
	resolve(file: string): Promise<string>;
	canvas: {
		/**
		 * Everything on the canvas, cards included, each with its box; an item cut by a frame round it that
		 * clips says `clipped: "partly"` (some of its box is outside) or `"fully"` (none is inside), as
		 * does a text whose words overflow its fixed width and height. A card is { type: "card", card:
		 * <path>, box } (an old board, { type: "board", board }); every other item has pen.dev's own
		 * fields. Read it before placing anything. `frame: "frames/<name>"` reads a frame file instead, its
		 * items in its own space; this and the item calls below take `frame` in place of `canvas`, and a
		 * change to a frame shows on every canvas placing it. `of` (an id, a board's path, or an id inside
		 * an instance such as "card-1/label") reads that one item and what is in it; `depth` keeps that
		 * many levels of children (0: the items alone), and an item whose children were left out says how
		 * many in `childCount`. `resolve` works values out instead of reading them as written, each off by
		 * default: `variables` puts each $name's value in, for the light theme or `theme` ({ mode: "dark"
		 * }); `instances` reads a ref as its expanded copy, overrides applied, its items under `children`
		 * with ids "ref/child"; `geometry` adds a path's or shape's `outline`, an SVG path in its own space
		 * (0,0 its top-left corner).
		 */
		read(options?: { canvas?: string; frame?: string; of?: string; depth?: number; resolve?: { variables?: boolean; instances?: boolean; geometry?: boolean }; theme?: Record<string, string> }): Promise<{ canvas?: string; frame?: string; title?: string; file?: string; version: string; rev?: number; error?: string; variables?: Record<string, unknown>; themes?: Record<string, unknown>; items: Item[] }>;
		/**
		 * Where a box of `size` fits: the top-left corner nearest the middle of everything on the canvas
		 * where the box, grown by `margin` (160) on every side, touches no top-level item (arrows aside).
		 * With `near` (an id or a card's path) it starts on that item's `side` (right; or below, left,
		 * above), tops or lefts aligned as beside and below do, and steps outward past whatever is in the
		 * way. Nothing is placed: give the corner to insert or move as `at`.
		 */
		space(size: { w: number; h: number }, options?: { canvas?: string; frame?: string; near?: string; side?: "right" | "below" | "left" | "above"; margin?: number }): Promise<{ x1: number; y1: number }>;
		/**
		 * Add an item to the canvas. A card is { type: "card", card: <its folder or index.html> }, or {
		 * type: "card", html, title?, width?, height? } to write one and place it; anything else is a
		 * pen.dev item (note, text, frame, rectangle, ellipse, arrow, ref). Say where: `at` is its top-left
		 * corner; `beside` or `below` (an item's id or a card's path) puts it 160 px clear of that item,
		 * tops or lefts aligned; `parent` and `index` put it inside a frame. An item with a `name` and no
		 * `id` takes its name as its id ("Pricing card" → pricing-card, then pricing-card-2), its children
		 * too; the answer has every id. Colour it with Decks's adaptive colours so it reads in light and
		 * dark: "$decks-ink" (words, icons), "$decks-muted", "$decks-line" (arrows), "$decks-shape",
		 * "$decks-shape-2", "$decks-frame" and "$decks-frame-line", "$decks-figure" and
		 * "$decks-figure-line", "$decks-card" and "$decks-card-line", "$decks-red", "$decks-orange",
		 * "$decks-yellow", "$decks-green", "$decks-blue", "$decks-purple" (accents), and soft fills
		 * "$decks-yellow-fill", "$decks-orange-fill", "$decks-red-fill", "$decks-purple-fill",
		 * "$decks-blue-fill", "$decks-green-fill", "$decks-gray-fill"; the insert defines any the canvas
		 * lacks. A hex stays the same in both; a top-level rectangle, ellipse, icon, empty frame or arrow
		 * given no colour gets the tools' $decks-* colours.
		 */
		insert(item: Item, options?: { canvas?: string; frame?: string; at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number }): Promise<Item>;
		/**
		 * Change an item's fields (`set`), its place (`at`) or its size (`size`). A card can be named by
		 * its path; its size here is its size on this canvas.
		 */
		update(id: string, change: { set?: Record<string, unknown>; at?: Corner; size?: Size }, options?: { canvas?: string; frame?: string }): Promise<Item>;
		/** Swap a whole item for another, keeping its id and its place unless the new one says otherwise. */
		replace(id: string, item: Item, options?: { canvas?: string; frame?: string }): Promise<Item>;
		/** Take an item off the canvas. A card's folder stays in the deck. */
		delete(id: string, options?: { canvas?: string; frame?: string }): Promise<{ deleted: string }>;
		/**
		 * Move an item: to a corner (`at`), 160 px clear of another (`beside`, `below`), or into a frame
		 * (`parent`, `index`; null for the canvas itself).
		 */
		move(id: string, options?: { canvas?: string; frame?: string; at?: Corner; beside?: string; below?: string; parent?: string | null; index?: number }): Promise<Item>;
		/** Duplicate an item, with a new id or the one in `as`, at `at` or in `parent`. */
		copy(id: string, options?: { canvas?: string; frame?: string; as?: string; at?: Corner; parent?: string | null }): Promise<Item>;
		/**
		 * Set the canvas's colour tokens, per theme such as light and dark: { accent: { type: "color",
		 * value: [{ value: "#e5484d" }, { value: "#ff6369", theme: { mode: "dark" } }] } }, with { themes:
		 * { mode: ["light", "dark"] } } when the canvas has no light/dark axis yet (one it has, such as
		 * Mode: ["Light", "Dark"], is keyed as it is); then use it as "$accent". null removes one. Decks's
		 * own adaptive colours ($decks-ink, $decks-line, … see canvas.insert) need no call: an edit that
		 * uses one defines it.
		 */
		variables(set: Record<string, unknown>, options?: { canvas?: string; frame?: string; themes?: Record<string, string[]> | null }): Promise<{ variables: Record<string, unknown>; themes?: Record<string, unknown> }>;
		/**
		 * Several of the changes above in one call, applied together or not at all. Each op is the call of
		 * that name with its item or id inside: { op: "insert", item, beside }, { op: "update", id, set },
		 * { op: "delete", id }. A later op can be beside an item an earlier one made. pen.dev's own form, {
		 * op: "insert", node, box }, is taken too. This and insert, update and replace add a note for each
		 * field an item's type does not have, and each value Decks keeps for pen.dev but does not draw
		 * (shader and mesh_gradient fills, background_blur and shader effects, inner shadows on anything
		 * but a box or a whole ellipse, script items); nothing is refused for it.
		 */
		batch(ops: (CanvasOp | PenEdit)[], options?: { canvas?: string; frame?: string }): Promise<Item[]>;
		/**
		 * Take back the person's last edit to the drawing, or put it back ("undo" or "redo"); refused, with
		 * why, when an agent or the file changed the drawing since. Answers whether a step is left each
		 * way.
		 */
		step(direction: "undo" | "redo", options?: { canvas?: string }): Promise<{ undo: boolean; redo: boolean }>;
		/**
		 * Set a card's height from its content, measured at the width it has on this canvas; it must be on
		 * it. `notes` say what the browser found: the height, the word count, the smallest type, content
		 * wider than the card, boxes that cut off their content, and views that break when a control is
		 * pressed. Use it instead of a screenshot.
		 */
		fit(card: string, options?: { canvas?: string; margin?: number }): Promise<Fit>;
		/**
		 * Save an item as a reusable frame in frames/ ("frames/ui/card"), and put a ref to it in its place
		 * (`replace: false` leaves the canvas alone).
		 */
		save(id: string, frame: string, options?: { canvas?: string; replace?: boolean }): Promise<{ frame: string; ref: string; replaced: boolean; overwrote?: boolean }>;
		/**
		 * A picture of the canvas, or part of it: drawing and cards together, saved to `file`. `of` is an
		 * item's id, a card's path, a list of them, or a box; one card's path alone is that card as the
		 * person's browser has it now, without the drawing round it. A .pen file's path pictures that file
		 * whole. The picture is the area at one pixel per canvas unit, shrunk until its long side is at
		 * most 1,600 px; `scale` multiplies that, so `scale: 2` of a 1,000 px card is 2,000 px wide and of
		 * a 7,500 px row is 3,200. `format` "jpeg" or "pdf", and `to` a path in the deck
		 * (`exports/plan.png`), make a file to hand on. Drawn natively over each card's current picture
		 * (`how` "native"), or in the browser with live cards when asked (`live: true`) or when it must be:
		 * math, a picture it cannot load, a card not yet pictured, a PDF (`how` "chromium: <why>").
		 */
		screenshot(options?: { canvas?: string; of?: string | string[] | { x1?: number; y1?: number; x2?: number; y2?: number }; scale?: number; format?: "png" | "jpeg" | "pdf"; to?: string; scheme?: "light" | "dark"; live?: boolean }): Promise<Screenshot>;
		/**
		 * The items `of` names (an id or a list, each with what is in it) as one self-contained web page in
		 * the deck, at `to` (default `exports/<id>.html`). A frame with a layout is a flexbox (gap,
		 * padding, justifyContent, alignItems; fill_container is flex 1 or stretch, fit_content the
		 * content's size), a number is px, and a frame with no layout holds its children where they sit;
		 * text keeps its font, size, weight, line height, letter spacing, colour and wrapping; fills
		 * (colours, gradients, pictures by relative address), strokes, corners, outer shadows and opacity
		 * are CSS; icons, paths and shapes are inline SVG; variables are CSS custom properties, with the
		 * dark theme's values under prefers-color-scheme. `format` "html" (the default) writes inline
		 * styles; "tailwind" the same page as Tailwind classes, with Tailwind's CDN script.
		 */
		export(of: string | string[], options?: { canvas?: string; frame?: string; format?: "html" | "tailwind"; to?: string }): Promise<{ file: string }>;
		/**
		 * What the person calls this canvas: a few words for what is on it, that a person would look for.
		 * The folder never changes.
		 */
		rename(title: string, options?: { canvas?: string }): Promise<Canvas>;
		/** The canvas's .pen file, to edit by hand instead. */
		file(options?: { canvas?: string }): Promise<string>;
		/** Every canvas in the deck, and which agents have it open. */
		list(): Promise<Canvas[]>;
		/**
		 * A new, empty canvas, named from a title. Nobody moves to it: agent.update({ canvas }) makes it
		 * your home, view.goto shows it.
		 */
		create(title: string): Promise<Canvas>;
		/**
		 * Make your own copy of a canvas a friend shared with you (`canvas`, shared/<owner>/<canvas>): its
		 * drawing, cards, frames and files copied into a new canvases/<name>/ of yours, titled "Copy of …"
		 * (or `title`). The copy is yours and syncs as your own; it never changes theirs. How a canvas
		 * shared with you to view is changed.
		 */
		copyShared(options?: { canvas?: string; title?: string }): Promise<Canvas>;
	};
	card: {
		/** Every card in the deck, placed or not. */
		list(): Promise<Board[]>;
		/**
		 * Write a blank card in a canvas's own cards/ (`canvas`, or your own canvas) and return it: a
		 * folder, cards/<title>/, holding its index.html and whatever it keeps beside it (card.css,
		 * chart.js, data.json). Placing it is the canvas's job (decks.canvas.insert({ type: "card", card:
		 * path }, { beside })). The title is the finding, as a sentence; the card is a piece of HTML you
		 * design, drawn in the canvas's own page.
		 */
		create(options: { title: string; w?: number; h?: number; canvas?: string }): Promise<Board>;
		/** A card's path and title (the finding it states), and who last wrote it. */
		get(card: string): Promise<Board>;
		/** The canvas this card is on, with its place and size there. */
		canvases(card: string): Promise<Placement[]>;
		/** The card's address as a page of its own, for a browser such as Playwright. */
		url(card: string): Promise<string>;
	};
	frame: {
		/**
		 * A new reusable .pen file at `path` ("frames/ui/button"), with `item` as its one reusable item, in
		 * your canvas's own frames/. Placed on that canvas with { type: "ref", ref }; read and edited with
		 * the canvas item calls given { frame: ref }. A frame from the deck's own frames/ placed on a
		 * canvas is copied into it.
		 */
		create(path: string, item?: PenItem): Promise<{ file: string; ref?: string; id: string }>;
	};
	file: {
		/** A file on disk, as the address a card embeds. */
		url(file: string): Promise<string>;
	};
	agent: {
		/** You: name, avatar, colour, workspace, tags and home canvas. */
		me(): Promise<Agent>;
		/**
		 * Change your name, avatar (an <svg> with xmlns and a viewBox, or { emoji }), workspace (the
		 * project) or tags (up to four, for what you are doing now), or your home canvas: the one the app
		 * shows beside you, and what decks.here() means for a call that names none. Set the first four
		 * early in every session.
		 */
		update(patch: { name?: string; avatar?: { emoji: string } | { svg: string }; tags?: string[]; workspace?: string; canvas?: string }): Promise<Agent>;
		/** Say these cards carry your work, without showing them: you become their writer. */
		claim(boards: string | string[]): Promise<string[]>;
		/**
		 * Hand-offs waiting for you from other agents. Changes to a canvas need no watching: they reach you
		 * with your next message.
		 */
		inbox(): Promise<Message[]>;
		/**
		 * Every agent, or the ones on one project (`workspace`), with what each is doing and how much waits
		 * for it.
		 */
		list(options?: { workspace?: string }): Promise<Agent[]>;
		/** Another agent, by name or id: kind, workspace, tags, state, home canvas. */
		get(name: string): Promise<Agent>;
		/**
		 * Deliver now: the message reaches the agent in the turn it is running and steers it, where its
		 * runtime can take a message mid-turn; an idle agent starts a turn on it. A runtime that cannot be
		 * steered mid-turn gets it queued, and the answer says delivered: false.
		 */
		send(name: string, message: { task: string; boards?: string[] }): Promise<{ delivered: boolean; turn: "running" | "new" | "queued"; position?: number; note?: string }>;
		/**
		 * Put work in the agent's queue, taken up after the turn it is running. Returns at once; with
		 * `reply: true` its report comes back to you.
		 */
		queue(name: string, work: { task: string; boards?: string[]; reply?: boolean }): Promise<{ queued: true; position: number }>;
		/**
		 * Start a new agent, then send or queue it work. `kind` is the runtime ("claude", "pi", "opencode",
		 * "opencode2", "antigravity"; yours when left out), `model` any model that kind runs, `thinking`
		 * how hard it thinks as that kind names it, `mode` its permission mode, `canvas` its home canvas (a
		 * new one when left out).
		 */
		create(spec: { name: string; kind?: "pi" | "claude" | "opencode" | "opencode2" | "antigravity"; model?: string; thinking?: string; mode?: "manual" | "acceptEdits" | "plan" | "auto"; workspace?: string; tags?: string[]; canvas?: string }): Promise<Agent>;
	};
	view: {
		/** Bring the person's screen to a canvas. Only the view moves; nobody's home canvas changes. */
		goto(canvas: string): Promise<{ canvas: string; moved: boolean; note?: string }>;
		/**
		 * Move the camera to a card or a drawn item on a canvas (a list frames them all), optionally
		 * outlining one data-id block inside a card. `animate: true` glides.
		 */
		focus(target: string | string[], options?: { canvas?: string; highlight?: string; animate?: boolean }): Promise<{ canvas: string; target: string | string[]; deferred?: string }>;
		/** Where the person's screen is looking, and its zoom. */
		camera(): Promise<Camera>;
		/** Move the person's camera outright: { x, y, zoom }, zoom 1 is life size. */
		move(camera: { x: number; y: number; zoom: number; animate?: boolean }): Promise<Camera>;
		/** The room the screen has, in CSS pixels, or null when no screen has said. */
		viewport(): Promise<{ width: number; height: number } | null>;
		/** A labelled dot on a card, at the card's coordinates; null removes it. */
		cursor(board: string, at: Point | null): Promise<void>;
		/**
		 * Reload the card in every browser and iPad showing it on that canvas; with no `canvas`, on every
		 * canvas it is on. For a change the watcher cannot see (a file it fetches, data from outside). No
		 * file changes.
		 */
		reload(options: { board: string; canvas?: string }): Promise<{ reloaded: number }>;
	};
	apps: {
		/** Every app in the deck's apps/ folder, with its state. */
		list(): Promise<AppState[]>;
		/** One app's state. */
		status(name: string): Promise<AppState>;
		/**
		 * A new app folder from a starter ("static" default, "node", "solid", "react", "next"), with its
		 * board.
		 */
		create(name: string, options?: { starter?: "static" | "node" | "solid" | "react" | "next"; title?: string }): Promise<{ name: string; kind: AppKind; folder: string; files: string[]; board: string; url: string; repo?: { branch: string; head: string }; next: string }>;
		/**
		 * Its git repository, made now with everything committed if the folder is not one yet: branch, last
		 * commit, changed files, origin.
		 */
		repo(name: string): Promise<{ branch: string; head: string; dirty?: number; remote?: string }>;
		/**
		 * Take in an app from an https:// or git@host:path address, with its board. Nothing is installed or
		 * run.
		 */
		clone(url: string, options?: { name?: string; title?: string }): Promise<{ name: string; kind: AppKind; folder: string; board: string; url: string; repo: { branch: string; head: string; remote?: string }; next: string }>;
		/** The board for an app whose folder you wrote yourself. */
		board(name: string): Promise<string>;
		/** Build it, waiting up to 15 s; `pending` means ask its status later. */
		build(name: string): Promise<AppOutcome>;
		/** Start it, waiting up to 15 s. */
		run(name: string): Promise<AppOutcome>;
		/** Stop it. */
		stop(name: string): Promise<{ stopped: boolean }>;
		/** Stop and start again after a code change. Its board reloads by itself. */
		restart(name: string): Promise<AppOutcome>;
		/**
		 * Delete an app: stop it, move its folder to the deck's trash (.decks/trash/apps), and delete its
		 * boards. The folder can be moved back by hand.
		 */
		delete(name: string): Promise<{ deleted: string; trash: string; boards: string[] }>;
		/** Its recent output. */
		logs(name: string, options?: { tail?: number }): Promise<string[]>;
		/**
		 * Open it in the server's browser and say what is wrong: what fit is to a board. Read `verdict`;
		 * `file` is a picture.
		 */
		check(name: string): Promise<{ verdict: string; url?: string; title?: string; errors: string[]; failed?: string[]; words?: number; file?: string }>;
	};
	web: {
		/** Whether the person is sharing a Chrome tab through the Decks extension, and which. */
		status(): Promise<{ paired: boolean; connected: boolean; tab?: { title: string; url: string }; pending?: { id: string; text: string }; closed?: string }>;
		/** A code to pair the Decks extension. */
		pairing(): Promise<{ code: string; path: string; note: string }>;
		/** Pair the extension again: a fresh code. */
		repair(): Promise<{ code: string }>;
		/** A board showing the shared tab. */
		board(): Promise<string>;
		/** Go to an address in the shared tab. */
		open(url: string): Promise<{ url: string; title: string }>;
		/**
		 * The page as a tree of fields and buttons, each with a [ref=e42]. References die when the tab
		 * navigates.
		 */
		read(): Promise<{ url: string; title: string; snapshot: string; truncated?: boolean }>;
		/** A picture of the tab. */
		screenshot(options?: { full?: boolean }): Promise<{ file: string; width: number; height: number }>;
		/** Type into a field. Never passwords or codes. */
		fill(field: WebTarget, text: string): Promise<{ field: string }>;
		/** Choose an option in a select. */
		select(field: WebTarget, option: string): Promise<{ field: string; option: string }>;
		/** Click a button or link. */
		click(what: WebTarget): Promise<{ clicked: string }>;
		/** Press a key. */
		press(key: string): Promise<{ pressed: string }>;
		/** Submit a form, asking the person first; may come back with allowed: false. */
		submit(what?: WebTarget, options?: { ask?: boolean }): Promise<{ submitted: string; allowed: boolean }>;
		/** Stop sharing. */
		stop(): Promise<void>;
	};
	studio: {
		/**
		 * Connect this harness to Decks Studio with the key Studio made for it: the deck then syncs there
		 * in the background. Only the person can call it, from a browser paired with this harness.
		 */
		connect(url: string, key: string): Promise<{ connected: boolean; url: string }>;
		/** Whether this harness syncs with Decks Studio, and with which. */
		status(): Promise<{ connected: boolean; url?: string }>;
		/** Stop syncing with Decks Studio and forget the key. Only the person can call it. */
		disconnect(): Promise<{ connected: boolean }>;
	};
	pair: {
		/**
		 * A pairing code for another Decks front end, such as Studio, or a terminal elsewhere (decks login
		 * <code>), to connect to this harness with: six digits, ten minutes, once. Only on the harness's
		 * own machine, where a terminal logs in with decks login and no code; Settings never shows one.
		 */
		code(): Promise<{ code: string; expires: number }>;
	};
	board: {
		/** Every board file in the deck, placed or not. @deprecated Use decks.card.list. */
		list(): Promise<Board[]>;
		/**
		 * Old name: now writes a card. Write a blank board in a canvas's own boards/ (`canvas`, or your own
		 * canvas) and return it; placing it is the canvas's job (decks.canvas.insert({ type: "board",
		 * board: path }, { beside })). The title is the finding, as a sentence; the board is one HTML page
		 * you design. A canvas is a folder that stands alone (canvases/<name>/boards/…), and a board from
		 * anywhere else placed on it is copied in. @deprecated Use decks.card.create.
		 */
		create(options: { title: string; w?: number; h?: number; canvas?: string }): Promise<Board>;
		/**
		 * A board's path and title (the finding it states), and who last wrote it. @deprecated Use
		 * decks.card.get.
		 */
		get(board: string): Promise<Board>;
		/**
		 * The canvas this board is on, with its place and size there: a board in a canvas's folder is on
		 * that canvas alone. For a board in the library (boards/, on no canvas), the canvases that copied
		 * it, each with its copy's path. @deprecated Use decks.card.canvases.
		 */
		canvases(board: string): Promise<Placement[]>;
		/** The board's address, for a browser such as Playwright. @deprecated Use decks.card.url. */
		url(board: string): Promise<string>;
	};
	pen: {
		/**
		 * Old name: your canvas's drawing, or any .pen file by `path`. @deprecated Use decks.canvas.read (a
		 * frame file: decks.canvas.read({ frame })).
		 */
		read(path?: string): Promise<{ stage?: string; file: string; ref?: string; version: string; error?: string; children: unknown[] }>;
		/**
		 * Old name: edit your canvas's drawing, or any .pen file by `path`, all or nothing. @deprecated Use
		 * decks.canvas.batch (or the single calls: insert, update, replace, delete, move, copy, variables;
		 * a frame file with { frame }).
		 */
		edit(edits: PenEdit[], options?: { path?: string }): Promise<{ rev?: number; file?: string; ref?: string; results: { op: string; id: string; box?: Box; note?: string }[] }>;
		/** Old name: a new .pen file in frames/. @deprecated Use decks.frame.create. */
		create(path: string, item?: PenItem): Promise<{ file: string; ref?: string; id: string }>;
		/** Old name: save an item as a frame. @deprecated Use decks.canvas.save. */
		save(id: string, path: string, options?: { replace?: boolean }): Promise<{ frame: string; ref: string; replaced: boolean; overwrote: boolean }>;
		/** Old name: your canvas's .pen file. @deprecated Use decks.canvas.file. */
		file(): Promise<string>;
	};
}

/** Something Decks said went wrong: a refused call, a verb that threw, or no Decks at all. */
export declare class DecksError extends Error {
	/** The HTTP status Decks answered with, when it answered. */
	status?: number;
	/** The notes the verb added before it failed. */
	notes: string[];
	/** Set when a pairing door refused for want of a (working) pairing code. */
	needsCode?: true;
}

export interface ConnectOptions {
	/** Decks' address, as in http://127.0.0.1:4329. Default: `DECKS_URL`, or a page's own. */
	url?: string;
	/**
	 * Who is calling: a token from Decks, sent as `Authorization: Bearer`. Default: `DECKS_TOKEN`
	 * (set in an agent's shell and an app server's environment), else the token `decks login` kept for
	 * this address in `~/.decks/token`, else none.
	 */
	token?: string | (() => string | undefined);
	/** For the person: the canvas they are acting on (`X-Decks-Stage`). A parameter, not who is calling. */
	stage?: string | (() => string | undefined);
	/** For the person: the agent they are talking to (`X-Decks-Agent`). A parameter, not who is calling. */
	agent?: string | (() => string | undefined);
	/** Where the notes a verb adds go. Default: stderr in Node, nowhere in a page. */
	notes?: (lines: string[]) => void;
	/** A fetch to use instead of the global one. */
	fetch?: typeof fetch;
	/** More headers for every call. */
	headers?: Record<string, string>;
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
	/**
	 * Any other door the harness has, with the token: `path` from its root, as in `/api/harness`. A Blob
	 * or bytes go as they are, with their type; any other body as JSON. Answers with the JSON sent back,
	 * or the body `as` a Blob, text, or the Response itself. A refusal throws a DecksError.
	 */
	request<T = any>(path: string, options?: RequestOptions & { as?: "json" }): Promise<T>;
	request(path: string, options: RequestOptions & { as: "blob" }): Promise<Blob>;
	request(path: string, options: RequestOptions & { as: "text" }): Promise<string>;
	request(path: string, options: RequestOptions & { as: "response" }): Promise<Response>;
	/** Whether a Decks answers here, and what it says of itself; open to anyone. */
	hello(): Promise<Hello>;
	/** Pair a page on another site (`POST /api/pair`): a site token bound to the page's origin. `needsCode` on the error wants a code. */
	pairSite(options?: { code?: string; label?: string }): Promise<{ token: string; name: string }>;
	/** Decks Studio connecting this harness (`POST /api/studio/connect`): Studio's address and its key, and a site token back. */
	connectStudio(options: { studio: string; key: string; code?: string; label?: string }): Promise<{ token: string; name: string; [key: string]: unknown }>;
	/** A board's own token for its frame, on canvas `stage`: its calls act as that board. */
	boardToken(path: string, stage?: string): Promise<string>;
	/**
	 * Put a file into the deck's `assets/`, for an agent to read, or with `canvas` into that canvas's own
	 * `files/` (a friend's canvas you may edit included, which syncs it back to them): its deck path. In
	 * the canvas's drawing it is `files/<name>`. A canvas shared with you to view refuses.
	 */
	upload(file: Blob, options?: { name?: string; canvas?: string }): Promise<string>;
	/** Five-minute tickets for pages a frame or tab opens, by decoded request path (`/api/board/boards/a.html`, `/api/f/…`, `/app/<name>/`). Held by this connection too. */
	tickets(paths: string[]): Promise<{ tickets: Record<string, string>; expires: number }>;
	/** The ticket held for a page, while it has a little time left. */
	ticketFor(path: string): string | undefined;
	/** A page's address on the harness, with `ticket` (default: the one held) in it. */
	pageUrl(path: string, ticket?: string): string;
	/** A page's address with a fresh ticket, for a tab about to open it. */
	ticketedUrl(path: string): Promise<string>;
	/** Keep tickets for pages that stay shown: asked at once when wanted, again every four minutes and when the page comes back into view. */
	keepTickets(onChange?: (tickets: Record<string, string>) => void, options?: { every?: number }): { want(paths: string[]): void; stop(): void };
	/**
	 * Every change as Decks broadcasts it (`GET /api/v1/events`), as in `{ type: "board.changed", path, board }`.
	 * `types` keeps only some. With `reconnect` it is opened again after it ends or fails, until a
	 * refusal, which calls `refused`. `done` settles when the stream ends for good; `close` stops it.
	 */
	events(onEvent: (event: { type: string; [key: string]: any }) => void, options?: { types?: string[]; reconnect?: boolean; refused?: () => void }): { close(): void; done: Promise<void> };
}

export interface RequestOptions {
	method?: string;
	body?: unknown;
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

/** What `GET /api/hello` says. */
export interface Hello {
	decks: boolean;
	name?: string;
	/** Whether the token sent still works. */
	paired?: boolean;
	/** Whether pairing from here will want a code. */
	needsCode?: boolean;
}

/** A connection to Decks; with nothing passed, the one the environment or the page names. */
export declare function connect(options?: ConnectOptions): Decks;

/** A connection from the environment, made on first use. */
export declare const decks: Decks;

/** Every verb's name and its parameters, `?` for optional and `...` for a list of paths. */
export declare const VERBS: ReadonlyArray<readonly [string, readonly string[]]>;
