import { any, arr, bool, int, lit, nul, num, obj, opt, str, union } from "./schema.ts";
import { AgentKind, AgentMode, Size } from "./types.ts";
import type { Verb } from "./verbs.ts";

/**
 * The person's verbs: what a Decks page asks the harness for, beside the agents' table (`VERBS`).
 *
 * Called the same way, `POST /api/v1/<noun.verb>` or `line.call` on the line, by the person's token
 * or a paired site's, and refused to an agent, an app or a canvas frame: each acts on the whole
 * harness (which agent is up, the accounts, the pairing) rather than on a canvas. They are not
 * in the SDK agents read, so `decks --help` does not list them; `GET /api/v1` does, to the person.
 *
 * The 52 requests the tab's socket took are these, under the same shape as every other call. The
 * socket still takes the old requests for one release, as aliases of these (`server/src/wire/legacy.ts`).
 */

const agents = { touches: "agents", effect: "change", who: "person" } as const;
const agentsRead = { touches: "agents", effect: "read", who: "person" } as const;
const deck = { touches: "deck", effect: "change", who: "person" } as const;
const screen = { touches: "screen", effect: "change", who: "person" } as const;
const outside = { touches: "outside", effect: "change", who: "person" } as const;

const Parts = arr(any("A part of the message: a card, a comment, a file, as the composer puts them in."));
const Thinking = str("How hard the agent thinks, as its runtime names the levels.");
const OnCanvas = obj({ canvas: opt(str()) });

