import { any, arr, bool, int, lit, named, nul, num, obj, opt, rec, str, union, type Infer } from "./schema.ts";

// The shapes calls take and give. Each is named, so the generators declare it
// once. One geometry: Box, Size, Point. A path starts at the deck's root.

export const Box = named("Box", obj({ x1: num(), y1: num(), x2: num(), y2: num() }), "A box on a canvas: both corners.");
export const BoxChange = named("BoxChange", obj({ x1: opt(num()), y1: opt(num()), x2: opt(num()), y2: opt(num()) }), "Some corners of a box.");
export const Point = named("Point", obj({ x: num(), y: num() }), "A point on a canvas.");
export const Size = named("Size", obj({ w: num(), h: num() }), "A width and a height.");
export const SizeChange = named("SizeChange", obj({ w: opt(num()), h: opt(num()) }), "A width, a height, or both.");
export const Deleted = named("Deleted", obj({ deleted: str() }), "What a delete answers: the id or path that went.");

export const Item = named(
	"Item",
	obj({ type: str(), id: opt(str()), card: opt(str()), html: opt(str()), title: opt(str()), app: opt(str()), path: opt(str()), box: opt(Box), children: opt(arr(any())) }, true),
	"Anything on a canvas, with pen.dev's own fields and its box. A card is { type: card, card: <path> }.",
);
const Parent = union(str(), nul);
export const ItemOp = named(
	"ItemOp",
	union(
		obj({ op: lit("insert"), item: Item, at: opt(Point), beside: opt(str()), below: opt(str()), parent: opt(Parent), index: opt(int()) }),
		obj({ op: lit("update"), id: str(), set: opt(rec(any())), at: opt(Point), size: opt(SizeChange) }),
		obj({ op: lit("replace"), id: str(), item: Item }),
		obj({ op: lit("delete"), id: str() }),
		obj({ op: lit("move"), id: str(), at: opt(Point), beside: opt(str()), below: opt(str()), parent: opt(Parent), index: opt(int()) }),
		obj({ op: lit("copy"), id: str(), as: opt(str()), at: opt(Point), parent: opt(Parent) }),
	),
	"One change in a batch: the item call of that name, with its item or id inside.",
);
export const Clip = named("Clip", obj({ id: str(), canvas: str(), box: Box, items: int() }), "Items held for a paste.");

export const Shared = named("Shared", obj({ owner: str(), role: lit("edit", "view"), studio: opt(str()) }), "Who shared a friend's canvas, and what you may do.");
export const Canvas = named(
	"Canvas",
	obj({
		name: str(),
		title: str(),
		open: arr(str()),
		cards: int(),
		file: opt(str()),
		rev: opt(int()),
		shared: opt(Shared),
		studio: opt(str()),
		variables: opt(rec(any())),
		undo: opt(bool()),
		redo: opt(bool()),
	}),
	"A canvas. name is its folder and never changes; title is what the person calls it.",
);

export const Placement = named("Placement", obj({ card: str(), canvas: str(), box: Box, clipped: opt(bool()) }), "A card on one canvas: where it sits and how big.");
export const Card = named("Card", obj({ path: str(), title: str(), by: opt(str()), placements: opt(arr(Placement)) }), "A card: its index.html's path, the finding it states, who last wrote it.");
export const Frame = named("Frame", obj({ path: str(), id: str(), ref: opt(str()) }), "A reusable frame file and its one item.");

export const File = named("File", obj({ path: str(), size: opt(int()), rev: opt(int()), by: opt(str()), at: opt(num()), dir: opt(bool()) }), "A file or folder in the deck.");
export const FileText = named("FileText", obj({ path: str(), text: str(), rev: int(), truncated: opt(bool()) }), "A file's words.");
export const FileMatch = named("FileMatch", obj({ path: str(), line: int(), text: str() }), "One line that matched a search.");
export const TextEdit = named("TextEdit", obj({ find: str(), replace: str(), all: opt(bool()) }), "Replace exact words in a file.");
export const Screenshot = named("Screenshot", obj({ file: str(), size: Size, box: opt(Box), how: opt(str()) }), "A saved picture.");

