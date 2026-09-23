import type { Board } from "@decks/protocol";

/**
 * The half of a board's news mark that only a browser can answer.
 *
 * A board is news when an agent named it and the person had not read it since. The server keeps
 * both of those facts, and neither of them is enough: whether the person was *watching that agent
 * write it* is not on the wire and cannot be, because it is about a screen, and screens are here.
 *
 * So the browser answers it at the moment the act arrives, and answers it by reading the board:
 * `board.seen`. That clears the mark everywhere the person is signed in, which is the same rule
 * reading a board in the focus view already follows.
 */
export function watchedBeingNamed(
	board: Pick<Board, "lastWrittenBy" | "namedAt" | "seenAt">,
	place: { focused?: string },
): boolean {
	// No act, no watch: a file event says nothing about who was where.
	if (!board.namedAt) return false;
	// The person's own act is never news to them, and no agent id is the word "you".
	if (board.lastWrittenBy === "you") return false;
	// Already read: saying it again would only cost a round trip.
	if (board.namedAt <= (board.seenAt ?? 0)) return false;
	if (!place.focused) return false;
	/*
	 * It is the agent, not the board. A board named by the agent whose stage is on screen was
	 * watched being named; asking whether the board was in that agent's context, or inside the
	 * camera, would make a marking rule out of geometry, and it would miss the common case — an
	 * agent that fits or reports a board it never held.
	 */
	return board.lastWrittenBy === place.focused;
}
