/**
 * A comment on a board: the words a person selected while browsing, and what they said about them.
 *
 * A comment is a message to the agent, not a mark in the file. It names the board, the
 * component the words are in and the words themselves, which is what the agent needs to find
 * the place, and then carries what was typed. It goes one of two ways, and the person picks
 * at the moment of writing: **now**, as a message of its own, or **with the next message**,
 * kept in a list over the input bar until something is sent.
 *
 * Everything here is pure, so what the agent will read is a function that can be tested.
 */

export interface CardComment {
	id: string;
	/** Deck-relative, as the agent knows it: `boards/plan.html`. */
	board: string;
	/** The `data-id` of the component the selection was in, when it was in one. */
	component?: string;
	/**
	 * Drawn items on a canvas, by id, when the comment is on them rather than on a board: `board` is
	 * then the canvas's file (`canvases/<name>/canvas.pen`) and `quote` their words, so the agent finds
	 * them with `decks.canvas.read()`.
	 */
	items?: string[];
	/** The selected words, spaces collapsed, cut at `QUOTE_LIMIT`. */
	quote: string;
	/** What was said; empty when the comment only points at the place, for the message to talk about. */
	text: string;
	at: number;
	/** The board's title, for a comment on a whole board: what its pill in the composer says. */
	title?: string;
}

export const QUOTE_LIMIT = 400;

/** A selection as it is quoted: one line, and not the whole page. */
export function quoteOf(selected: string): string {
	const flat = selected.replace(/\s+/g, " ").trim();
	return flat.length > QUOTE_LIMIT ? `${flat.slice(0, QUOTE_LIMIT - 1).trimEnd()}…` : flat;
}

/**
 * The comments as the agent reads them.
 *
 * A numbered list, each with where it is, the words quoted, and the comment under it. The
 * opening line says what the list is, because a message that begins with a file path and a
 * quotation is otherwise a puzzle.
 */
export function commentBlock(comments: CardComment[]): string {
	if (comments.length === 0) return "";
	const drawn = comments.every((comment) => comment.items?.length);
	const head = drawn
		? comments.length === 1 ? "A comment on items drawn on a canvas:" : `${comments.length} comments on items drawn on a canvas:`
		: comments.length === 1 ? "A comment on a card. The quoted words are what I selected:" : `${comments.length} comments on cards. The quoted words are what I selected:`;
	const items = comments.map((comment, index) => commentItem(comment, index + 1));
	return `${head}\n\n${items.join("\n\n")}`;
}

/**
 * One comment as the agent reads it in that list, numbered `n`: what a pill's Exact text shows, and
 * what `commentBlock` joins.
 */
export function commentItem(comment: CardComment, n: number): string {
	// A comment with no words points at the place and says nothing more.
	const said = comment.text.trim() ? `\n${comment.text.trim().split("\n").map((line) => `   ${line}`).join("\n")}` : "";
	if (comment.items?.length) {
		const named = comment.items.map((id) => `"${id}"`).join(", ");
		return `${n}. on ${comment.board}, ${comment.items.length === 1 ? "item" : "items"} ${named}${comment.quote ? ` ("${comment.quote}")` : ""}${said}`;
	}
	const where = comment.component ? `${comment.board}, in #${comment.component}` : comment.board;
	// No quote: a comment on the whole card, from its pill.
	if (!comment.quote) return `${n}. ${where}, the whole card${said}`;
	return `${n}. ${where}\n   > ${comment.quote}${said}`;
}

/** A message with the waiting comments in front of it; either half may be empty. */
export function withComments(text: string, comments: CardComment[]): string {
	const block = commentBlock(comments);
	const said = text.trim();
	if (!block) return said;
	return said ? `${block}\n\n${said}` : block;
}
