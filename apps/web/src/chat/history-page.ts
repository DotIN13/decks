import type { ChatItem } from "@decks/protocol";

/**
 * How much of a long conversation is in the DOM, and how it grows (DESIGN §6.2).
 *
 * A conversation is not bounded. Six hundred cards, each with its own markdown, tool
 * groups and time machine, is a column that costs a second to open and janks on every
 * token that arrives — and the reader is looking at three of them. So the column renders
 * a **window from the end**, and reaching back is what widens it.
 *
 * **Windowed from the tail rather than around the viewport**, which is the decision worth
 * writing down. A true virtual list has to guess the height of what it is not rendering,
 * and every guess lands on the scrollbar: it jumps as the guesses are corrected. Growing
 * downwards from a fixed end needs no estimates, no spacers and no jitter. The price is
 * that far-back history takes a moment of scrolling rather than a drag of the scrollbar,
 * which is the right way round — the end is where a conversation is read.
 *
 * Two sources, in this order: **widen the window first**, because those rows are already
 * in the browser, and only ask the server once the window has caught up with what was
 * sent. `chat.earlier` is what asks (`agents/store.ts` answers it).
 *
 * The arithmetic lives here, apart from the column, because these are the rules that break
 * quietly — an off-by-one in `hidden` shows a button that says "0 earlier messages", and a
 * `hasEarlier` that forgets the empty case makes a brand-new chat offer to fetch history it
 * has never had.
 */

/** How many rows a fresh window holds, and how many each reach-back adds. */
export const WINDOW = 60;

/** How many rows to ask the server for at a time. */
export const PAGE = 60;

/**
 * How near the top of what is rendered counts as reaching for more, in pixels.
 *
 * Generous on purpose: the point is that the next page is already there by the time the
 * reader arrives, so this is a distance rather than a boundary. A sentinel at the very top
 * would fetch when the reader had already run out of column to read.
 */
export const LOAD_MORE_AT = 800;

/** The tail of `items` that is rendered. */
export function windowOf<T>(items: readonly T[], size: number): readonly T[] {
	if (size <= 0) return [];
	return items.length <= size ? items : items.slice(items.length - size);
}

/** How many rows are held but not rendered. */
export function hiddenCount(total: number, shown: number): number {
	return Math.max(0, total - shown);
}

/**
 * Whether there is anything before what is rendered — in the browser or on the server.
 *
 * An empty conversation has nothing before it *by definition*, and saying so here covers
 * the moment before the first `chat.history` lands: without it, a chat with nothing in it
 * offers to fetch earlier messages, which is the one wrong answer that cannot be right
 * later.
 */
export function hasEarlier(state: { total: number; hidden: number; more: boolean }): boolean {
	if (state.total === 0) return false;
	return state.hidden > 0 || state.more;
}

/** The label on the way back: the count when it is known, the invitation when it is not. */
export function earlierLabel(hidden: number): string {
	if (hidden <= 0) return "Earlier messages";
	return `${hidden} earlier ${hidden === 1 ? "message" : "messages"}`;
}

/**
 * Fold a page of older rows into what is held, oldest first and without duplicates.
 *
 * Duplicates are not hypothetical: a reader who keeps scrolling can have two pages in
 * flight, and a rewind can re-send a window that overlaps a page already fetched. Keyed on
 * the row id, and the *held* copy wins — it is the one the browser may have been streaming
 * into.
 */
export function prepend(page: readonly ChatItem[], held: readonly ChatItem[]): ChatItem[] {
	if (page.length === 0) return [...held];
	const have = new Set(held.map((item) => item.id));
	return [...page.filter((item) => !have.has(item.id)), ...held];
}
