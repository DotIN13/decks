import { defineEvent } from "./event.ts";
import { any, arr, bool, int, lit, nul, opt, str, union } from "./schema.ts";
import { Box, Camera, ChatItem, Message, Point, Splice } from "./shapes.ts";

// Every event, on one stream. Each says which ids changed, who changed them
// and the revision; a client that wants the whole thing makes a call.

export const deckChanged = defineEvent("deck.changed", "The deck's settings or pairings changed; deck.get reads them.", { part: opt(str()) });
export const canvasChanged = defineEvent("canvas.changed", "Canvases were made, renamed or deleted; canvas.list reads them.");
export const itemChanged = defineEvent("item.changed", "Items on a canvas changed. edits carries the ops when they fit in a message.", {
	from: opt(str("The revision the edits apply to.")),
	edits: opt(arr(any())),
	made: opt(arr(str("A client's own name for an edit this revision is the first to have."))),
});
export const cardChanged = defineEvent("card.changed", "A card's files changed, or it went.", { removed: opt(bool()), sized: opt(bool()) });
export const fileCreated = defineEvent("file.created", "A file was made, answering a client's request when it named one.", { request: opt(str()) });
export const fileChanged = defineEvent("file.changed", "A file changed: its words, its versions, its review or its Google copy. With part: words, the splices that made it.", {
	part: opt(str()),
	base: opt(int()),
	splices: opt(arr(Splice)),
	client: opt(str()),
	batch: opt(str()),
	change: opt(str()),
	settled: opt(bool()),
});
export const appChanged = defineEvent("app.changed", "An app's state changed; app.get reads it.", { status: opt(str()) });
export const agentChanged = defineEvent("agent.changed", "Agents' records or states changed; agent.get reads one.", { state: opt(str()) });
export const agentDeleted = defineEvent("agent.deleted", "An agent was removed.");
export const agentMailed = defineEvent("agent.mailed", "Mail for an agent whose host is connected; the host delivers it into a turn.", { message: Message }, "person");
export const agentRequested = defineEvent("agent.requested", "agent.create asks a host that offers the kind to start the agent.", { spec: any() }, "person");
export const agentActed = defineEvent("agent.acted", "An agent began or finished an edit, for its cursor and the glow on what it touched.", {
	phase: lit("start", "done"),
	what: str(),
	label: str(),
	color: str(),
	boxes: opt(arr(Box)),
});
export const viewChanged = defineEvent("view.changed", "Someone on a canvas moved, selected or looked elsewhere, or left.", {
	pointer: opt(union(Point, nul)),
	selection: opt(arr(str())),
	camera: opt(union(Camera, nul)),
	gone: opt(bool()),
});
export const viewRequested = defineEvent("view.requested", "A view call waits for a screen to act on it: move, focus, go to, reload.", { call: str(), args: any() });
export const tabChanged = defineEvent("tab.changed", "The shared tab changed; tab.status reads it.", { code: opt(str()) });

export const chatAdded = defineEvent("chat.added", "An entry was added to a conversation, or grew by delta while it streams.", { item: opt(ChatItem), delta: opt(str()), field: opt(lit("text", "thinking")) }, "person");
export const chatChanged = defineEvent("chat.changed", "The person's queue or the conversation's state changed.", {}, "person");
export const chatAsked = defineEvent("chat.asked", "The agent's runtime put up a question for the person.", { question: any() }, "person");
export const chatAnswered = defineEvent("chat.answered", "A question came down, answered or not.", {}, "person");
export const chatDrafted = defineEvent("chat.drafted", "Words for the composer, from speech or a card.", { text: str() }, "person");
export const accountChanged = defineEvent("account.changed", "The accounts, their spending, or which an agent spends from changed.", {}, "person");
export const runtimeChanged = defineEvent("runtime.changed", "The kinds of agent this harness can run, or its settings, changed.", {}, "person");
export const runtimeNoticed = defineEvent("runtime.noticed", "Something the person should see: information, a warning or an error.", { level: lit("info", "warn", "error"), text: str() }, "person");

export const EVENTS = [
	deckChanged,
	canvasChanged,
	itemChanged,
	cardChanged,
	fileCreated,
	fileChanged,
	appChanged,
	agentChanged,
	agentDeleted,
	agentMailed,
	agentRequested,
	agentActed,
	viewChanged,
	viewRequested,
	tabChanged,
	chatAdded,
	chatChanged,
	chatAsked,
	chatAnswered,
	chatDrafted,
	accountChanged,
	runtimeChanged,
	runtimeNoticed,
] as const;
