import { defineCall } from "../call.ts";
import { arr, bool, lit, obj, opt, str } from "../schema.ts";
import { Agent, AgentChange, AgentKind, AgentMode, Deleted, Message, News } from "../shapes.ts";
import { AGENT, ANYONE, PEOPLE, PERSON, onCanvas } from "./parts.ts";

// Who works: their records, their mail, the clients that can start them.
// The server keeps the records and starts no one.

const Name = str("An agent's name or id.");

// Records: who works, and changing them.
export const me = defineCall({ name: "agent.me", summary: "You: name, avatar, colour, workspace, tags and home canvas; for the person, the agent whose conversation is on their screen; for a card, the agent whose home is the card's canvas.", who: ["person", "agent", "card"], args: {}, answer: Agent, effect: "read" });

export const list = defineCall({
	name: "agent.list",
	summary: "Every agent, or those on one project, with what each is doing and how much waits for it.",
	who: ANYONE,
	args: { workspace: opt(str()) },
	answer: arr(Agent),
	effect: "read",
});

export const get = defineCall({ name: "agent.get", summary: "One agent, by name or id.", who: ANYONE, args: { agent: Name }, answer: Agent, effect: "read" });

export const create = defineCall({
	name: "agent.create",
	summary: "Start a new agent: a host that offers its kind starts it. Named by the server when name is left out.",
	who: PEOPLE,
	args: {
		name: opt(str()),
		kind: opt(AgentKind),
		model: opt(str()),
		thinking: opt(str()),
		mode: opt(AgentMode),
		workspace: opt(str()),
		tags: opt(arr(str())),
		canvas: opt(str("Its home canvas; a new one when left out.")),
		near: opt(str("An agent whose workspace the new one joins.")),
	},
	answer: Agent,
	effect: "change",
});

export const update = defineCall({
	name: "agent.update",
	summary: "Change an agent: you, or (for the person) any agent. A new home canvas moves the agent's view there.",
	who: PEOPLE,
	args: { agent: opt(Name), change: AgentChange },
	answer: Agent,
	effect: "change",
});

export const remove = defineCall({ name: "agent.delete", summary: "Remove an agent. Refused while it is working.", who: PERSON, args: { agent: Name }, answer: Deleted, effect: "change" });

// Joining: a terminal agent of its own, a client that starts agents.
export const attach = defineCall({
	name: "agent.attach",
	summary: "Trade a person's login for an agent of its own: a name, a colour, a token, and a home canvas, the one named or a new one titled for it.",
	who: PERSON,
	args: { name: opt(str()), kind: opt(AgentKind), workspace: opt(str()), canvas: opt(str()) },
	answer: Agent,
	effect: "change",
});

export const host = defineCall({
	name: "agent.host",
	summary: "A client, over the socket, says which kinds of agent it can start and which harness calls it answers; agent.create and those calls then reach it.",
	who: PERSON,
	args: { kinds: arr(AgentKind), calls: opt(arr(str("A harness call this host answers, such as chat.list."))) },
	answer: arr(AgentKind),
	effect: "change",
});

// Showing your work: your cursor and glow while you edit cards.
export const act = defineCall({
	name: "agent.act",
	summary: "Say you are starting or finishing an edit of these cards, for your cursor and glow; it records nothing (card.claim records the writer).",
	who: AGENT,
	args: { cards: arr(str("A card path, or any file of a card.")), phase: lit("start", "done"), what: opt(str("edit, write, ...")), ...onCanvas },
	answer: obj({ ok: bool() }),
	effect: "change",
});

// Mail, and what changed since you last asked.
export const send = defineCall({
	name: "agent.send",
	summary: "Deliver now, into the turn the agent is running, or a new turn when it is idle.",
	who: ANYONE,
	args: { agent: Name, task: str(), cards: opt(arr(str())) },
	answer: Message,
	effect: "change",
});

export const queue = defineCall({
	name: "agent.queue",
	summary: "Put work in an agent's queue, taken up when its turn ends; reply brings its report back to you. From a card, the person is asked first, as for agent.send.",
	who: ANYONE,
	args: { agent: Name, task: str(), cards: opt(arr(str())), reply: opt(bool()) },
	answer: Message,
	effect: "change",
});

export const inbox = defineCall({ name: "agent.inbox", summary: "Hand-offs waiting for you from other agents; for a card, for the agent whose home is the card's canvas.", who: ["agent", "card"], args: {}, answer: arr(Message), effect: "read" });

export const news = defineCall({
	name: "agent.news",
	summary: "What changed on your canvas since you last asked, and your mail. Asking moves your mark on.",
	who: AGENT,
	args: { ...onCanvas },
	answer: News,
	effect: "read",
});
