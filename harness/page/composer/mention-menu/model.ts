import type { AgentChat } from "@decks/protocol";

// Who an @ in the line can name, and the matches for what is typed.

/** Somebody an `@` in the line can name: an agent. */
export interface Mentionable {
	name: string;
	chat: AgentChat;
}

export function filterMentionables(all: Mentionable[], query: string): Mentionable[] {
	const needle = query.toLowerCase();
	const prefix = all.filter((one) => one.name.toLowerCase().startsWith(needle));
	const contains = needle ? all.filter((one) => !one.name.toLowerCase().startsWith(needle) && one.name.toLowerCase().includes(needle)) : [];
	return [...prefix, ...contains].slice(0, MAX);
}

const MAX = 8;
