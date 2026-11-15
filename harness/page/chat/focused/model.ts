import type { AgentChat, AgentKind, AgentState, Identity } from "@decks/protocol";

/** What the stream says of the focused agent: its state, its name and its runtime. */
export function focusedFacts(chat: AgentChat | undefined, identity: Identity | undefined, defaultKind: AgentKind): { state: AgentState; name: string; agent: AgentKind } {
	return { state: chat?.state ?? "idle", name: identity?.name ?? chat?.name ?? "It", agent: chat?.kind ?? defaultKind };
}
