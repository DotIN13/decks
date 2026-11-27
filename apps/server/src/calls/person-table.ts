import { accountTable, type AccountTableHost } from "./person-accounts.ts";
import { agentTable, type AgentTableHost } from "./person-agents.ts";
import type { PersonVerbs } from "./person-call.ts";
import { canvasTable, type CanvasTableHost } from "./person-canvas.ts";
import { chatTable, type ChatTableHost } from "./person-chat.ts";
import { harnessTable, type HarnessTableHost } from "./person-harness.ts";
import { studioTable, type StudioTableHost } from "./person-studio.ts";

/**
 * The person's verbs (`@decks/api`, `PERSON_VERBS`), each run against the harness itself.
 *
 * A module per group, each given only the parts of the harness it uses (its `…TableHost`): the
 * agents, the conversations, the accounts, the canvases, the harness's own settings, and Studio.
 * Whoever starts the harness has all of them and hands itself in; nothing here names that object,
 * so the person's verbs depend on the parts below them and on nothing above (as `CallsHost` does).
 */

/** What the person's own calls need: every group's parts, together. */
export type PersonHost = AgentTableHost & ChatTableHost & AccountTableHost & CanvasTableHost & HarnessTableHost & StudioTableHost;

export function personTable(host: PersonHost): PersonVerbs {
	return {
		...agentTable(host),
		...chatTable(host),
		...accountTable(host),
		...canvasTable(host),
		...harnessTable(host),
		...studioTable(host),
	};
}