export const PERSON_VERBS: readonly Verb[] = [
	// --- the deck ---------------------------------------------------------------------------
	{ name: "deck.open", group: "misc", ...deck, summary: "Open another deck folder on this harness.", params: [{ name: "path", schema: str() }] },

	// --- agents: which one is up, and what each is ------------------------------------------
	{ name: "agent.focus", group: "agent", ...agents, summary: "Bring an agent's conversation up: the one every new page starts on.", params: [{ name: "id", schema: str() }] },
	{ name: "agent.remove", group: "agent", ...agents, summary: "Remove an agent. Refused while it is working.", params: [{ name: "id", schema: str() }] },
	{
		name: "agent.add",
		group: "agent",
		...agents,
		summary: "Make a new agent and bring it up: named by the harness, on the latest canvas of its workspace or a canvas of its own.",
		params: [{ name: "spec", schema: obj({ kind: opt(AgentKind), workspace: opt(str()), near: opt(str("An agent whose workspace the new one joins.")) }), optional: true }],
		result: obj({ id: str() }),
	},
	{
		name: "agent.set",
		group: "agent",
		...agents,
		summary: "Change an agent from the outside: its name, tags, workspace (null clears it), model, thinking level, permission mode, or the canvas it is on.",
		params: [
			{ name: "id", schema: str() },
			{ name: "patch", schema: obj({ name: opt(str()), tags: opt(arr(str())), workspace: opt(union(str(), nul)), model: opt(obj({ provider: str(), model: str(), thinking: opt(Thinking) })), thinking: opt(Thinking), mode: opt(AgentMode), canvas: opt(str()) }) },
		],
	},
	{ name: "agent.report", group: "agent", ...agentsRead, summary: "The agent's usage report, said back as agent.report.", params: [{ name: "id", schema: str() }] },
	{ name: "agent.answer", group: "agent", ...agents, summary: "Answer a question an agent's runtime put up (agent.prompt).", params: [{ name: "answer", schema: any() }] },

	// --- the conversation -------------------------------------------------------------------
	{ name: "chat.send", group: "agent", ...agents, summary: "Send the agent a message from the person: words and the parts the composer holds.", params: [{ name: "id", schema: str() }, { name: "message", schema: obj({ text: str(), parts: opt(Parts) }) }] },
	{ name: "chat.abort", group: "agent", ...agents, summary: "Stop the agent's turn.", params: [{ name: "id", schema: str() }] },
	{
		name: "chat.queue",
		group: "agent",
		...agents,
		summary: "The person's own queue for an agent: add a message, remove one, send one now, or release the queue.",
		params: [{ name: "id", schema: str() }, { name: "change", schema: obj({ action: lit("add", "remove", "send", "release"), text: opt(str()), parts: opt(Parts), item: opt(str()) }) }],
	},
	{ name: "chat.open", group: "agent", ...agentsRead, summary: "Read the agent's conversation: its recent history comes back as chat.history.", params: [{ name: "id", schema: str() }] },
	{ name: "chat.earlier", group: "agent", ...agentsRead, summary: "Older messages, before one: back as chat.earlier.", params: [{ name: "id", schema: str() }, { name: "page", schema: obj({ before: str(), limit: opt(int()) }) }] },
	{ name: "chat.tool", group: "agent", ...agentsRead, summary: "A tool call's full result, back as chat.tool.", params: [{ name: "id", schema: str() }, { name: "item", schema: str() }] },
	{ name: "chat.preview", group: "agent", ...agentsRead, summary: "What the cards looked like at a message, for a rewind: back as chat.preview; null ends the preview.", params: [{ name: "id", schema: str() }, { name: "entry", schema: union(str(), nul) }] },
	{ name: "chat.rewind", group: "agent", ...agents, summary: "Rewind the conversation to a message.", params: [{ name: "id", schema: str() }, { name: "entry", schema: str() }] },
	{ name: "chat.fork", group: "agent", ...agents, summary: "Fork a new agent from a message of this one's conversation, and bring it up.", params: [{ name: "id", schema: str() }, { name: "entry", schema: str() }] },
	{ name: "chat.restore", group: "agent", ...deck, summary: "Put the cards back as they were at a message.", params: [{ name: "id", schema: str() }, { name: "entry", schema: str() }], result: obj({ restored: num() }) },

	// --- accounts ---------------------------------------------------------------------------
	{ name: "account.list", group: "misc", ...agentsRead, summary: "The Claude accounts this harness knows, back as account.list; with limits, their spending is read again.", params: [{ name: "options", schema: obj({ limits: opt(bool()) }), optional: true }] },
	{ name: "account.add", group: "misc", ...agents, summary: "Sign in to another Claude account, through a Claude agent.", params: [] },
	{ name: "account.use", group: "misc", ...agents, summary: "Have an agent spend from an account.", params: [{ name: "id", schema: str() }, { name: "agent", schema: str() }] },
	{ name: "account.forget", group: "misc", ...agents, summary: "Forget an account.", params: [{ name: "id", schema: str() }] },

	// --- cards and the drawing, as the person moves them ------------------------------------
	{ name: "card.move", group: "card", ...deck, summary: "Move a card on the canvas on screen (or `canvas`).", params: [{ name: "card", schema: str() }, { name: "at", schema: obj({ x: num(), y: num() }) }, { name: "options", schema: OnCanvas, optional: true }] },
	{ name: "card.resize", group: "card", ...deck, summary: "Resize a card on the canvas on screen; a height is a floor the content may raise.", params: [{ name: "card", schema: str() }, { name: "size", schema: Size }, { name: "options", schema: OnCanvas, optional: true }] },
	{ name: "card.play", group: "card", ...deck, summary: "Put a card on the canvas on screen.", params: [{ name: "card", schema: str() }, { name: "options", schema: OnCanvas, optional: true }] },
	{ name: "card.hide", group: "card", ...deck, summary: "Take a card off the canvas on screen; its file stays.", params: [{ name: "card", schema: str() }, { name: "options", schema: OnCanvas, optional: true }] },
	{ name: "card.delete", group: "card", ...deck, summary: "Delete a card's file from the deck. Its last content stays under .decks/revisions.", params: [{ name: "card", schema: str() }] },
	{
		name: "doc.place",
		group: "canvas",
		...deck,
		summary: "Put a document on the canvas on screen: a file the deck can open, or a Google Doc by its link, at a corner or beside the newest thing there.",
		params: [{ name: "options", schema: obj({ document: opt(str()), google: opt(str()), at: opt(obj({ x: num(), y: num() })), canvas: opt(str()) }) }],
		result: obj({ path: str("The item, as item:<id>.") }),
	},
	{
		name: "canvas.edit",
		group: "canvas",
		...deck,
		summary: "The person's edit of the drawing, undoable: pen.dev ops on the canvas on screen, for the agent they are talking to.",
		params: [{ name: "ops", schema: arr(any()) }, { name: "options", schema: obj({ canvas: opt(str()), agent: opt(str()) }), optional: true }],
	},
	{ name: "canvas.remove", group: "canvas", ...deck, summary: "Delete a canvas: its folder and everything in it.", params: [{ name: "canvas", schema: str() }] },

	// --- the person's screen ----------------------------------------------------------------
	{ name: "view.remember", group: "view", ...screen, summary: "Where the person's screen is on an agent's canvas, so the agent's view calls and the next page know.", params: [{ name: "camera", schema: obj({ x: num(), y: num(), zoom: num() }, true) }, { name: "options", schema: obj({ agent: str(), canvas: opt(str()), device: opt(str()) }) }] },

	// --- the harness and the outside --------------------------------------------------------
	{ name: "harness.configure", group: "misc", ...outside, summary: "The harness's settings: the person's timezone, the speech-to-text model (null for the default), whether another front end needs a pairing code.", params: [{ name: "settings", schema: obj({ timezone: opt(union(str(), nul)), sttModel: opt(union(str(), nul)), requireCode: opt(bool()) }) }] },
	{ name: "harness.revoke", group: "misc", ...outside, summary: "Take back a paired front end's token.", params: [{ name: "id", schema: str() }] },
	{ name: "harness.unpair", group: "misc", ...outside, summary: "Delete Studio's key: the deck stops syncing, and every browser signed in to Studio loses its way here.", params: [] },
	{ name: "web.answer", group: "web", ...outside, summary: "Answer the shared browser's question: yes or no.", params: [{ name: "id", schema: str() }, { name: "ok", schema: bool() }] },
	// --- added with the side routes (step 4): what Studio and a terminal asked of /api/agents, /api/harness, /api/deck, /api/google ---
	{ name: "agent.dialogs", group: "agent", ...agentsRead, summary: "The questions an agent's runtime has up, waiting for an answer.", params: [{ name: "id", schema: str() }], result: obj({ dialogs: arr(any()) }) },
	{ name: "agent.settings", group: "agent", ...agentsRead, summary: "An agent's settings as a settings page shows them: its model and the models its runtime offers, its mode and the modes, its usage, the accounts and the one it spends from, its queue.", params: [{ name: "id", schema: str() }, { name: "options", schema: obj({ limits: opt(bool()) }), optional: true }], result: obj({}, true) },
	{ name: "agent.reset", group: "agent", ...agents, summary: "Start the agent's conversation over.", params: [{ name: "id", schema: str() }] },
	{ name: "apps.seen", group: "apps", ...deck, summary: "The person looked at an app's state: clears its mark.", params: [{ name: "name", schema: str() }] },
	{ name: "deck.get", group: "misc", ...agentsRead, summary: "The deck as the harness sees it, with any warnings from opening it.", params: [], result: obj({ deck: any(), warnings: arr(str()) }) },
	{ name: "harness.get", group: "misc", ...agentsRead, summary: "The harness's own settings page: its name, version, timezone, speech model, runtimes, accounts, paired front ends and the pairing-code rule.", params: [], result: obj({}, true) },
	{ name: "account.google", group: "misc", ...agentsRead, summary: "Whether this harness is signed in to Google, and as whom.", params: [], result: obj({}, true) },
	{ name: "account.googleCode", group: "misc", ...outside, summary: "Finish a Google sign-in from the address the browser landed on.", params: [{ name: "url", schema: str() }], result: obj({ ok: bool(), email: opt(str()), message: opt(str()) }) },
	{ name: "account.googleSignOut", group: "misc", ...outside, summary: "Sign out of Google.", params: [] },
];

export const PERSON_VERB_BY_NAME: ReadonlyMap<string, Verb> = new Map(PERSON_VERBS.map((verb) => [verb.name, verb]));

