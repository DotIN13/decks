import type { AgentState } from "@decks/protocol";

/**
 * Where the working sign goes: over the input bar, at the foot of the conversation, or
 * nowhere at all.
 *
 * One function because it is one rule, read by two components that must not disagree — the
 * dock draws a pill and the column draws a card, and either of them deciding for itself is
 * the bug where both are up at once, 12px apart, saying the same thing.
 *
 * The rule, in the order the cases matter:
 *
 * 1. **Nothing happening, nothing shown.** A row that reports the absence of work is a row
 *    you learn to stop reading, and it would be there for all of the time the app is doing
 *    nothing, which is most of it.
 * 2. **The conversation is open — the column has it.** The sign answers *is anything
 *    happening*, and with the column up the column answers it in the place the answer is
 *    arriving. The copy over the composer is the one that says less: it can tell you that the
 *    agent is working, not what it is doing.
 * 3. **…unless the reply is already arriving**, in which case neither draws one. A streaming
 *    card has a caret blinking at the end of its text: that is the same message, in the exact
 *    place the words are appearing, and a sign under it would be a second cursor.
 * 4. **Waiting is not working**, but it is still worth a sign: the agent asked *you*
 *    something. The mark stands still and the words name whose move it is.
 */
export type SignPlace = "none" | "dock" | "column";

export function signPlacement(state: AgentState, options: { historyOpen: boolean; arriving: boolean }): SignPlace {
	if (state === "idle") return "none";
	if (!options.historyOpen) return "dock";
	/*
	 * In the column, and now *including* while a reply is arriving.
	 *
	 * It used to return `none` for that case, on the argument that a streaming reply already
	 * says "still going" with the caret blinking at the end of its text — in the place the
	 * words are appearing, which is better than a sign below them. That argument was sound
	 * and it died with the caret: with no caret there is nothing carrying the fact, so a
	 * streaming reply had a growing paragraph and no indicator at all.
	 *
	 * `arriving` is kept in the signature rather than deleted. It is still the honest name for
	 * the state, three callers pass it, and a sign that behaves differently mid-reply is a
	 * change somebody may want back — with a caret or with something quieter in its place.
	 */
	void options.arriving;
	return "column";
}

/** Whether these are the states that mean work is in progress, so the mark moves. */
export function isWorking(state: AgentState): boolean {
	return state === "thinking" || state === "streaming" || state === "tool";
}

/**
 * What the sign says.
 *
 * **Three words, not one.** "Working…" for a turn that has started and has nothing to read
 * yet, "typing…" for the moment an answer is visibly arriving, and "running tools…" for the
 * long pause with no text in it. It was two before, which put the state where an answer is
 * arriving under the same word as the state where nothing is — and the difference is exactly
 * the one that decides whether it is worth opening the conversation to watch.
 */
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