export const AgentKind = named("AgentKind", lit("pi", "claude", "opencode", "opencode2", "antigravity"));
export const AgentMode = named("AgentMode", lit("manual", "acceptEdits", "plan", "auto"));
export const Avatar = named("Avatar", union(obj({ emoji: str() }), obj({ svg: str() })), "An emoji, or an SVG with a viewBox.");
export const Agent = named(
	"Agent",
	obj({
		id: str(),
		name: str(),
		avatar: opt(str()),
		color: opt(str()),
		kind: opt(AgentKind),
		workspace: opt(str()),
		tags: arr(str()),
		canvas: opt(str()),
		state: opt(str()),
		queued: opt(int()),
		model: opt(str()),
		thinking: opt(str()),
		mode: opt(AgentMode),
		token: opt(str()),
	}),
	"Who works. canvas is the agent's home canvas. token is given only by agent.attach.",
);
export const AgentChange = named(
	"AgentChange",
	obj({ name: opt(str()), avatar: opt(Avatar), tags: opt(arr(str())), workspace: opt(union(str(), nul)), canvas: opt(str()), model: opt(str()), thinking: opt(str()), mode: opt(AgentMode) }),
	"What agent.update may change.",
);
export const Message = named(
	"Message",
	obj({ id: str(), from: str(), to: str(), task: str(), cards: arr(str()), at: num(), reply: opt(bool()), state: opt(lit("delivered", "queued", "new")), position: opt(int()) }),
	"A hand-off between agents, and where it now is.",
);
export const News = named("News", obj({ rev: int(), changes: arr(obj({ canvas: opt(str()), ids: arr(str()), by: str(), rev: int(), event: str() })), mail: arr(Message) }), "What changed since the caller last asked.");

export const Camera = named("Camera", obj({ x: num(), y: num(), zoom: num() }), "Where a screen looks, and its zoom (1 is life size).");
export const View = named(
	"View",
	obj({ canvas: str(), camera: opt(Camera), screen: opt(Size), moved: opt(bool()), waiting: opt(str()) }),
	"What a screen shows. waiting says why it has not moved yet.",
);

export const AppKind = named("AppKind", lit("static", "build", "server"));
export const AppStatus = named("AppStatus", lit("stopped", "installing", "building", "starting", "running", "asleep", "broken"));
export const Repo = named("Repo", obj({ branch: str(), head: str(), dirty: opt(int()), remote: opt(str()) }));
export const App = named(
	"App",
	obj({ name: str(), title: str(), kind: AppKind, status: AppStatus, url: str(), folder: opt(str()), port: opt(int()), errors: opt(arr(str())), seen: opt(num()), at: opt(num()), version: opt(int()), repo: opt(Repo) }),
	"An app folder and its state.",
);
export const AppCheck = named("AppCheck", obj({ verdict: str(), url: opt(str()), title: opt(str()), errors: arr(str()), failed: opt(arr(str())), words: opt(int()), file: opt(str()) }));
export const Port = named("Port", obj({ port: int(), label: opt(str()), by: opt(str()), at: num(), path: str(), stripped: str() }), "A forwarded port and its two addresses.");

export const Tab = named(
	"Tab",
	obj({ paired: bool(), connected: bool(), url: opt(str()), title: opt(str()), pending: opt(obj({ id: str(), text: str() })), closed: opt(str()) }),
	"The shared Chrome tab.",
);
export const TabPage = named("TabPage", obj({ url: str(), title: str(), snapshot: str(), truncated: opt(bool()) }), "The tab's page as a tree of fields, each with a ref.");
export const TabTarget = named("TabTarget", union(str(), obj({ ref: str() }), obj({ name: str(), nth: opt(int()) })), "A field or button: its label, { ref }, or { name, nth }.");
export const Pairing = named("Pairing", obj({ code: str(), expires: num(), note: opt(str()) }), "A one-time code.");
export const Studio = named("Studio", obj({ connected: bool(), url: opt(str()) }));
export const Now = named("Now", obj({ iso: str(), timezone: str(), words: str(), epoch: num() }), "The time where the person is.");
export const Deck = named("Deck", obj({ version: str(), protocol: str(), timezone: opt(str()), requireCode: opt(bool()), warnings: arr(str()) }), "The deck as its server sees it.");

export const ChatItem = named("ChatItem", obj({ id: str(), kind: str(), at: num() }, true), "One entry of a conversation.");
export const Account = named("Account", obj({ id: str(), label: str(), active: bool(), spending: opt(str()) }), "A login the harness holds.");
export const Runtime = named("Runtime", obj({ kind: AgentKind, available: bool(), reason: opt(str()), models: opt(arr(str())) }), "A kind of agent this harness can run.");
export const Settings = named("Settings", obj({}, true), "A settings page: the harness's, or one agent's.");

export type Item = Infer<typeof Item>;
export type ItemOp = Infer<typeof ItemOp>;
export type Box = Infer<typeof Box>;
export type Agent = Infer<typeof Agent>;
