import { defineCall } from "../call.ts";
import { any, arr, bool, int, lit, nul, obj, opt, str, union } from "../schema.ts";
import { Agent, ChatItem, Deleted } from "../shapes.ts";
import { PERSON } from "./parts.ts";

// An agent's conversation, answered by the harness, for the person only.

const Id = str("The agent's id.");
const Parts = arr(any("A part of the message: a card, a comment, a file, as the composer holds them."));
const Queued = obj({ items: arr(obj({ id: str(), text: str() })), held: bool() });
const harness = { who: PERSON, side: "harness" } as const;

export const focus = defineCall({ name: "chat.focus", summary: "Bring an agent's conversation up: the one every new page starts on.", ...harness, args: { agent: Id }, answer: Agent, effect: "change" });

export const send = defineCall({
	name: "chat.send",
	summary: "Send the agent a message from the person: words and the parts the composer holds.",
	...harness,
	args: { agent: Id, text: str(), parts: opt(Parts) },
	answer: ChatItem,
	effect: "change",
});

export const abort = defineCall({ name: "chat.abort", summary: "Stop the agent's turn.", ...harness, args: { agent: Id }, answer: Agent, effect: "change" });

export const queue = defineCall({
	name: "chat.queue",
	summary: "The person's own queue for an agent: add a message, remove one, send one now, or release the queue.",
	...harness,
	args: { agent: Id, action: lit("add", "remove", "send", "release"), text: opt(str()), parts: opt(Parts), item: opt(str()) },
	answer: Queued,
	effect: "change",
});

export const list = defineCall({
	name: "chat.list",
	summary: "The conversation's entries, newest last; before and limit page back through older ones.",
	...harness,
	args: { agent: Id, before: opt(str()), limit: opt(int()) },
	answer: arr(ChatItem),
	effect: "read",
});

export const get = defineCall({ name: "chat.get", summary: "One entry whole, a tool call's full result included.", ...harness, args: { agent: Id, item: str() }, answer: ChatItem, effect: "read" });

export const preview = defineCall({
	name: "chat.preview",
	summary: "The cards as they were at an entry, for a rewind; null ends the preview.",
	...harness,
	args: { agent: Id, entry: union(str(), nul) },
	answer: obj({ entry: union(str(), nul), cards: obj({}, true) }),
	effect: "read",
});

export const rewind = defineCall({ name: "chat.rewind", summary: "Rewind the conversation to an entry.", ...harness, args: { agent: Id, entry: str() }, answer: Agent, effect: "change" });
export const fork = defineCall({ name: "chat.fork", summary: "A new agent forked from an entry of this one's conversation, brought up.", ...harness, args: { agent: Id, entry: str() }, answer: Agent, effect: "change" });

export const restore = defineCall({
	name: "chat.restore",
	summary: "Put the cards back as they were at an entry. Answers how many changed.",
	...harness,
	args: { agent: Id, entry: str() },
	answer: int(),
	effect: "change",
});

export const answer = defineCall({ name: "chat.answer", summary: "Answer a question the agent's runtime put up (chat.asked).", ...harness, args: { agent: Id, question: str(), answer: any() }, answer: Agent, effect: "change" });
export const remove = defineCall({ name: "chat.delete", summary: "Start the agent's conversation over.", ...harness, args: { agent: Id }, answer: Deleted, effect: "change" });
