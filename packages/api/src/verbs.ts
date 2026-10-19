import { any, arr, bool, int, lit, nul, num, obj, opt, rec, str, union, type Schema } from "./schema.ts";
import {
	Agent,
	AgentKind,
	AgentMode,
	AppKind,
	AppOutcome,
	AppState,
	Board,
	Box,
	Camera,
	Canvas,
	CanvasOp,
	Corner,
	Fit,
	Item,
	Message,
	PartialBox,
	PenEdit,
	PenItem,
	Place,
	Placement,
	PlacedBoard,
	Point,
	Screenshot,
	Size,
	Sized,
	WebTarget,
} from "./types.ts";

/**
 * Every call Decks answers, declared once.
 *
 * This table is the API. The server makes a route of each entry (`POST /api/v1/<name>`), checks
 * the arguments against `params` before the handler runs, and the SDK is generated from it in its
 * three forms: the TypeScript client, the `decks` command and the MCP server. Adding a call is
 * adding an entry here and its handler on the server; nothing else is written by hand.
 *
 * The calls are named noun then verb (`canvas.insert`, `agent.send`), in the groups of the SDK
 * redesign. Two fields sort them by what a shared canvas cares about:
 *
 * - `touches`: what the call acts on. `deck` is the deck's files (a canvas's .pen file, a board
 *   file, a frame); `screen` is what the person sees in every open Decks page, with no file
 *   changes; `agents` is agent records and messages; `outside` is apps, the shared Chrome tab,
 *   ports and the clock.
 * - `effect`: `change` if it changes what it touches, `read` if it only reads.
 *
 * Calls are stateless: every canvas call takes an optional `canvas`, and left out it means
 * `decks.here()`. No call changes a "current canvas"; `agent.update({ canvas })` changes an
 * agent's home canvas, which is what `here()` answers for that agent.
 *
 * The old names (`ALIASES`) still work for one release, each mapped onto its new call, and every
 * answer through one carries a note naming that call.
 */

export type Effect = "change" | "read";
export type Touches = "deck" | "screen" | "agents" | "outside";
export type Group = "canvas" | "board" | "agent" | "view" | "apps" | "web" | "misc";

export interface Param {
	name: string;
	schema: Schema;
	optional?: boolean;
	/** For a list of paths: on the command line, every remaining word fills it. */
	variadic?: boolean;
}

export interface Verb {
	/** The call's name, dotted for a noun: `canvas.insert`, `agent.send`, `here`. */
	name: string;
	group: Group;
	touches: Touches;
	effect: Effect;
	summary: string;
	params: Param[];
	/** What it answers with; absent when it answers with nothing. */
	result?: Schema;
	/** Set on an old name: the new call (or calls) it maps onto, in words. */
	alias?: string;
}

const p = (name: string, schema: Schema, more: Partial<Param> = {}): Param => ({ name, schema, ...more });
const o = (name: string, schema: Schema, more: Partial<Param> = {}): Param => ({ name, schema, optional: true, ...more });
const paths = (name = "path"): Param => ({ name, schema: union(str(), arr(str())), variadic: true });
/** The `{ canvas }` every canvas call takes last. */
const onCanvas = (more: Record<string, Schema | { optional: Schema }> = {}) => o("options", obj({ canvas: opt(str()), ...more }));
/** The item calls' options: a canvas, or a frame file in frames/ (never both), and whatever else the call takes. */
const onItems = (more: Record<string, Schema | { optional: Schema }> = {}) => o("options", obj({ canvas: opt(str()), frame: opt(str()), ...more }));

const deckRead = { touches: "deck", effect: "read" } as const;
const deckChange = { touches: "deck", effect: "change" } as const;
const screenRead = { touches: "screen", effect: "read" } as const;
const screenChange = { touches: "screen", effect: "change" } as const;
const agentsRead = { touches: "agents", effect: "read" } as const;
const agentsChange = { touches: "agents", effect: "change" } as const;
const outsideRead = { touches: "outside", effect: "read" } as const;
const outsideChange = { touches: "outside", effect: "change" } as const;

const AgentPatch = obj({ name: opt(str()), avatar: opt(union(obj({ emoji: str() }), obj({ svg: str() }))), tags: opt(arr(str())), workspace: opt(str()), canvas: opt(str()) });

