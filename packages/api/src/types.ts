import { any, arr, bool, int, lit, named, num, obj, opt, rec, str, union } from "./schema.ts";

/**
 * The named shapes the verbs share. Each prints as its name in the SDK's TypeScript and is
 * declared there once; these are the types `runtime/stage.d.ts` used to declare by hand.
 */

export const Box = named("Box", obj({ x1: num(), y1: num(), x2: num(), y2: num() }), "A box on the stage: both corners, so an edge is never a sum.");
export const PartialBox = obj({ x1: opt(num()), y1: opt(num()), x2: opt(num()), y2: opt(num()) });
export const Corner = named("Corner", union(obj({ x1: num(), y1: num() }), obj({ x: num(), y: num() })), "A board's top-left corner on the stage: { x1, y1 }, or { x, y }.");
export const Point = named("Point", obj({ x: num(), y: num() }));

export const Board = named(
	"Board",
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
	"A board as your stage has it. `inContext` names the agents holding it; `clipped` means content is past the edge.",
);

export const PenItem = named("PenItem", obj({ type: str(), id: opt(str()), children: opt(arr(any())) }, true), "One item of a pen.dev `.pen` document: a `type`, an `id`, and pen's own fields.");

export const PenEdit = named(
	"PenEdit",
	union(
		obj({ op: lit("insert"), node: PenItem, parent: opt(str()), index: opt(int()), box: opt(PartialBox) }),
		obj({ op: lit("update"), id: str(), set: opt(rec(true)), box: opt(PartialBox) }),
		obj({ op: lit("replace"), id: str(), node: PenItem }),
		obj({ op: lit("delete"), id: str() }),
		obj({ op: lit("move"), id: str(), parent: opt(union(str(), { type: "null" })), index: opt(int()), box: opt(PartialBox) }),
		obj({ op: lit("copy"), id: str(), parent: opt(str()), index: opt(int()), box: opt(PartialBox), as: opt(str()) }),
	),
	'An edit to the drawing. Items are named by id; one inside an instance by its path, "card-1/label".',
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
