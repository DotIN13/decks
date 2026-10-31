import { any, arr, bool, int, lit, nul, num, obj, opt, rec, str, union, type Schema } from "./schema.ts";
import {
	Agent,
	AgentKind,
	AgentMode,
	AppItem,
	AppKind,
	AppOutcome,
	AppState,
	Box,
	Card,
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
	Point,
	Screenshot,
	Size,
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
 * - `touches`: what the call acts on. `deck` is the deck's files (a canvas's .pen file, a card,
 *   a frame); `screen` is what the person sees in every open Decks page, with no file
 *   changes; `agents` is agent records and messages; `outside` is apps, the shared Chrome tab,
 *   ports and the clock.
 * - `effect`: `change` if it changes what it touches, `read` if it only reads.
 *
 * Calls are stateless: every canvas call takes an optional `canvas`, and left out it means
 * `decks.here()`. No call changes a "current canvas"; `agent.update({ canvas })` changes an
 * agent's home canvas, which is what `here()` answers for that agent.
 */

export type Effect = "change" | "read";
export type Touches = "deck" | "screen" | "agents" | "outside";
export type Group = "canvas" | "card" | "agent" | "view" | "apps" | "web" | "misc";

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
	/**
	 * Where a card's call to it goes, from the canvas frame a card is drawn in (`@decks/canvas`,
	 * `frame/inside/card-calls.ts`): `frame`, answered there, the person's view of that canvas; `canvas`,
	 * by the harness on the frame's canvas token, the canvas's own calls, made as the person on that
	 * canvas and no other (`verbs/router.ts` refuses the token anything else); `page`, by the app's page
	 * with the person's own token, asking them before a card's words go to an agent. Absent: nowhere, it
	 * reaches past the canvas.
	 */
	card?: CardRoute;
}

