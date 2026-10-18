import { any, arr, bool, int, lit, nul, num, obj, opt, str, union, type Schema } from "./schema.ts";
import { AgentKind, AgentMode, AppKind, AppOutcome, AppState, Board, Box, Corner, PartialBox, PenEdit, PenItem, Point, Sized, WebTarget } from "./types.ts";

/**
 * Every verb Decks answers, declared once.
 *
 * This table is the API. The server makes a route of each entry (`POST /api/v1/<name>`), checks
 * the arguments against `params` before the handler runs, and the SDK is generated from it in its
 * three forms: the TypeScript client, the `decks` command and the MCP server. Adding a verb is
 * adding an entry here and its handler on the server; nothing else is written by hand.
 *
 * `effect` sorts the verbs by what they touch, which is what a shared canvas cares about:
 * - `change`: writes the stage, its drawing or a board's file; everyone on the canvas sees it.
 * - `view`: moves only the caller's own view (its camera, which canvas it is on).
 * - `read`: changes nothing.
 * - `outside`: agents, apps, the person's Chrome, forwarded ports; not the canvas.
 */

export type Effect = "change" | "view" | "read" | "outside";
export type Group = "boards" | "stage" | "view" | "stages" | "pen" | "agents" | "apps" | "web" | "misc";

export interface Param {
	name: string;
	schema: Schema;
	optional?: boolean;
	/** For a list of paths: on the command line, every remaining word fills it. */
	variadic?: boolean;
}

export interface Verb {
	/** The verb's name, dotted for a group: `move`, `pen.edit`, `apps.build`. */
	name: string;
	group: Group;
	effect: Effect;
	summary: string;
	params: Param[];
	/** What it answers with; absent when it answers with nothing. */
	result?: Schema;
}

const p = (name: string, schema: Schema, more: Partial<Param> = {}): Param => ({ name, schema, ...more });
const o = (name: string, schema: Schema, more: Partial<Param> = {}): Param => ({ name, schema, optional: true, ...more });
const paths = (name = "path"): Param => ({ name, schema: union(str(), arr(str())), variadic: true });

