import type { AgentChat, Identity } from "../../state/types/index.ts";
import { agentList, dropdownFaces, workspaceRuns } from "../agent-order.ts";

// The agent menu's rules, with no store and no DOM: which agents a search
// finds, how many the menu shows, and the runs of one workspace each.

/** The agents whose name or workspace holds the words; all of them when there are none. */
export function findAgents(chats: readonly AgentChat[], identities: Record<string, Identity>, words: string): AgentChat[] {
	const q = words.trim().toLowerCase();
	if (!q) return [...chats];
	return chats.filter((chat) => `${identities[chat.id]?.name ?? chat.name}\n${identities[chat.id]?.workspace ?? ""}`.toLowerCase().includes(q));
}

/** What the menu lists: every match while searching, else the first few faces and how many more. */
export function listAgents(chats: readonly AgentChat[], identities: Record<string, Identity>, unread: Record<string, number>, focused: string | undefined, words: string): { shown: AgentChat[]; more: number } {
	if (words.trim()) return { shown: agentList(findAgents(chats, identities, words), unread, focused), more: 0 };
	return dropdownFaces(agentList([...chats], unread, focused));
}

/** The listed agents in runs of one workspace, each with its label. */
export const runsOf = (shown: AgentChat[], identities: Record<string, Identity>): Array<{ label: string | undefined; chats: AgentChat[] }> => workspaceRuns(shown, identities);

/** "1 more agent", "3 more agents". */
export const moreWords = (more: number): string => `${more} more ${more === 1 ? "agent" : "agents"}`;
