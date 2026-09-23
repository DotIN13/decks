import type { Board } from "@decks/protocol";

/** How long a board stays news without being read: a day, after which it is simply there. */
const CHANGED_WITHIN = 24 * 60 * 60 * 1000;

/**
 * Whether a board is news: an agent named it, and the person had not read it since.
 *
 * Two times can be the newest one, and they mean different things. `namedAt` is the last act that
 * named a writer: an agent fitting, showing or reporting a board, or the person's own edit.
 * `modifiedAt` is the file, whoever moved it. The later of the two is what a reader is being told
 * about, with one exception — the person's own act, when it is also the newest, is not news to
 * them. `seenAt` is when they last looked, on any device.
 */
export function isNews(board: Board, now = Date.now()): boolean {
	const named = board.namedAt ?? 0;
	const file = board.modifiedAt ?? 0;
	/*
	 * The person's own act is not news to them. `named === 0` is a byline kept from before acts
	 * were timed, which is every record already on a deck: their own edit is the likeliest reason
	 * that file moved, and the mark clears on a read either way. A *timed* act older than the file
	 * is the other case — something else wrote it afterwards — and that is news.
	 */
	if (board.lastWrittenBy === "you" && (named === 0 || named >= file)) return false;
	const at = Math.max(named, file);
	return at > (board.seenAt ?? 0) && at > now - CHANGED_WITHIN;
}
