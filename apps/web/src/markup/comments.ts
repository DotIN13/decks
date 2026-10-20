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

export { commentBlock, QUOTE_LIMIT, quoteOf, withComments, type BoardComment } from "@decks/canvas/comment-text.ts";
import type { BoardComment } from "@decks/canvas/comment-text.ts";

// --- kept between reloads ------------------------------------------------------------

export const COMMENTS_KEY = "decks.comments";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isComment(value: unknown): value is BoardComment {
	if (!value || typeof value !== "object") return false;
	const { id, board, quote, text, at, component } = value as Record<string, unknown>;
	return (
		typeof id === "string" &&
		typeof board === "string" &&
		typeof quote === "string" &&
		typeof text === "string" &&
		typeof at === "number" &&
		(component === undefined || typeof component === "string")
	);
}

/** Every agent's waiting comments. Anything unreadable is nothing, never an error. */
export function loadComments(store: Store | undefined): Record<string, BoardComment[]> {
	try {
		const raw: unknown = JSON.parse(store?.getItem(COMMENTS_KEY) ?? "{}");
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
		const out: Record<string, BoardComment[]> = {};
		for (const [agent, list] of Object.entries(raw)) {
			const kept = Array.isArray(list) ? list.filter(isComment) : [];
			if (kept.length > 0) out[agent] = kept;
		}
		return out;
	} catch {
		return {};
	}
}

export function saveComments(store: Store | undefined, comments: Record<string, BoardComment[]>): void {
	try {
		const kept = Object.fromEntries(Object.entries(comments).filter(([, list]) => list.length > 0));
		if (Object.keys(kept).length === 0) store?.removeItem(COMMENTS_KEY);
		else store?.setItem(COMMENTS_KEY, JSON.stringify(kept));
	} catch {
		/* private mode or a full quota: the comments still go with the next message, they just do not survive a reload */
	}
}

/**
 * Where the popup goes: under the selection and centred on it, inside the window.
 *
 * Above instead when there is no room below, and never off either side or over the sidebar.
 * All in window pixels; `size` is the popup's own.
 */
export function popupPlace(
	selection: { left: number; top: number; right: number; bottom: number },
	size: { w: number; h: number },
	view: { w: number; h: number; left?: number },
	gap = 8,
): { left: number; top: number; above: boolean } {
	const centre = (selection.left + selection.right) / 2;
	// `view.left` is where the canvas starts: the popup stays off the sidebar beside it.
	const edge = (view.left ?? 0) + 8;
	const left = Math.round(Math.min(Math.max(edge, centre - size.w / 2), Math.max(edge, view.w - size.w - 8)));
	const below = selection.bottom + gap;
	const above = below + size.h > view.h - 8 && selection.top - gap - size.h >= 8;
	return { left, top: Math.round(above ? selection.top - gap - size.h : Math.min(below, Math.max(8, view.h - size.h - 8))), above };
}