export const VERBS: readonly Verb[] = [
	// --- canvas: everything on one canvas, boards included -------------------------------------
	{
		name: "canvas.read",
		group: "canvas",
		...deckRead,
		summary:
			'Everything on the canvas, boards included, each with its box. A board is { type: "board", board: <path>, box }; every other item has pen.dev\'s own fields. Read it before placing anything. `frame: "frames/<name>"` reads a frame file instead, its items in its own space; this and the item calls below take `frame` in place of `canvas`, and a change to a frame shows on every canvas placing it.',
		params: [onItems()],
		result: obj({ canvas: opt(str()), frame: opt(str()), title: opt(str()), file: opt(str()), version: str(), rev: opt(num()), error: opt(str()), variables: opt(rec(true)), themes: opt(rec(true)), items: arr(Item) }),
	},
	{
		name: "canvas.insert",
		group: "canvas",
		...deckChange,
		summary:
			'Add an item to the canvas. A board is { type: "board", board: <path>, width? }; anything else is a pen.dev item (note, text, frame, rectangle, ellipse, arrow, ref). Say where: `at` is its top-left corner; `beside` or `below` (an item\'s id or a board\'s path) puts it 160 px clear of that item, tops or lefts aligned; `parent` and `index` put it inside a frame.',
		params: [p("item", Item), o("options", Place)],
		result: Item,
	},
	{
		name: "canvas.update",
		group: "canvas",
		...deckChange,
		summary: "Change an item's fields (`set`), its place (`at`) or its size (`size`). A board can be named by its path; its size here is its size on this canvas.",
		params: [p("id", str()), p("change", obj({ set: opt(rec(true)), at: opt(Corner), size: opt(Size) })), onItems()],
		result: Item,
	},
	{
		name: "canvas.replace",
		group: "canvas",
		...deckChange,
		summary: "Swap a whole item for another, keeping its id and its place unless the new one says otherwise.",
		params: [p("id", str()), p("item", Item), onItems()],
		result: Item,
	},
	{
		name: "canvas.delete",
		group: "canvas",
		...deckChange,
		summary: "Take an item off the canvas. A board's file stays in the deck.",
		params: [p("id", str()), onItems()],
		result: obj({ deleted: str() }),
	},
	{
		name: "canvas.move",
		group: "canvas",
		...deckChange,
		summary: "Move an item: to a corner (`at`), 160 px clear of another (`beside`, `below`), or into a frame (`parent`, `index`; null for the canvas itself).",
		params: [p("id", str()), o("options", Place)],
		result: Item,
	},
	{
		name: "canvas.copy",
		group: "canvas",
		...deckChange,
		summary: "Duplicate an item, with a new id or the one in `as`, at `at` or in `parent`.",
		params: [p("id", str()), o("options", obj({ canvas: opt(str()), frame: opt(str()), as: opt(str()), at: opt(Corner), parent: opt(union(str(), nul)) }))],
		result: Item,
	},
	{
		name: "canvas.variables",
		group: "canvas",
		...deckChange,
		summary: 'Set the canvas\'s colour tokens, per theme such as light and dark: { accent: { type: "color", value: [{ value: "#e5484d" }, { value: "#ff6369", theme: { mode: "dark" } }] } }; null removes one.',
		params: [p("set", rec(true)), onItems({ themes: opt(union(rec(arr(str())), nul)) })],
		result: obj({ variables: rec(true), themes: opt(rec(true)) }),
	},
	{
		name: "canvas.batch",
		group: "canvas",
		...deckChange,
		summary:
			'Several of the changes above in one call, applied together or not at all. Each op is the call of that name with its item or id inside: { op: "insert", item, beside }, { op: "update", id, set }, { op: "delete", id }. A later op can be beside an item an earlier one made. pen.dev\'s own form, { op: "insert", node, box }, is taken too.',
		params: [p("ops", arr(union(CanvasOp, PenEdit))), onItems()],
		result: arr(Item),
	},
	{
		name: "canvas.fit",
		group: "canvas",
		...deckChange,
		summary:
			"Set a board's height from its content, measured at the width it has on this canvas; it must be on it. `notes` say what the browser found: the height, the word count, the smallest type, content wider than the board, boxes that cut off their content, and views that break when a control is pressed. Use it instead of a screenshot.",
		params: [p("board", str()), onCanvas({ margin: opt(num()) })],
		result: Fit,
	},
	{
		name: "canvas.save",
		group: "canvas",
		...deckChange,
		summary: 'Save an item as a reusable frame in frames/ ("frames/ui/card"), and put a ref to it in its place (`replace: false` leaves the canvas alone).',
		params: [p("id", str()), p("frame", str()), onCanvas({ replace: opt(bool()) })],
		result: obj({ frame: str(), ref: str(), replaced: bool(), overwrote: opt(bool()) }),
	},
	{
		name: "canvas.screenshot",
		group: "canvas",
		...deckRead,
		summary:
			'A picture of the canvas, or part of it: drawing and boards together, saved to `file`. `of` is an item\'s id, a board\'s path, a list of them, or a box; one board\'s path alone is that board as the person\'s browser has it now, without the drawing round it. A .pen file\'s path pictures that file whole. `format` "jpeg" or "pdf", and `to` a deck path, make a file to hand on. Drawn natively over each board\'s current picture (`how` "native"), or in the browser with live boards when asked (`live: true`) or when it must be: math, a picture it cannot load, a board not yet pictured, a PDF (`how` "chromium: <why>").',
		params: [onCanvas({ of: opt(union(str(), arr(str()), PartialBox)), scale: opt(num()), format: opt(lit("png", "jpeg", "pdf")), to: opt(str()), scheme: opt(lit("light", "dark")), live: opt(bool()) })],
		result: Screenshot,
	},
	{
		name: "canvas.rename",
		group: "canvas",
		...deckChange,
		summary: "What the person calls this canvas: a few words for what is on it, that a person would look for. The folder never changes.",
		params: [p("title", str()), onCanvas()],
		result: Canvas,
	},
	{
		name: "canvas.file",
		group: "canvas",
		...deckRead,
		summary: "The canvas's .pen file, to edit by hand instead.",
		params: [onCanvas()],
		result: str(),
	},

	// --- board and deck: files in the deck folder ------------------------------------------------
	{ name: "board.list", group: "board", ...deckRead, summary: "Every board file in the deck, placed or not.", params: [], result: arr(Board) },
	{
		name: "board.create",
		group: "board",
		...deckChange,
		summary:
			'Write a blank board and return it; placing it is the canvas\'s job (decks.canvas.insert({ type: "board", board: path }, { beside })). The title is the finding, as a sentence. `format` "board" (default) is one HTML page you design; "slides" is a reveal deck of <section>s.',
		params: [p("options", obj({ title: str(), format: opt(lit("board", "slides")), w: opt(num()), h: opt(num()) }))],
		result: Board,
	},
	{ name: "board.get", group: "board", ...deckRead, summary: "A board's path and title (the finding it states), and who last wrote it.", params: [p("board", str())], result: Board },
	{ name: "board.canvases", group: "board", ...deckRead, summary: "The canvases this board is on, with its place and size on each.", params: [p("board", str())], result: arr(Placement) },
	{ name: "board.url", group: "board", ...deckRead, summary: "The board's address, for a browser such as Playwright.", params: [p("board", str())], result: str() },
	{ name: "canvas.list", group: "board", ...deckRead, summary: "Every canvas in the deck, and which agents have it open.", params: [], result: arr(Canvas) },
	{
		name: "canvas.create",
		group: "board",
		...deckChange,
		summary: "A new, empty canvas, named from a title. Nobody moves to it: agent.update({ canvas }) makes it your home, view.goto shows it.",
		params: [p("title", str())],
		result: Canvas,
	},
	{
		name: "frame.create",
		group: "board",
		...deckChange,
		summary: 'A new reusable .pen file at `path` ("frames/ui/button"), with `item` as its one reusable item. Placed on any canvas with { type: "ref", ref }; read and edited with the canvas item calls given { frame: ref }.',
		params: [p("path", str()), o("item", PenItem)],
		result: obj({ file: str(), ref: opt(str()), id: str() }),
	},
	{ name: "file.url", group: "board", ...deckRead, summary: "A file on disk, as the address a board embeds.", params: [p("file", str())], result: str() },

	// --- agent: who works --------------------------------------------------------------------
	{ name: "agent.me", group: "agent", ...agentsRead, summary: "You: name, avatar, colour, workspace, tags and home canvas.", params: [], result: Agent },
	{
		name: "agent.update",
		group: "agent",
		...agentsChange,
		summary:
			"Change your name, avatar (an <svg> with xmlns and a viewBox, or { emoji }), workspace (the project) or tags (up to four, for what you are doing now), or your home canvas: the one the app shows beside you, and what decks.here() means for a call that names none. Set the first four early in every session.",
		params: [p("patch", AgentPatch)],
		result: Agent,
	},
	{
		name: "here",
		group: "agent",
		...agentsRead,
		summary: "The canvas a call means when it names none: your home canvas for an agent, the board's canvas for a board button, the canvas on screen for the person. Asked, never set.",
		params: [],
		result: Canvas,
	},
	{ name: "agent.claim", group: "agent", ...agentsChange, summary: "Say these boards carry your work, without showing them: you become their writer.", params: [paths("boards")], result: arr(str()) },
	{ name: "agent.inbox", group: "agent", ...agentsRead, summary: "Hand-offs waiting for you from other agents. Changes to a canvas need no watching: they reach you with your next message.", params: [], result: arr(Message) },
	{
		name: "agent.list",
		group: "agent",
		...agentsRead,
		summary: "Every agent, or the ones on one project (`workspace`), with what each is doing and how much waits for it.",
		params: [o("options", obj({ workspace: opt(str()) }))],
		result: arr(Agent),
	},
	{ name: "agent.get", group: "agent", ...agentsRead, summary: "Another agent, by name or id: kind, workspace, tags, state, home canvas.", params: [p("name", str())], result: Agent },
	{
		name: "agent.send",
		group: "agent",
		...agentsChange,
		summary:
			"Deliver now: the message reaches the agent in the turn it is running and steers it, where its runtime can take a message mid-turn; an idle agent starts a turn on it. A runtime that cannot be steered mid-turn gets it queued, and the answer says delivered: false.",
		params: [p("name", str()), p("message", obj({ task: str(), boards: opt(arr(str())) }))],
		result: obj({ delivered: bool(), turn: lit("running", "new", "queued"), position: opt(num()), note: opt(str()) }),
	},
	{
		name: "agent.queue",
		group: "agent",
		...agentsChange,
		summary: "Put work in the agent's queue, taken up after the turn it is running. Returns at once; with `reply: true` its report comes back to you.",
		params: [p("name", str()), p("work", obj({ task: str(), boards: opt(arr(str())), reply: opt(bool()) }))],
		result: obj({ queued: lit(true), position: num() }),
	},
	{
		name: "agent.create",
		group: "agent",
		...agentsChange,
		summary:
			'Start a new agent, then send or queue it work. `kind` is the runtime ("claude", "pi", "opencode", "opencode2", "antigravity"; yours when left out), `model` any model that kind runs, `thinking` how hard it thinks as that kind names it, `mode` its permission mode, `canvas` its home canvas (a new one when left out).',
		params: [p("spec", obj({ name: str(), kind: opt(AgentKind), model: opt(str()), thinking: opt(str()), mode: opt(AgentMode), workspace: opt(str()), tags: opt(arr(str())), canvas: opt(str()) }))],
		result: Agent,
	},

	// --- view: what the person is looking at, moved only on purpose ----------------------------
	{
		name: "view.goto",
		group: "view",
		...screenChange,
		summary: "Bring the person's screen to a canvas. Only the view moves; nobody's home canvas changes.",
		params: [p("canvas", str())],
		result: obj({ canvas: str(), moved: bool(), note: opt(str()) }),
	},
	{
		name: "view.focus",
		group: "view",
		...screenChange,
		summary: "Move the camera to a board or a drawn item on a canvas (a list frames them all), optionally outlining one data-id block inside a board. `animate: true` glides.",
		params: [p("target", union(str(), arr(str()))), onCanvas({ highlight: opt(str()), animate: opt(bool()) })],
		result: obj({ canvas: str(), target: union(str(), arr(str())), deferred: opt(str()) }),
	},
	{ name: "view.camera", group: "view", ...screenRead, summary: "Where the person's screen is looking, and its zoom.", params: [], result: Camera },
	{
		name: "view.move",
		group: "view",
		...screenChange,
		summary: "Move the person's camera outright: { x, y, zoom }, zoom 1 is life size.",
		params: [p("camera", obj({ x: num(), y: num(), zoom: num(), animate: opt(bool()) }))],
		result: Camera,
	},
	{ name: "view.viewport", group: "view", ...screenRead, summary: "The room the screen has, in CSS pixels, or null when no screen has said.", params: [], result: union(obj({ width: num(), height: num() }), nul) },
	{ name: "view.cursor", group: "view", ...screenChange, summary: "A labelled dot on a board, at board coordinates; null removes it.", params: [p("board", str()), p("at", union(Point, nul))] },
	{
		name: "view.reload",
		group: "view",
		...screenChange,
		summary:
			"Reload the board's page in every browser and iPad showing it on that canvas; with no `canvas`, on every canvas it is on. For a change the watcher cannot see (a file it fetches, data from outside). No file changes.",
		params: [p("options", obj({ board: str(), canvas: opt(str()) }))],
		result: obj({ reloaded: num() }),
	},

	// --- apps --------------------------------------------------------------------------------
	{ name: "apps.list", group: "apps", ...outsideRead, summary: "Every app in the deck's apps/ folder, with its state.", params: [], result: arr(AppState) },
	{ name: "apps.status", group: "apps", ...outsideRead, summary: "One app's state.", params: [p("name", str())], result: AppState },
	{
		name: "apps.create",
		group: "apps",
		...deckChange,
		summary: 'A new app folder from a starter ("static" default, "node", "solid", "react", "next"), with its board.',
		params: [p("name", str()), o("options", obj({ starter: opt(lit("static", "node", "solid", "react", "next")), title: opt(str()) }))],
		result: obj({ name: str(), kind: AppKind, folder: str(), files: arr(str()), board: str(), url: str(), next: str() }),
	},
	{ name: "apps.board", group: "apps", ...outsideRead, summary: "The board for an app whose folder you wrote yourself.", params: [p("name", str())], result: str() },
	{ name: "apps.build", group: "apps", ...outsideChange, summary: "Build it, waiting up to 15 s; `pending` means ask its status later.", params: [p("name", str())], result: AppOutcome },
	{ name: "apps.run", group: "apps", ...outsideChange, summary: "Start it, waiting up to 15 s.", params: [p("name", str())], result: AppOutcome },
	{ name: "apps.stop", group: "apps", ...outsideChange, summary: "Stop it.", params: [p("name", str())], result: obj({ stopped: bool() }) },
	{ name: "apps.restart", group: "apps", ...outsideChange, summary: "Stop and start again after a code change. Its board reloads by itself.", params: [p("name", str())], result: AppOutcome },
	{ name: "apps.logs", group: "apps", ...outsideRead, summary: "Its recent output.", params: [p("name", str()), o("options", obj({ tail: opt(int()) }))], result: arr(str()) },
	{
		name: "apps.check",
		group: "apps",
		...outsideRead,
		summary: "Open it in the server's browser and say what is wrong: what fit is to a board. Read `verdict`; `file` is a picture.",
		params: [p("name", str())],
		result: obj({ verdict: str(), url: opt(str()), title: opt(str()), errors: arr(str()), failed: opt(arr(str())), words: opt(num()), file: opt(str()) }),
	},

	// --- the person's Chrome, ports and the clock ------------------------------------------------
	{
		name: "web.status",
		group: "web",
		...outsideRead,
		summary: "Whether the person is sharing a Chrome tab through the Decks extension, and which.",
		params: [],
		result: obj({ paired: bool(), connected: bool(), tab: opt(obj({ title: str(), url: str() })), pending: opt(obj({ id: str(), text: str() })), closed: opt(str()) }),
	},
	{ name: "web.pairing", group: "web", ...outsideChange, summary: "A code to pair the Decks extension.", params: [], result: obj({ code: str(), path: str(), note: str() }) },
	{ name: "web.repair", group: "web", ...outsideChange, summary: "Pair the extension again: a fresh code.", params: [], result: obj({ code: str() }) },
	{ name: "web.board", group: "web", ...deckChange, summary: "A board showing the shared tab.", params: [], result: str() },
	{ name: "web.open", group: "web", ...outsideChange, summary: "Go to an address in the shared tab.", params: [p("url", str())], result: obj({ url: str(), title: str() }) },
	{
		name: "web.read",
		group: "web",
		...outsideRead,
		summary: "The page as a tree of fields and buttons, each with a [ref=e42]. References die when the tab navigates.",
		params: [],
		result: obj({ url: str(), title: str(), snapshot: str(), truncated: opt(bool()) }),
	},
	{ name: "web.screenshot", group: "web", ...outsideRead, summary: "A picture of the tab.", params: [o("options", obj({ full: opt(bool()) }))], result: obj({ file: str(), width: num(), height: num() }) },
	{ name: "web.fill", group: "web", ...outsideChange, summary: "Type into a field. Never passwords or codes.", params: [p("field", WebTarget), p("text", str())], result: obj({ field: str() }) },
	{ name: "web.select", group: "web", ...outsideChange, summary: "Choose an option in a select.", params: [p("field", WebTarget), p("option", str())], result: obj({ field: str(), option: str() }) },
	{ name: "web.click", group: "web", ...outsideChange, summary: "Click a button or link.", params: [p("what", WebTarget)], result: obj({ clicked: str() }) },
	{ name: "web.press", group: "web", ...outsideChange, summary: "Press a key.", params: [p("key", str())], result: obj({ pressed: str() }) },
	{
		name: "web.submit",
		group: "web",
		...outsideChange,
		summary: "Submit a form, asking the person first; may come back with allowed: false.",
		params: [o("what", WebTarget), o("options", obj({ ask: opt(bool()) }))],
		result: obj({ submitted: str(), allowed: bool() }),
	},
	{ name: "web.stop", group: "web", ...outsideChange, summary: "Stop sharing.", params: [] },
	{
		name: "ports",
		group: "misc",
		...outsideChange,
		summary: "Forward a local server so a board can frame it: read with nothing, { open: port, label } to forward one, { close: port } to stop. `node` passes the path on; `rnode` strips it.",
		params: [o("change", obj({ open: opt(int()), close: opt(int()), label: opt(str()) }))],
		result: arr(obj({ port: num(), label: opt(str()), by: opt(str()), at: num(), node: str(), rnode: str() })),
	},
	{
		name: "studio.connect",
		group: "misc",
		...outsideChange,
		summary: "Connect this harness to Decks Studio with the key Studio made for it: the deck then syncs there in the background. Only the person can call it, from a browser paired with this harness.",
		params: [p("url", str()), p("key", str())],
		result: obj({ connected: bool(), url: str() }),
	},
	{
		name: "pair.code",
		group: "misc",
		...outsideChange,
		summary: "A pairing code for another Decks front end, such as Studio, to connect to this harness with: six digits, ten minutes, once. Only on the harness's own machine; Settings never shows one.",
		params: [],
		result: obj({ code: str(), expires: num() }),
	},
	{ name: "studio.status", group: "misc", ...outsideRead, summary: "Whether this harness syncs with Decks Studio, and with which.", params: [], result: obj({ connected: bool(), url: opt(str()) }) },
	{ name: "studio.disconnect", group: "misc", ...outsideChange, summary: "Stop syncing with Decks Studio and forget the key. Only the person can call it.", params: [], result: obj({ connected: bool() }) },
	{ name: "now", group: "misc", ...outsideRead, summary: "The time where the person is.", params: [], result: obj({ iso: str(), timezone: str(), words: str(), epoch: num() }, true) },
];

