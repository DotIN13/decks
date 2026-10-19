import { any, arr, bool, int, lit, named, num, obj, opt, rec, str, union } from "./schema.ts";

/**
 * The named shapes the verbs share. Each prints as its name in the SDK's TypeScript and is
 * declared there once. The ones the design names (`Board`, `Placement`, `Canvas`, `Fit`,
 * `Screenshot`, `Agent`, `Message`, `Camera`, `AppState`, `AppOutcome`, `Item`) are the
 * "Types" column of the SDK redesign; the rest are the shapes the old names still answer with.
 */

export const Box = named("Box", obj({ x1: num(), y1: num(), x2: num(), y2: num() }), "A box on a canvas: both corners, so an edge is never a sum.");
export const PartialBox = obj({ x1: opt(num()), y1: opt(num()), x2: opt(num()), y2: opt(num()) });
export const Corner = named("Corner", union(obj({ x1: num(), y1: num() }), obj({ x: num(), y: num() })), "A top-left corner on a canvas: { x1, y1 }, or { x, y }.");
export const Point = named("Point", obj({ x: num(), y: num() }));
export const Size = named("Size", obj({ w: opt(num()), h: opt(num()) }), "A width, a height, or both.");

// --- the redesign's types -------------------------------------------------------------------

export const Board = named("Board", obj({ path: str(), title: str(), lastWrittenBy: opt(str()) }), "A board file in the deck. `title` is the finding it states.");

export const Placement = named(
	"Placement",
	obj({ board: str(), canvas: str(), box: Box, clipped: opt(bool()) }),
	"A board on one canvas: where it sits and how big it is there. `clipped` means its content runs past that box.",
);

export const Canvas = named(
	"Canvas",
	obj({ name: str(), title: str(), open: arr(str()), boards: num() }),
	"A canvas (a stage file) and who has it open. `name` is its folder and never changes; `title` is what the person calls it.",
);

export const Fit = named("Fit", obj({ board: str(), canvas: str(), w: num(), h: num(), notes: str() }), "What the browser measured while fitting a board.");

export const Screenshot = named(
	"Screenshot",
	obj({ file: str(), width: num(), height: num(), box: Box, how: opt(lit("canvas", "snapshot", "server")), note: opt(str()) }),
	"A saved image of a canvas, or of part of it.",
);

export const Agent = named(
	"Agent",
	obj({
		id: opt(str()),
		name: str(),
		avatar: opt(str()),
		color: opt(str()),
		kind: opt(str()),
		workspace: opt(str()),
		tags: arr(str()),
		canvas: opt(str()),
		state: opt(str()),
		queued: opt(num()),
		model: opt(str()),
		thinking: opt(str()),
		mode: opt(str()),
		avatarChanged: opt(str()),
	}),
	"Who works. `canvas` is the agent's home canvas; `state` and `queued` say what it is doing and how much is waiting for it.",
);

export const Message = named(
	"Message",
	obj({ from: str(), task: str(), boards: arr(str()), at: num(), reply: opt(bool()) }),
	"A hand-off in an inbox: who sent it, the task, the boards it names, when, and whether they want a reply.",
);

export const Camera = named("Camera", obj({ x: num(), y: num(), zoom: num() }), "Where a screen looks on a canvas, and its zoom (1 is life size).");

export const Item = named(
	"Item",
	obj({ type: str(), id: opt(str()), board: opt(str()), box: opt(Box), children: opt(arr(any())) }, true),
	'Anything on a canvas: a note, text, a shape, an arrow, a frame, a ref, or a board, with its own pen.dev fields and its `box`. A board is { type: "board", board: <path>, width? }.',
);

/** Where an item goes: a corner, or 160 px clear of another item; and which frame it goes into. */
export const Place = obj({
	canvas: opt(str()),
	frame: opt(str()),
	at: opt(Corner),
	beside: opt(str()),
	below: opt(str()),
	parent: opt(union(str(), { type: "null" })),
	index: opt(int()),
});