export const VERBS: readonly Verb[] = [
	// --- boards: make, size and refresh a board file ------------------------------------------
	{
		name: "newBoard",
		group: "boards",
		effect: "change",
		summary:
			'Write a blank board and return its path. The title is the finding, as a sentence. `format` "board" (default) is one HTML page you design; "slides" is a reveal deck of <section>s. `at` is its top-left corner on your stage: say it every time, after reading the stage with pen.read. Left out, the board goes beside your newest board and the result says where.',
		params: [p("options", obj({ title: str(), format: opt(lit("board", "slides")), w: opt(num()), h: opt(num()), at: opt(Corner) }))],
		result: str(),
	},
	{
		name: "fit",
		group: "boards",
		effect: "change",
		summary:
			"Set a board's height from its content, measured at the width it has on a canvas (`canvas` names one, else your stage's). The board must be on it. The notes say what the browser found: the height, the word count, the smallest type, content wider than the board, boxes that cut off their content, and any view that breaks when a control is pressed. Use it instead of a screenshot.",
		params: [p("path", str()), o("options", obj({ canvas: opt(str()), margin: opt(num()) }))],
		result: obj({ path: str(), w: num(), h: num(), content: opt(obj({ w: num(), h: num(), page: opt(num()) })) }),
	},
	{
		name: "resize",
		group: "boards",
		effect: "change",
		summary: "Set a board's size outright.",
		params: [p("path", str()), p("size", obj({ w: opt(num()), h: opt(num()) }))],
		result: Sized,
	},
	{
		name: "report",
		group: "boards",
		effect: "change",
		summary: "Name boards you edited without showing them, so they are listed as yours.",
		params: [paths()],
		result: obj({ reported: arr(str()) }),
	},
	{
		name: "reload",
		group: "boards",
		effect: "view",
		summary: "Reload a board's frame, if you changed something the watcher cannot see.",
		params: [p("path", str())],
	},

	// --- boards on your stage --------------------------------------------------------------------
	{
		name: "boards",
		group: "stage",
		effect: "read",
		summary: "Every board in the deck, placed as your stage has them.",
		params: [],
		result: arr(Board),
	},
	{
		name: "show",
		group: "stage",
		effect: "change",
		summary:
			"Add these boards to your stage and move the camera to them. `at` places the one board named, top-left corner; for a board already on the stage it moves it. `highlight` outlines one data-id. A drawn item's id can be named instead of a board path: the camera goes to it.",
		params: [p("target", union(str(), arr(str()))), o("options", obj({ fit: opt(lit("board", "all")), highlight: opt(str()), animate: opt(bool()), at: opt(Corner) }))],
		result: obj({ shown: arr(str()) }),
	},
	{
		name: "hide",
		group: "stage",
		effect: "change",
		summary: "Take boards off your stage, keeping them in your context.",
		params: [paths()],
	},
	{
		name: "move",
		group: "stage",
		effect: "change",
		summary: "Move a board on your stage: `at` is its top-left corner.",
		params: [p("path", str()), p("at", Point)],
		result: Board,
	},
	{
		name: "cursor",
		group: "stage",
		effect: "view",
		summary: "A labelled dot on a board, at board coordinates; null removes it.",
		params: [p("path", str()), p("at", union(Point, nul))],
	},

	// --- view ------------------------------------------------------------------------------------
	{
		name: "camera",
		group: "view",
		effect: "view",
		summary: "Where your stage is looking, or move it with { x, y, zoom }. `zoom` 1 is life size.",
		params: [o("at", obj({ x: num(), y: num(), zoom: num() })), o("options", obj({ animate: opt(bool()) }))],
		result: union(obj({ x: num(), y: num(), zoom: num() }), nul),
	},
	{
		name: "viewport",
		group: "view",
		effect: "read",
		summary: "The room your stage has on screen, in CSS pixels.",
		params: [],
		result: union(obj({ width: num(), height: num() }), nul),
	},
	{
		name: "screenshot",
		group: "view",
		effect: "read",
		summary:
			'A picture of your stage, or part of it, as the person sees it, saved to `file`. `of` is an item\'s id, a board\'s path, a list of them, or a box; nothing is the whole stage. A .pen file\'s path pictures that file whole. `format` "jpeg" or "pdf", and `to` a deck path, make a file to hand on. One board\'s path alone is that board as the browser has it now.',
		params: [o("options", obj({ of: opt(union(str(), arr(str()), PartialBox)), scale: opt(num()), format: opt(lit("png", "jpeg", "pdf")), to: opt(str()), scheme: opt(lit("light", "dark")) }))],
		result: obj({ file: str(), width: num(), height: num(), box: Box, how: opt(lit("canvas", "snapshot", "server")), note: opt(str()) }),
	},

	// --- stages ----------------------------------------------------------------------------------
	{
		name: "stages",
		group: "stages",
		effect: "read",
		summary: "Every stage (canvas) and who has it open. A stage's `name` is its folder and never changes; its `title` is what the person calls it.",
		params: [],
		result: arr(obj({ name: str(), title: str(), open: arr(str()), boards: num(), mine: opt(lit(true)) })),
	},
	{
		name: "open",
		group: "stages",
		effect: "view",
		summary: "Move to another stage, by name or title: its boards become the ones you show, hide and move.",
		params: [p("name", str())],
		result: obj({ stage: str(), boards: arr(str()) }),
	},
	{
		name: "newStage",
		group: "stages",
		effect: "change",
		summary: "Make an empty stage from a title, and open it.",
		params: [p("title", str())],
		result: obj({ stage: str() }),
	},
	{
		name: "title",
		group: "stages",
		effect: "change",
		summary: "Name the canvas you are on, or read its name with nothing. Name it for what is on it, as a few words a person would look for.",
		params: [o("title", str())],
		result: obj({ stage: str(), title: str() }),
	},

	// --- the drawing -----------------------------------------------------------------------------
	{
		name: "pen.read",
		group: "pen",
		effect: "read",
		summary: 'Your stage\'s drawing: every item as saved, plus its `box` on the stage. With `path`, any .pen file ("frames/ui/button", "canvases/<name>/canvas.pen").',
		params: [o("path", str())],
		result: obj({ stage: opt(str()), file: str(), ref: opt(str()), version: str(), error: opt(str()), children: arr(any()) }),
	},
	{
		name: "pen.edit",
		group: "pen",
		effect: "change",
		summary: "Edit your stage's drawing, or with `path` any .pen file; the edits apply together or not at all. A `box` places an item on the stage.",
		params: [p("edits", arr(PenEdit)), o("options", obj({ path: opt(str()) }))],
		result: obj({ rev: opt(num()), file: opt(str()), ref: opt(str()), results: arr(obj({ op: str(), id: str(), box: opt(Box), note: opt(str()) })) }),
	},
	{
		name: "pen.create",
		group: "pen",
		effect: "change",
		summary: 'A new .pen file at `path` ("frames/ui/button"), with `item` as its one reusable item. One in frames/ is placed on any stage with { type: "ref", ref }.',
		params: [p("path", str()), o("item", PenItem)],
		result: obj({ file: str(), ref: opt(str()), id: str() }),
	},
	{
		name: "pen.save",
		group: "pen",
		effect: "change",
		summary: "Save an item of your stage as a frame file at `path` in frames/, and put a ref to it in its place (`replace: false` leaves the stage alone).",
		params: [p("id", str()), p("path", str()), o("options", obj({ replace: opt(bool()) }))],
		result: obj({ frame: str(), ref: str(), replaced: bool(), overwrote: bool() }),
	},
	{
		name: "pen.file",
		group: "pen",
		effect: "read",
		summary: "The path of your stage's .pen file, to edit it by hand instead.",
		params: [],
		result: str(),
	},

	// --- agents ----------------------------------------------------------------------------------
	{
		name: "me",
		group: "agents",
		effect: "outside",
		summary:
			"Who you are: read with nothing, change with a patch. Set all four first in every session: a short name of your own, an avatar (an <svg> with xmlns and a viewBox, or an emoji), the project as `workspace`, and up to four tags for what you are doing now.",
		params: [o("patch", obj({ name: opt(str()), avatar: opt(union(obj({ emoji: str() }), obj({ svg: str() }))), tags: opt(arr(str())), workspace: opt(str()) }))],
		result: obj({ name: str(), avatar: opt(str()), color: str(), tags: opt(arr(str())), workspace: opt(str()), avatarChanged: opt(str()) }),
	},
	{
		name: "agents",
		group: "agents",
		effect: "read",
		summary: "Every agent; `filter.workspace` narrows to one project.",
		params: [o("options", obj({ filter: opt(obj({ workspace: opt(str()) })) }))],
		result: arr(obj({ id: str(), name: str(), me: bool(), state: str(), kind: str(), tags: arr(str()), workspace: opt(str()), queued: num() })),
	},
	{
		name: "send",
		group: "agents",
		effect: "outside",
		summary: "Hand work over, and carry on: to an agent by name, or to { name, kind }, which makes it first. Returns at once; `reply: true` brings their report back to you.",
		params: [
			p("to", union(str(), obj({ name: str(), kind: opt(AgentKind), model: opt(str()), thinking: opt(str()), mode: opt(AgentMode), tags: opt(arr(str())), workspace: opt(str()) }))),
			p("work", obj({ task: str(), boards: opt(arr(str())), reply: opt(bool()) })),
		],
		result: obj({ queued: lit(true), position: num(), agent: opt(str()), name: opt(str()) }),
	},
	{
		name: "queue",
		group: "agents",
		effect: "read",
		summary: "What is waiting in an agent's queue: yours, or another's.",
		params: [o("agentId", str())],
		result: arr(obj({ from: str(), fromName: str(), task: str(), boards: arr(str()), at: num() })),
	},

	// --- apps ------------------------------------------------------------------------------------
	{
		name: "apps.list",
		group: "apps",
		effect: "outside",
		summary: "Every app in the deck's apps/ folder, with its status.",
		params: [],
		result: arr(AppState),
	},
	{ name: "apps.status", group: "apps", effect: "outside", summary: "One app's state.", params: [p("name", str())], result: AppState },
	{
		name: "apps.create",
		group: "apps",
		effect: "outside",
		summary: 'Make an app folder from a starter ("static" default, "node", "solid", "react", "next"), and its board.',
		params: [p("name", str()), o("options", obj({ starter: opt(lit("static", "node", "solid", "react", "next")), title: opt(str()) }))],
		result: obj({ name: str(), kind: AppKind, folder: str(), files: arr(str()), board: str(), url: str(), next: str() }),
	},
	{ name: "apps.board", group: "apps", effect: "outside", summary: "The board for an app whose folder you wrote yourself.", params: [p("name", str())], result: str() },
	{ name: "apps.build", group: "apps", effect: "outside", summary: "Build an app; waits up to fifteen seconds, and `pending` means ask status later.", params: [p("name", str())], result: AppOutcome },
	{ name: "apps.run", group: "apps", effect: "outside", summary: "Start an app; waits up to fifteen seconds.", params: [p("name", str())], result: AppOutcome },
	{ name: "apps.stop", group: "apps", effect: "outside", summary: "Stop an app.", params: [p("name", str())], result: obj({ stopped: bool() }) },
	{ name: "apps.restart", group: "apps", effect: "outside", summary: "After you change a server app's code: stop it and start it again. Its board reloads by itself.", params: [p("name", str())], result: AppOutcome },
	{ name: "apps.logs", group: "apps", effect: "outside", summary: "An app's log lines.", params: [p("name", str()), o("options", obj({ tail: opt(int()) }))], result: arr(str()) },
	{
		name: "apps.check",
		group: "apps",
		effect: "outside",
		summary: "The app opened in the server's browser: what fit is to a board. Read `verdict`; `file` is a picture.",
		params: [p("name", str())],
		result: obj({ verdict: str(), url: opt(str()), title: opt(str()), errors: arr(str()), failed: opt(arr(str())), words: opt(num()), file: opt(str()) }),
	},

	// --- the person's Chrome ---------------------------------------------------------------------
	{
		name: "web.status",
		group: "web",
		effect: "outside",
		summary: "Whether the person is sharing a Chrome tab through the Decks extension, and which.",
		params: [],
		result: obj({ paired: bool(), connected: bool(), tab: opt(obj({ title: str(), url: str() })), pending: opt(obj({ id: str(), text: str() })), closed: opt(str()) }),
	},
	{ name: "web.pairing", group: "web", effect: "outside", summary: "A code to pair the Decks extension.", params: [], result: obj({ code: str(), path: str(), note: str() }) },
	{ name: "web.repair", group: "web", effect: "outside", summary: "A fresh pairing code.", params: [], result: obj({ code: str() }) },
	{ name: "web.board", group: "web", effect: "outside", summary: "The board that shows the shared tab.", params: [], result: str() },
	{ name: "web.open", group: "web", effect: "outside", summary: "Open an address in the shared tab.", params: [p("url", str())], result: obj({ url: str(), title: str() }) },
	{
		name: "web.read",
		group: "web",
		effect: "outside",
		summary: "The shared page: address, title, and an accessibility tree that names every field and button with a [ref=e42]. References die when the tab navigates.",
		params: [],
		result: obj({ url: str(), title: str(), snapshot: str(), truncated: opt(bool()) }),
	},
	{ name: "web.screenshot", group: "web", effect: "outside", summary: "A picture of the shared tab.", params: [o("options", obj({ full: opt(bool()) }))], result: obj({ file: str(), width: num(), height: num() }) },
	{ name: "web.fill", group: "web", effect: "outside", summary: "Type into a field. Never passwords or codes.", params: [p("field", WebTarget), p("text", str())], result: obj({ field: str() }) },
	{ name: "web.select", group: "web", effect: "outside", summary: "Pick an option in a select.", params: [p("field", WebTarget), p("option", str())], result: obj({ field: str(), option: str() }) },
	{ name: "web.click", group: "web", effect: "outside", summary: "Click a button or link.", params: [p("what", WebTarget)], result: obj({ clicked: str() }) },
	{ name: "web.press", group: "web", effect: "outside", summary: "Press a key.", params: [p("key", str())], result: obj({ pressed: str() }) },
	{
		name: "web.submit",
		group: "web",
		effect: "outside",
		summary: "Submit a form; asks the person first and may come back with allowed: false.",
		params: [o("what", WebTarget), o("options", obj({ ask: opt(bool()) }))],
		result: obj({ submitted: str(), allowed: bool() }),
	},
	{ name: "web.stop", group: "web", effect: "outside", summary: "Stop driving the shared tab.", params: [] },

	// --- addresses and time ----------------------------------------------------------------------
	{ name: "url", group: "misc", effect: "read", summary: "The URL of a board, for a Playwright screenshot.", params: [p("path", str())], result: str() },
	{ name: "resolve", group: "misc", effect: "read", summary: "A file on disk -> the URL a board should embed.", params: [p("file", str())], result: str() },
	{
		name: "ports",
		group: "misc",
		effect: "outside",
		summary:
			"Servers on this machine, forwarded through Decks so a board can frame them: read with nothing, { open: port, label } to forward one, { close: port } to stop. `node` passes the path on; `rnode` strips it.",
		params: [o("change", obj({ open: opt(int()), close: opt(int()), label: opt(str()) }))],
		result: arr(obj({ port: num(), label: opt(str()), by: opt(str()), at: num(), node: str(), rnode: str() })),
	},
	{ name: "now", group: "misc", effect: "read", summary: "The time where the person is.", params: [], result: obj({ iso: str(), timezone: str(), words: str(), epoch: num() }) },
];

/** A verb by its name, `pen.edit`. */
export const VERB_BY_NAME: ReadonlyMap<string, Verb> = new Map(VERBS.map((verb) => [verb.name, verb]));

/** The command-line name of a verb: `pen.edit` -> `pen edit`, `newBoard` -> `new-board`. */
export function commandOf(verb: Verb): string[] {
	return verb.name.split(".").map((part) => part.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
}
