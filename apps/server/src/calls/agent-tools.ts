import type { DeckAgent } from "../agents/session.ts";
import { createDecksTool, type DecksTool } from "./tool.ts";

/**
 * The two stage tools each agent's calls run through, made here from what the agent hands out
 * (`DeckAgent.toolSpec`) so the agents never point up at the calls.
 *
 * Each is made once per agent and kept, so a verb called over HTTP before the agent's first turn
 * acts on the same stage its turns will. Kept by the agent object, so a removed agent takes its tools
 * with it.
 */
const made = new WeakMap<DeckAgent, { agent?: DecksTool; person?: DecksTool }>();

function toolOf(agent: DeckAgent, who: "agent" | "person"): DecksTool {
	let tools = made.get(agent);
	if (!tools) made.set(agent, (tools = {}));
	return (tools[who] ??= createDecksTool(agent.toolSpec(who)));
}

/** The agent's own stage tool: what its code runs against, and what a request naming it calls (`calls/caller.ts`). */
export function stageToolOf(agent: DeckAgent): DecksTool {
	return toolOf(agent, "agent");
}

/** The person's tool on this agent's stage: the same verbs, with the person as the one who acted (`calls/person.ts`). */
export function personToolOf(agent: DeckAgent): DecksTool {
	return toolOf(agent, "person");
}