export const CanvasOp = named(
	"CanvasOp",
	union(
		obj({ op: lit("insert"), item: Item, at: opt(Corner), beside: opt(str()), below: opt(str()), parent: opt(union(str(), { type: "null" })), index: opt(int()) }),
		obj({ op: lit("update"), id: str(), set: opt(rec(true)), at: opt(Corner), size: opt(Size) }),
		obj({ op: lit("replace"), id: str(), item: Item }),
		obj({ op: lit("delete"), id: str() }),
		obj({ op: lit("move"), id: str(), at: opt(Corner), beside: opt(str()), below: opt(str()), parent: opt(union(str(), { type: "null" })), index: opt(int()) }),
		obj({ op: lit("copy"), id: str(), as: opt(str()), at: opt(Corner), parent: opt(union(str(), { type: "null" })) }),
		obj({ op: lit("variables"), set: rec(true), themes: opt(union(rec(arr(str())), { type: "null" })) }),
	),
	"One change in a batch: the same as the call of that name, with the item or id in the op.",
);

// --- shapes the old names answer with ------------------------------------------------------

export const PlacedBoard = named(
	"PlacedBoard",
	obj({
		path: str(),
		title: str(),
		x: num(),
		y: num(),
		w: num(),
		h: num(),
		box: Box,
		content: opt(obj({ w: num(), h: num() })),
		clipped: opt(bool()),
		inContext: arr(str()),
		lastWrittenBy: opt(str()),
	}),
	"A board as the old `boards` call has it, placed on the caller's canvas.",
);

export const PenItem = named("PenItem", obj({ type: str(), id: opt(str()), children: opt(arr(any())) }, true), "One item of a pen.dev `.pen` document: a `type`, an `id`, and pen's own fields.");

export const PenEdit = named(
	"PenEdit",
	union(
		obj({ op: lit("insert"), node: PenItem, parent: opt(union(str(), { type: "null" })), index: opt(int()), box: opt(PartialBox) }),
		obj({ op: lit("update"), id: str(), set: opt(rec(true)), box: opt(PartialBox) }),
		obj({ op: lit("replace"), id: str(), node: PenItem }),
		obj({ op: lit("delete"), id: str() }),
		obj({ op: lit("move"), id: str(), parent: opt(union(str(), { type: "null" })), index: opt(int()), box: opt(PartialBox) }),
		obj({ op: lit("copy"), id: str(), parent: opt(union(str(), { type: "null" })), index: opt(int()), box: opt(PartialBox), as: opt(str()) }),
		obj({ op: lit("variables"), set: rec(true), themes: opt(union(rec(arr(str())), { type: "null" })) }),
	),
	'An edit to a .pen file, as the old pen.edit took it. Items are named by id; one inside an instance by its path, "card-1/label".',
);

export const WebTarget = named("WebTarget", union(str(), obj({ ref: str() }), obj({ name: str(), nth: opt(int()) })), 'A field or button: its label, { ref: "e42" } from read, or { name, nth }.');

export const AppKind = named("AppKind", lit("static", "build", "server"));
export const AppStatus = lit("stopped", "installing", "building", "starting", "running", "asleep", "broken");
export const AppState = named(
	"AppState",
	obj({
		name: str(),
		title: str(),
		kind: AppKind,
		status: AppStatus,
		url: str(),
		board: str(),
		port: opt(num()),
		error: opt(str()),
		seenAt: opt(num()),
		at: opt(num()),
		version: opt(num()),
	}),
);
export const AppOutcome = named("AppOutcome", obj({ ok: bool(), status: AppStatus, ms: num(), errors: arr(str()), pending: opt(lit(true)) }));

export const AgentKind = lit("pi", "claude", "opencode", "opencode2", "antigravity");
export const AgentMode = lit("manual", "acceptEdits", "plan", "auto");

export const Sized = obj({ path: str(), w: num(), h: num() });
