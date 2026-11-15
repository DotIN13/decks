import type { AgentChat } from "@decks/protocol";

/** Somebody an `@` in the line can name: an agent. */
export interface Mentionable {
	name: string;
	chat: AgentChat;
}

const MAX = 8;

export function filterMentionables(all: Mentionable[], query: string): Mentionable[] {
	const needle = query.toLowerCase();
	const prefix = all.filter((one) => one.name.toLowerCase().startsWith(needle));
	const contains = needle ? all.filter((one) => !one.name.toLowerCase().startsWith(needle) && one.name.toLowerCase().includes(needle)) : [];
	return [...prefix, ...contains].slice(0, MAX);
}