/**
 * The old names, kept for one release. Each takes what it always took and answers as it always
 * did, mapped onto the new call named in `alias`; every answer through one carries a note naming
 * that call, so a caller learns the new name from using the old.
 */
export const ALIASES: readonly Verb[] = [
	{
		name: "newBoard",
		group: "board",
		...deckChange,
		alias: "decks.board.create, then decks.canvas.insert",
		summary: "Old name: write a blank board and place it on your canvas at `at`.",
		params: [p("options", obj({ title: str(), format: opt(lit("board", "slides")), w: opt(num()), h: opt(num()), at: opt(Corner) }))],
		result: str(),
	},
	{
		name: "fit",
		group: "canvas",
		...deckChange,
		alias: "decks.canvas.fit",
		summary: "Old name: size a board's height to its content on a canvas.",
		params: [p("path", str()), o("options", obj({ canvas: opt(str()), margin: opt(num()) }))],
		result: obj({ path: str(), w: num(), h: num(), content: opt(obj({ w: num(), h: num(), page: opt(num()) })) }),
	},
	{
		name: "resize",
		group: "canvas",
		...deckChange,
		alias: "decks.canvas.update(board, { size })",
		summary: "Old name: set a board's size outright.",
		params: [p("path", str()), p("size", obj({ w: opt(num()), h: opt(num()) }))],
		result: Sized,
	},
	{ name: "report", group: "agent", ...agentsChange, alias: "decks.agent.claim", summary: "Old name: claim boards as your work.", params: [paths()], result: obj({ reported: arr(str()) }) },
	{ name: "reload", group: "view", ...screenChange, alias: "decks.view.reload({ board })", summary: "Old name: reload a board's page.", params: [p("path", str())] },
	{ name: "boards", group: "canvas", ...deckRead, alias: "decks.canvas.read, or decks.board.list", summary: "Old name: every board, placed as your canvas has them.", params: [], result: arr(PlacedBoard) },
	{
		name: "show",
		group: "view",
		...screenChange,
		alias: 'decks.canvas.insert({ type: "board", board }) to place it, then decks.view.focus',
		summary: "Old name: put boards on your canvas and move the camera to them.",
		params: [p("target", union(str(), arr(str()))), o("options", obj({ fit: opt(lit("board", "all")), highlight: opt(str()), animate: opt(bool()), at: opt(Corner) }))],
		result: obj({ shown: arr(str()) }),
	},
	{ name: "hide", group: "canvas", ...deckChange, alias: "decks.canvas.delete", summary: "Old name: take boards off your canvas.", params: [paths()] },
	{ name: "move", group: "canvas", ...deckChange, alias: "decks.canvas.move(board, { at })", summary: "Old name: move a board on your canvas.", params: [p("path", str()), p("at", Point)], result: PlacedBoard },
	{ name: "cursor", group: "view", ...screenChange, alias: "decks.view.cursor", summary: "Old name: a labelled dot on a board.", params: [p("path", str()), p("at", union(Point, nul))] },
	{
		name: "camera",
		group: "view",
		...screenChange,
		alias: "decks.view.camera to read, decks.view.move to move",
		summary: "Old name: read the camera, or move it with { x, y, zoom }.",
		params: [o("at", obj({ x: num(), y: num(), zoom: num() })), o("options", obj({ animate: opt(bool()) }))],
		result: union(obj({ x: num(), y: num(), zoom: num() }), nul),
	},
	{ name: "viewport", group: "view", ...screenRead, alias: "decks.view.viewport", summary: "Old name: the room the screen has.", params: [], result: union(obj({ width: num(), height: num() }), nul) },
	{
		name: "screenshot",
		group: "canvas",
		...deckRead,
		alias: "decks.canvas.screenshot",
		summary: "Old name: a picture of your canvas or part of it.",
		params: [o("options", obj({ of: opt(union(str(), arr(str()), PartialBox)), scale: opt(num()), format: opt(lit("png", "jpeg", "pdf")), to: opt(str()), scheme: opt(lit("light", "dark")), live: opt(bool()) }))],
		result: obj({ file: str(), width: num(), height: num(), box: Box, how: opt(str()), note: opt(str()) }),
	},
	{
		name: "stages",
		group: "board",
		...deckRead,
		alias: "decks.canvas.list",
		summary: "Old name: every canvas and who has it open.",
		params: [],
		result: arr(obj({ name: str(), title: str(), open: arr(str()), boards: num(), mine: opt(lit(true)) })),
	},
	{
		name: "open",
		group: "agent",
		...agentsChange,
		alias: "decks.agent.update({ canvas }), then decks.view.goto",
		summary: "Old name: make another canvas your home and show it.",
		params: [p("name", str())],
		result: obj({ stage: str(), boards: arr(str()) }),
	},
	{ name: "newStage", group: "board", ...deckChange, alias: "decks.canvas.create, then decks.agent.update({ canvas })", summary: "Old name: make an empty canvas and move to it.", params: [p("title", str())], result: obj({ stage: str() }) },
	{ name: "title", group: "canvas", ...deckChange, alias: "decks.canvas.rename, or decks.here() to read", summary: "Old name: name your canvas, or read its name.", params: [o("title", str())], result: obj({ stage: str(), title: str() }) },
	{
		name: "pen.read",
		group: "canvas",
		...deckRead,
		alias: "decks.canvas.read (a frame file: decks.canvas.read({ frame }))",
		summary: "Old name: your canvas's drawing, or any .pen file by `path`.",
		params: [o("path", str())],
		result: obj({ stage: opt(str()), file: str(), ref: opt(str()), version: str(), error: opt(str()), children: arr(any()) }),
	},
	{
		name: "pen.edit",
		group: "canvas",
		...deckChange,
		alias: "decks.canvas.batch (or the single calls: insert, update, replace, delete, move, copy, variables; a frame file with { frame })",
		summary: "Old name: edit your canvas's drawing, or any .pen file by `path`, all or nothing.",
		params: [p("edits", arr(PenEdit)), o("options", obj({ path: opt(str()) }))],
		result: obj({ rev: opt(num()), file: opt(str()), ref: opt(str()), results: arr(obj({ op: str(), id: str(), box: opt(Box), note: opt(str()) })) }),
	},
	{ name: "pen.create", group: "board", ...deckChange, alias: "decks.frame.create", summary: "Old name: a new .pen file in frames/.", params: [p("path", str()), o("item", PenItem)], result: obj({ file: str(), ref: opt(str()), id: str() }) },
	{
		name: "pen.save",
		group: "canvas",
		...deckChange,
		alias: "decks.canvas.save",
		summary: "Old name: save an item as a frame.",
		params: [p("id", str()), p("path", str()), o("options", obj({ replace: opt(bool()) }))],
		result: obj({ frame: str(), ref: str(), replaced: bool(), overwrote: bool() }),
	},
	{ name: "pen.file", group: "canvas", ...deckRead, alias: "decks.canvas.file", summary: "Old name: your canvas's .pen file.", params: [], result: str() },
	{
		name: "me",
		group: "agent",
		...agentsChange,
		alias: "decks.agent.me to read, decks.agent.update to change",
		summary: "Old name: who you are, read with nothing, changed with a patch.",
		params: [o("patch", obj({ name: opt(str()), avatar: opt(union(obj({ emoji: str() }), obj({ svg: str() }))), tags: opt(arr(str())), workspace: opt(str()) }))],
		result: obj({ name: str(), avatar: opt(str()), color: str(), tags: opt(arr(str())), workspace: opt(str()), avatarChanged: opt(str()) }),
	},
	{
		name: "agents",
		group: "agent",
		...agentsRead,
		alias: "decks.agent.list",
		summary: "Old name: every agent.",
		params: [o("options", obj({ filter: opt(obj({ workspace: opt(str()) })) }))],
		result: arr(obj({ id: str(), name: str(), me: bool(), state: str(), kind: str(), tags: arr(str()), workspace: opt(str()), queued: num() })),
	},
	{
		name: "send",
		group: "agent",
		...agentsChange,
		alias: "decks.agent.queue (and decks.agent.create to make the agent first; decks.agent.send now delivers at once)",
		summary: "Old name: queue work for an agent, making it first from { name, kind }.",
		params: [
			p("to", union(str(), obj({ name: str(), kind: opt(AgentKind), model: opt(str()), thinking: opt(str()), mode: opt(AgentMode), tags: opt(arr(str())), workspace: opt(str()) }))),
			p("work", obj({ task: str(), boards: opt(arr(str())), reply: opt(bool()) })),
		],
		result: obj({ queued: lit(true), position: num(), agent: opt(str()), name: opt(str()) }),
	},
	{
		name: "queue",
		group: "agent",
		...agentsRead,
		alias: "decks.agent.inbox",
		summary: "Old name: what is waiting in an agent's queue.",
		params: [o("agentId", str())],
		result: arr(obj({ from: str(), fromName: str(), task: str(), boards: arr(str()), at: num() })),
	},
	{ name: "url", group: "board", ...deckRead, alias: "decks.board.url", summary: "Old name: a board's address.", params: [p("path", str())], result: str() },
	{ name: "resolve", group: "board", ...deckRead, alias: "decks.file.url", summary: "Old name: a file's address for a board.", params: [p("file", str())], result: str() },
];

/** The new calls and the old names together: everything `/api/v1/<name>` answers. */
export const ALL_VERBS: readonly Verb[] = [...VERBS, ...ALIASES];

/** A call by its name, `canvas.insert`, or an old name, `pen.edit`. */
export const VERB_BY_NAME: ReadonlyMap<string, Verb> = new Map(ALL_VERBS.map((verb) => [verb.name, verb]));

/** The note an answer through an old name carries. */
export function aliasNote(verb: Verb): string | undefined {
	return verb.alias ? `${verb.name} is an old name, kept for one release: use ${verb.alias}.` : undefined;
}

/** The command-line name of a call: `canvas.insert` -> `canvas insert`, `newBoard` -> `new-board`. */
export function commandOf(verb: Verb): string[] {
	return verb.name.split(".").map((part) => part.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
}