export type CardRoute = "frame" | "canvas" | "page";

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
	// --- canvas: everything on one canvas, cards included --------------------------------------
	{
		name: "canvas.read",
		card: "canvas",
		group: "canvas",
		...deckRead,
		summary:
			'Everything on the canvas, cards included, each with its box; an item cut by a frame round it that clips says `clipped: "partly"` (some of its box is outside) or `"fully"` (none is inside), as does a text whose words overflow its fixed width and height. A card is { type: "card", card: <path>, box } (an old board, { type: "board", board }); every other item has pen.dev\'s own fields. Read it before placing anything. `frame: "frames/<name>"` reads a frame file instead, its items in its own space; this and the item calls below take `frame` in place of `canvas`, and a change to a frame shows on every canvas placing it. `of` (an id, a card\'s path, or an id inside an instance such as "card-1/label") reads that one item and what is in it; `depth` keeps that many levels of children (0: the items alone), and an item whose children were left out says how many in `childCount`. `resolve` works values out instead of reading them as written, each off by default: `variables` puts each $name\'s value in, for the light theme or `theme` ({ mode: "dark" }); `instances` reads a ref as its expanded copy, overrides applied, its items under `children` with ids "ref/child"; `geometry` adds a path\'s or shape\'s `outline`, an SVG path in its own space (0,0 its top-left corner).',
		params: [onItems({ of: opt(str()), depth: opt(int()), resolve: opt(obj({ variables: opt(bool()), instances: opt(bool()), geometry: opt(bool()) })), theme: opt(rec(str())) })],
		result: obj({ canvas: opt(str()), frame: opt(str()), title: opt(str()), file: opt(str()), version: str(), rev: opt(num()), error: opt(str()), variables: opt(rec(true)), values: opt(rec(true)), themes: opt(rec(true)), items: arr(Item) }),
	},
	{
		name: "canvas.space",
		card: "canvas",
		group: "canvas",
		...deckRead,
		summary:
			'Where a box of `size` fits: the top-left corner nearest the middle of everything on the canvas where the box, grown by `margin` (160) on every side, touches no top-level item (arrows aside). With `near` (an id or a card\'s path) it starts on that item\'s `side` (right; or below, left, above), tops or lefts aligned as beside and below do, and steps outward past whatever is in the way. Nothing is placed: give the corner to insert or move as `at`.',
		params: [p("size", obj({ w: num(), h: num() })), onItems({ near: opt(str()), side: opt(lit("right", "below", "left", "above")), margin: opt(num()) })],
		result: obj({ x1: num(), y1: num() }),
	},
	{
		name: "canvas.insert",
		card: "canvas",
		group: "canvas",
		...deckChange,
		summary:
			'Add an item to the canvas. A card is { type: "card", card: <its folder or index.html> }, or { type: "card", html, title?, width?, height? } to write one and place it; an app is { type: "app", app: <name> } and a document { type: "document", path }; anything else is a pen.dev item (note, text, frame, rectangle, ellipse, arrow, ref). Say where: `at` is its top-left corner; `beside` or `below` (an item\'s id or a card\'s path) puts it 160 px clear of that item, tops or lefts aligned; `parent` and `index` put it inside a frame. An item with a `name` and no `id` takes its name as its id ("Pricing card" → pricing-card, then pricing-card-2), its children too; the answer has every id. Colour it with Decks\'s adaptive colours so it reads in light and dark, named by role: text ("$decks-text", "$decks-text-muted"), line ("$decks-line" for arrows, "$decks-line-strong", "$decks-line-subtle" for edges), surface ("$decks-surface", paper), fill ("$decks-fill-slate", "$decks-fill-sky", "$decks-fill-gray", and soft "$decks-fill-red", -orange, -yellow, -green, -blue, -purple) and accent ("$decks-accent-red", -orange, -yellow, -green, -blue, -purple); the insert defines any the canvas lacks. A hex stays the same in both; a top-level rectangle, ellipse, icon, empty frame or arrow given no colour gets the tools\' $decks-* colours.',
		params: [p("item", Item), o("options", Place)],
		result: Item,
	},
	{
		name: "canvas.update",
		card: "canvas",
		group: "canvas",
		...deckChange,
		summary: "Change an item's fields (`set`), its place (`at`) or its size (`size`). A card can be named by its path; its size here is its size on this canvas.",
		params: [p("id", str()), p("change", obj({ set: opt(rec(true)), at: opt(Corner), size: opt(Size) })), onItems()],
		result: Item,
	},
	{
		name: "canvas.replace",
		card: "canvas",
		group: "canvas",
		...deckChange,
		summary: "Swap a whole item for another, keeping its id and its place unless the new one says otherwise.",
		params: [p("id", str()), p("item", Item), onItems()],
		result: Item,
	},
	{
		name: "canvas.delete",
		card: "canvas",
		group: "canvas",
		...deckChange,
		summary: "Take an item off the canvas. A card's folder stays in the deck.",
		params: [p("id", str()), onItems()],
		result: obj({ deleted: str() }),
	},
	{
		name: "canvas.move",
		card: "canvas",
		group: "canvas",
		...deckChange,
		summary: "Move an item: to a corner (`at`), 160 px clear of another (`beside`, `below`), or into a frame (`parent`, `index`; null for the canvas itself).",
		params: [p("id", str()), o("options", Place)],
		result: Item,
	},
	{
		name: "canvas.copy",
		card: "canvas",
		group: "canvas",
		...deckChange,
		summary: "Duplicate an item, with a new id or the one in `as`, at `at` or in `parent`.",
		params: [p("id", str()), o("options", obj({ canvas: opt(str()), frame: opt(str()), as: opt(str()), at: opt(Corner), parent: opt(union(str(), nul)) }))],
		result: Item,
	},
	{
		name: "canvas.clip",
		card: "canvas",
		group: "canvas",
		...deckRead,
		summary:
			"Hold a copy of items for a paste on another canvas of this harness: the items with these ids (or cards' paths), whole, as they are now, kept by the harness under `id` (a fresh random one you choose) for a day. Nothing changes; canvas.paste puts them in. A canvas's ⌘C does this.",
		params: [p("ids", arr(str())), onCanvas({ id: str() })],
		result: obj({ id: str(), canvas: str(), box: obj({ x: num(), y: num(), w: num(), h: num() }), items: num() }),
	},
	{
		name: "canvas.paste",
		card: "canvas",
		group: "canvas",
		...deckChange,
		summary:
			"Put in a copy canvas.clip holds (`clip`: { id, canvas } at least, as the clipboard has it), its top-left corner `at`, as one edit the person can undo. The items get new ids, arrows stay joined to the copies, and what they need comes along from the canvas they were copied on: each card's folder (as cards/<name>-2/ when the name is taken), each picture and document in its folder. Cards copied from a friend's canvas land with their scripts off. Answers the items as they are now.",
		params: [p("clip", obj({ id: str(), canvas: str() }, true)), onCanvas({ at: opt(Point) })],
		result: arr(Item),
	},
	{
		name: "canvas.variables",
		card: "canvas",
		group: "canvas",
		...deckChange,
		summary: 'Set the canvas\'s colour tokens and other variables, each then used as "$name" in any field. { brand: { light: "#4f46e5", dark: "#818cf8" } } follows the canvas between light and dark, "#4f46e5" is the same in both, a number is a number variable, null removes one. The dark value is keyed to the canvas\'s own light/dark axis (added when it has none), so `themes` is not needed; pen\'s full form ({ type: "color", value: [{ value }, { value, theme: { mode: "dark" } }] }) still works. The answer gives each variable in pen\'s form under `variables` and short under `values`. Decks\'s own adaptive colours ($decks-text, $decks-line, … see canvas.insert) need no call: an edit that uses one defines it.',
		params: [p("set", rec(true)), onItems({ themes: opt(union(rec(arr(str())), nul)) })],
		result: obj({ variables: rec(true), values: rec(true), themes: opt(rec(true)) }),
	},
	{
		name: "canvas.batch",
		card: "canvas",
		group: "canvas",
		...deckChange,
		summary:
			'Several of the changes above in one call, applied together or not at all. Each op is the call of that name with its item or id inside: { op: "insert", item, beside }, { op: "update", id, set }, { op: "delete", id }. A later op can be beside an item an earlier one made. pen.dev\'s own form, { op: "insert", node, box }, is taken too. This and insert, update and replace add a note for each field an item\'s type does not have, and each value Decks keeps for pen.dev but does not draw (shader and mesh_gradient fills, background_blur and shader effects, inner shadows on anything but a box or a whole ellipse, script items); nothing is refused for it.',
		params: [p("ops", arr(union(CanvasOp, PenEdit))), onItems()],
		result: arr(Item),
	},
	{
		name: "canvas.step",
		card: "canvas",
		group: "canvas",
		...deckChange,
		summary: 'Take back the person\'s last edit to the drawing, or put it back ("undo" or "redo"); refused, with why, when an agent or the file changed the drawing since. Answers whether a step is left each way.',
		params: [p("direction", lit("undo", "redo")), onCanvas()],
		result: obj({ undo: bool(), redo: bool() }),
	},
	{
		name: "canvas.fit",
		card: "canvas",
		group: "canvas",
		...deckChange,
		summary:
			"Set a card's height from its content, measured at the width it has on this canvas; it must be on it. `notes` say what the browser found: the height, the word count, the smallest type, content wider than the card, boxes that cut off their content, and views that break when a control is pressed. Use it instead of a screenshot.",
		params: [p("card", str()), onCanvas({ margin: opt(num()) })],
		result: Fit,
	},
	{
		name: "canvas.save",
		card: "canvas",
		group: "canvas",
		...deckChange,
		summary: 'Save an item as a reusable frame in frames/ ("frames/ui/card"), and put a ref to it in its place (`replace: false` leaves the canvas alone).',
		params: [p("id", str()), p("frame", str()), onCanvas({ replace: opt(bool()) })],
		result: obj({ frame: str(), ref: str(), replaced: bool(), overwrote: opt(bool()) }),
	},
	{
		name: "canvas.screenshot",
		card: "canvas",
		group: "canvas",
		...deckRead,
		summary:
			'A picture of the canvas, or part of it: drawing and cards together, saved to `file`. `of` is an item\'s id, a card\'s path, a list of them, or a box; one card\'s path alone is that card as the person\'s browser has it now, without the drawing round it. A .pen file\'s path pictures that file whole. The picture is the area at one pixel per canvas unit, shrunk until its long side is at most 1,600 px; `scale` multiplies that, so `scale: 2` of a 1,000 px card is 2,000 px wide and of a 7,500 px row is 3,200. `format` "jpeg" or "pdf", and `to` a path in the deck (`exports/plan.png`), make a file to hand on. Drawn natively over each card\'s current picture (`how` "native"), or in the browser with live cards when asked (`live: true`) or when it must be: math, a picture it cannot load, a card not yet pictured, a PDF (`how` "chromium: <why>").',
		params: [onCanvas({ of: opt(union(str(), arr(str()), PartialBox)), scale: opt(num()), format: opt(lit("png", "jpeg", "pdf")), to: opt(str()), scheme: opt(lit("light", "dark")), live: opt(bool()) })],
		result: Screenshot,
	},
	{
		name: "canvas.export",
		card: "canvas",
		group: "canvas",
		...deckChange,
		summary:
			'The items `of` names (an id or a list, each with what is in it) as one self-contained web page in the deck, at `to` (default `exports/<id>.html`). A frame with a layout is a flexbox (gap, padding, justifyContent, alignItems; fill_container is flex 1 or stretch, fit_content the content\'s size), a number is px, and a frame with no layout holds its children where they sit; text keeps its font, size, weight, line height, letter spacing, colour and wrapping; fills (colours, gradients, pictures by relative address), strokes, corners, outer shadows and opacity are CSS; icons, paths and shapes are inline SVG; variables are CSS custom properties, with the dark theme\'s values under prefers-color-scheme. `format` "html" (the default) writes inline styles; "tailwind" the same page as Tailwind classes, with Tailwind\'s CDN script.',
		params: [p("of", union(str(), arr(str()))), onItems({ format: opt(lit("html", "tailwind")), to: opt(str()) })],
		result: obj({ file: str() }),
	},
	{
		name: "canvas.rename",
		card: "canvas",
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

	// --- cards and the deck: files in the deck folder -------------------------------------------
	{ name: "card.list", group: "card", ...deckRead, summary: "Every card in the deck, placed or not.", params: [], result: arr(Card) },
	{
		name: "card.create",
		card: "canvas",
		group: "card",
		...deckChange,
		summary:
			'Write a blank card in a canvas\'s own cards/ (`canvas`, or your own canvas) and return it: a folder, cards/<title>/, holding its index.html and whatever it keeps beside it (card.css, chart.js, data.json). Placing it is the canvas\'s job (decks.canvas.insert({ type: "card", card: path }, { beside })). The title is the finding, as a sentence; the card is a piece of HTML you design, drawn in the canvas\'s own page.',
		params: [p("options", obj({ title: str(), w: opt(num()), h: opt(num()), canvas: opt(str()) }))],
		result: Card,
	},
	{ name: "card.get", card: "canvas", group: "card", ...deckRead, summary: "A card's path and title (the finding it states), and who last wrote it.", params: [p("card", str())], result: Card },
	{ name: "card.canvases", card: "canvas", group: "card", ...deckRead, summary: "The canvas this card is on, with its place and size there.", params: [p("card", str())], result: arr(Placement) },
	{ name: "card.url", card: "canvas", group: "card", ...deckRead, summary: "The card's address as a page of its own, for a browser such as Playwright.", params: [p("card", str())], result: str() },
	{ name: "canvas.list", group: "card", ...deckRead, summary: "Every canvas in the deck, and which agents have it open.", params: [], result: arr(Canvas) },
	{
		name: "canvas.create",
		group: "card",
		...deckChange,
		summary: "A new, empty canvas, named from a title. Nobody moves to it: agent.update({ canvas }) makes it your home, view.goto shows it.",
		params: [p("title", str())],
		result: Canvas,
	},
	{
		name: "canvas.copyShared",
		group: "canvas",
		...deckChange,
		summary:
			'Make your own copy of a canvas a friend shared with you (`canvas`, shared/<owner>/<canvas>): its drawing, cards, frames and files copied into a new canvases/<name>/ of yours, titled "Copy of …" (or `title`). The copy is yours and syncs as your own; it never changes theirs. How a canvas shared with you to view is changed.',
		params: [onCanvas({ title: opt(str()) })],
		result: Canvas,
	},
	{
		name: "frame.create",
		card: "canvas",
		group: "card",
		...deckChange,
		summary: 'A new reusable .pen file at `path` ("frames/ui/button"), with `item` as its one reusable item, in your canvas\'s own frames/. Placed on that canvas with { type: "ref", ref }; read and edited with the canvas item calls given { frame: ref }. A frame from the deck\'s own frames/ placed on a canvas is copied into it.',
		params: [p("path", str()), o("item", PenItem)],
		result: obj({ file: str(), ref: opt(str()), id: str() }),
	},
	{ name: "file.url", card: "canvas", group: "card", ...deckRead, summary: "A file on disk, as the address a card embeds.", params: [p("file", str())], result: str() },

	// --- agent: who works --------------------------------------------------------------------
	{ name: "agent.me", card: "page", group: "agent", ...agentsRead, summary: "You: name, avatar, colour, workspace, tags and home canvas.", params: [], result: Agent },
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
		card: "frame",
		group: "agent",
		...agentsRead,
		summary: "The canvas a call means when it names none: your home canvas for an agent, the card's canvas for a card's button, the canvas on screen for the person. Asked, never set.",
		params: [],
		result: Canvas,
	},
	{ name: "agent.claim", group: "agent", ...agentsChange, summary: "Say these cards carry your work, without showing them: you become their writer.", params: [paths("cards")], result: arr(str()) },
	{ name: "agent.inbox", card: "page", group: "agent", ...agentsRead, summary: "Hand-offs waiting for you from other agents. Changes to a canvas need no watching: they reach you with your next message.", params: [], result: arr(Message) },
	{
		name: "agent.list",
		card: "page",
		group: "agent",
		...agentsRead,
		summary: "Every agent, or the ones on one project (`workspace`), with what each is doing and how much waits for it.",
		params: [o("options", obj({ workspace: opt(str()) }))],
		result: arr(Agent),
	},
	{ name: "agent.get", card: "page", group: "agent", ...agentsRead, summary: "Another agent, by name or id: kind, workspace, tags, state, home canvas.", params: [p("name", str())], result: Agent },
	{
		name: "agent.send",
		card: "page",
		group: "agent",
		...agentsChange,
		summary:
			"Deliver now: the message reaches the agent in the turn it is running and steers it, where its runtime can take a message mid-turn; an idle agent starts a turn on it. A runtime that cannot be steered mid-turn gets it queued, and the answer says delivered: false.",
		params: [p("name", str()), p("message", obj({ task: str(), cards: opt(arr(str())) }))],
		result: obj({ delivered: bool(), turn: lit("running", "new", "queued"), position: opt(num()), note: opt(str()) }),
	},
	{
		name: "agent.queue",
		card: "page",
		group: "agent",
		...agentsChange,
		summary: "Put work in the agent's queue, taken up after the turn it is running. Returns at once; with `reply: true` its report comes back to you.",
		params: [p("name", str()), p("work", obj({ task: str(), cards: opt(arr(str())), reply: opt(bool()) }))],
		result: obj({ queued: lit(true), position: num() }),
	},
	{
		name: "agent.create",
		card: "page",
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
		card: "page",
		group: "view",
		...screenChange,
		summary: "Bring the person's screen to a canvas. Only the view moves; nobody's home canvas changes.",
		params: [p("canvas", str())],
		result: obj({ canvas: str(), moved: bool(), note: opt(str()) }),
	},
	{
		name: "view.focus",
		card: "frame",
		group: "view",
		...screenChange,
		summary: "Move the camera to a card or a drawn item on a canvas (a list frames them all), optionally outlining one data-id block inside a card. `animate: true` glides.",
		params: [{ ...p("target", union(str(), arr(str()))), variadic: true }, onCanvas({ highlight: opt(str()), animate: opt(bool()) })],
		result: obj({ canvas: str(), target: union(str(), arr(str())), deferred: opt(str()) }),
	},
	{ name: "view.camera", card: "frame", group: "view", ...screenRead, summary: "Where the person's screen is looking, and its zoom.", params: [], result: Camera },
	{
		name: "view.move",
		card: "frame",
		group: "view",
		...screenChange,
		summary: "Move the person's camera outright: { x, y, zoom }, zoom 1 is life size.",
		params: [p("camera", obj({ x: num(), y: num(), zoom: num(), animate: opt(bool()) }))],
		result: Camera,
	},
	{ name: "view.viewport", card: "frame", group: "view", ...screenRead, summary: "The room the screen has, in CSS pixels, or null when no screen has said.", params: [], result: union(obj({ width: num(), height: num() }), nul) },
	{ name: "view.cursor", card: "frame", group: "view", ...screenChange, summary: "A labelled dot on a card, at the card's coordinates; null removes it.", params: [p("card", str()), p("at", union(Point, nul))] },
	{
		name: "view.reload",
		card: "frame",
		group: "view",
		...screenChange,
		summary:
			"Reload the card in every browser and iPad showing it on that canvas; with no `canvas`, on every canvas it is on. For a change the watcher cannot see (a file it fetches, data from outside). No file changes.",
		params: [p("options", obj({ card: opt(str()), canvas: opt(str()) }))],
		result: obj({ reloaded: num() }),
	},

	// --- apps --------------------------------------------------------------------------------
	{ name: "apps.list", group: "apps", ...outsideRead, summary: "Every app in the deck's apps/ folder, with its state.", params: [], result: arr(AppState) },
	{ name: "apps.status", group: "apps", ...outsideRead, summary: "One app's state.", params: [p("name", str())], result: AppState },
	{
		name: "apps.create",
		group: "apps",
		...deckChange,
		summary: 'A new app folder from a starter ("static" default, "node", "solid", "react", "next"), and the item that shows it on a canvas: decks.canvas.insert(item) places it.',
		params: [p("name", str()), o("options", obj({ starter: opt(lit("static", "node", "solid", "react", "next")), title: opt(str()) }))],
		result: obj({ name: str(), kind: AppKind, folder: str(), files: arr(str()), item: AppItem, url: str(), repo: opt(obj({ branch: str(), head: str() })), next: str() }),
	},
	{
		name: "apps.repo",
		group: "apps",
		...deckChange,
		summary: "Its git repository, made now with everything committed if the folder is not one yet: branch, last commit, changed files, origin.",
		params: [p("name", str())],
		result: obj({ branch: str(), head: str(), dirty: opt(num()), remote: opt(str()) }),
	},
	{
		name: "apps.clone",
		group: "apps",
		...deckChange,
		summary: "Take in an app from an https:// or git@host:path address, and the item that shows it on a canvas. Nothing is installed or run.",
		params: [p("url", str()), o("options", obj({ name: opt(str()), title: opt(str()) }))],
		result: obj({ name: str(), kind: AppKind, folder: str(), item: AppItem, url: str(), repo: obj({ branch: str(), head: str(), remote: opt(str()) }), next: str() }),
	},
	{ name: "apps.item", group: "apps", ...outsideRead, summary: 'The item that shows an app, { type: "app", app: name }, for an app whose folder you wrote yourself: decks.canvas.insert(item) places it.', params: [p("name", str())], result: AppItem },
	{ name: "apps.build", group: "apps", ...outsideChange, summary: "Build it, waiting up to 15 s; `pending` means ask its status later.", params: [p("name", str())], result: AppOutcome },
	{ name: "apps.run", group: "apps", ...outsideChange, summary: "Start it, waiting up to 15 s.", params: [p("name", str())], result: AppOutcome },
	{ name: "apps.stop", group: "apps", ...outsideChange, summary: "Stop it.", params: [p("name", str())], result: obj({ stopped: bool() }) },
	{ name: "apps.restart", group: "apps", ...outsideChange, summary: "Stop and start again after a code change. The items showing it reload by themselves.", params: [p("name", str())], result: AppOutcome },
	{
		name: "apps.delete",
		group: "apps",
		...deckChange,
		summary: "Delete an app: stop it, move its folder to the deck's trash (.decks/trash/apps), and take the items showing it off your canvases. The folder can be moved back by hand.",
		params: [p("name", str())],
		result: obj({ deleted: str(), trash: str(), items: arr(str()) }),
	},
	{ name: "apps.logs", group: "apps", ...outsideRead, summary: "Its recent output.", params: [p("name", str()), o("options", obj({ tail: opt(int()) }))], result: arr(str()) },
	{
		name: "apps.check",
		group: "apps",
		...outsideRead,
		summary: "Open it in the server's browser and say what is wrong: what fit is to a card. Read `verdict`; `file` is a picture.",
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
		summary: "Forward a local server so a card can frame it: read with nothing, { open: port, label } to forward one, { close: port } to stop. `node` passes the path on; `rnode` strips it.",
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
		summary: "A pairing code for another Decks front end, such as Studio, or a terminal elsewhere (decks login <code>), to connect to this harness with: six digits, ten minutes, once. Only on the harness's own machine, where a terminal logs in with decks login and no code; Settings never shows one.",
		params: [],
		result: obj({ code: str(), expires: num() }),
	},
	{ name: "studio.status", group: "misc", ...outsideRead, summary: "Whether this harness syncs with Decks Studio, and with which.", params: [], result: obj({ connected: bool(), url: opt(str()) }) },
	{ name: "studio.disconnect", group: "misc", ...outsideChange, summary: "Stop syncing with Decks Studio and forget the key. Only the person can call it.", params: [], result: obj({ connected: bool() }) },
	{ name: "now", card: "frame", group: "misc", ...outsideRead, summary: "The time where the person is.", params: [], result: obj({ iso: str(), timezone: str(), words: str(), epoch: num() }, true) },
];

/** A call by its name: `canvas.insert`. */
export const VERB_BY_NAME: ReadonlyMap<string, Verb> = new Map(VERBS.map((verb) => [verb.name, verb]));

/** The command-line name of a call: `canvas.insert` -> `canvas insert`, `canvas.copyShared` -> `canvas copy-shared`. */
export function commandOf(verb: Verb): string[] {
	return verb.name.split(".").map((part) => part.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
}

/** The calls a card may make that go to `route` (`Verb.card`). */
export function cardCalls(route: CardRoute): ReadonlySet<string> {
	return new Set(VERBS.filter((verb) => verb.card === route).map((verb) => verb.name));
}
