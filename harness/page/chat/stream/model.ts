import { dayKey, formatDate, yearOf } from "@decks/ui";
import type { ChatItem } from "@decks-next/protocol";

/** How much of a long conversation is in the DOM, and how it grows (DESIGN §6.2). */

/** How many rows a fresh span holds, and how many each reach back adds. */
export const WINDOW = 60;

/** How many rows to ask the server for at a time. */
export const PAGE = 60;

/** How near the top of what is rendered counts as reaching for more, in pixels. */
export const LOAD_MORE_AT = 800;

/** The tail of `items` that is rendered. */
export function windowOf<T>(items: readonly T[], size: number): readonly T[] {
	if (size <= 0) return [];
	return items.length <= size ? items : items.slice(items.length - size);
}

/**
 * Where the drawn span of the conversation starts, as an index into what is held: at the row it started
 * at before (`from`), or `size` rows from the end when there is none or it is gone (a new conversation,
 * a rewind).
 */
export function windowStart(items: readonly { id: string; kind?: string }[], from: string | undefined, size: number): number {
	let at = from === undefined ? -1 : items.findIndex((item) => item.id === from);
	if (at === -1) at = Math.max(0, items.length - Math.max(0, size));
	while (at > 0 && at < items.length && items[at]!.kind !== "user") at--;
	return at;
}

/** How many rows are held but not rendered. */
export function hiddenCount(total: number, shown: number): number {
	return Math.max(0, total - shown);
}

/** Whether there is anything before what is rendered, in the browser or on the server. */
export function hasEarlier(state: { total: number; hidden: number; more: boolean }): boolean {
	if (state.total === 0) return false;
	return state.hidden > 0 || state.more;
}

/** The label on the way back: the count when it is known, the invitation when it is not. */
export function earlierLabel(hidden: number): string {
	if (hidden <= 0) return "Earlier messages";
	return `${hidden} earlier ${hidden === 1 ? "message" : "messages"}`;
}

/** Fold a page of older rows into what is held, oldest first and without duplicates. */
export function prepend(page: readonly ChatItem[], held: readonly ChatItem[]): ChatItem[] {
	if (page.length === 0) return [...held];
	const have = new Set(held.map((item) => item.id));
	return [...page.filter((item) => !have.has(item.id)), ...held];
}

/** The label for a day boundary between two cards, or nothing if they are from the same day. */
export function divides(before: number | undefined, at: number | undefined, now: number = Date.now()): string | undefined {
	if (!at || !before) return undefined;
	// Days in the deck's timezone: "Yesterday" is the person's yesterday.
	if (dayKey(before) === dayKey(at)) return undefined;
	if (dayKey(at) === dayKey(now)) return "Today";
	if (dayKey(at) === dayKey(now - 86_400_000)) return "Yesterday";
	const sameYear = yearOf(at) === yearOf(now);
	return formatDate(at, { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) });
}
