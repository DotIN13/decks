import type { AgentChat } from "@decks/protocol";

/** The parts of a destination the chip reads: who it names, if anyone. */
export type DestinationLike = { kind: "prompt"; id: string; name: string } | { kind: string };

/** The name on the chip: the agent's, "a card" for a note, else that nobody gets it. */
export function recipientName(dest: DestinationLike): string {
	if (dest.kind === "prompt" && "name" in dest) return dest.name;
	if (dest.kind === "note") return "a card";
	return "No agent";
}

/** The agent the line goes to, when it goes to one. */
export function recipientChat(dest: DestinationLike, chats: readonly AgentChat[]): AgentChat | undefined {
	return dest.kind === "prompt" && "id" in dest ? chats.find((chat) => chat.id === dest.id) : undefined;
}

/** The tooltip's words, read by the checks too. */
export const chipLabel = (label: string): string => `Who gets the line: ${label}. Press to choose.`;
