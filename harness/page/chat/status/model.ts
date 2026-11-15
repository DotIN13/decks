import type { AgentState } from "@decks/protocol";

/** Where the working sign goes: over the input bar, at the foot of the conversation, or nowhere at all. */
export type SignPlace = "none" | "dock" | "column";

export function signPlacement(state: AgentState, options: { historyOpen: boolean; arriving: boolean }): SignPlace {
	if (state === "idle") return "none";
	if (!options.historyOpen) return "dock";
	/* In the column, and now *including* while a reply is arriving. */
	void options.arriving;
	return "column";
}

/** Whether these are the states that mean work is in progress, so the mark moves. */
export function isWorking(state: AgentState): boolean {
	return state === "thinking" || state === "streaming" || state === "tool";
}

/** What the sign says. */
export function workingWords(state: AgentState, name: string): string | undefined {
	switch (state) {
		case "thinking":
			return "working…";
		case "streaming":
			return "typing…";
		case "tool":
			return "running tools…";
		case "waiting":
			return `${name} is waiting for you`;
		default:
			return undefined;
	}
}
