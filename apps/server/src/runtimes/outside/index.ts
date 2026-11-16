import type { AgentRuntime } from "../contract.ts";

/**
 * An agent that works outside Decks: a Claude Code, Codex or Cursor session that joined by MCP
 * (`agent.attach`, `agents/registry.ts`).
 *
 * It is in the agents list like any other, with a name, a colour, a home canvas and an inbox, and
 * every call it makes is made as itself. What it has not got is a runtime here: its model, its
 * conversation and its turns are its own app's. So this descriptor starts nothing. A message to it
 * waits in its inbox and reaches it with its next call (`DeckAgent.prompt`), and it is never in the
 * list of runtimes a new agent can be made on (`AGENT_KINDS`).
 */
export const outside: AgentRuntime = {
	kind: "outside",
	label: "Outside",
	capabilities: { modes: [] },
	commands: [],
	availability: () => ({ available: false, reason: "An outside agent joins by itself: add Decks to Claude Code, Codex or Cursor as an MCP server." }),
	create: async () => {
		throw new Error("This agent works outside Decks, in its own app: Decks cannot start a turn for it. What you send waits in its inbox and reaches it with its next call.");
	},
};
