import { createSignal } from "solid-js";
import { loadComments, saveComments, type BoardComment } from "../markup/comments.ts";

/**
 * Comments on boards: the one being written, and the ones waiting for the next message.
 *
 * Waiting comments are kept per agent, because a comment is said *to* somebody: it was made
 * on that agent's canvas and goes with the next thing sent to that agent. They are in
 * localStorage so a reload between writing a comment and sending it does not lose it.
 */

/**
 * What a comment is about, as the popup needs it: what to quote, and where it is on screen, as a box
 * in window pixels to sit by. A comment on a whole board or card (the pill's Comment) has an empty quote.
 */
export interface CommentTarget {
	path: string;
	component?: string;
	quote: string;
	/** Where to sit, in window pixels. */
	anchor?: () => { left: number; top: number; right: number; bottom: number } | undefined;
	/** The board's title, to name a comment on the whole board. */
	title?: string;
	/** Open straight to the box: the press that made it already said "comment". */
	open?: boolean;
	/** Drawn items commented on, by id; `path` is then the canvas's file (`BoardComment.items`). */
	items?: string[];
}

const [commenting, setCommenting] = createSignal<CommentTarget | undefined>(undefined);
/** Something has been typed into the popup, so a stray click on the board must not throw it away. */
const [commentDirty, setCommentDirty] = createSignal(false);
export { commenting, setCommenting, commentDirty, setCommentDirty };

const storage = () => (typeof localStorage === "undefined" ? undefined : localStorage);
const [waiting, setWaiting] = createSignal<Record<string, BoardComment[]>>(loadComments(storage()));

const write = (next: Record<string, BoardComment[]>) => {
	setWaiting(next);
	saveComments(storage(), next);
};

export function waitingComments(agentId: string | undefined): BoardComment[] {
	return agentId ? waiting()[agentId] ?? [] : [];
}

export function addComment(agentId: string, comment: BoardComment): void {
	write({ ...waiting(), [agentId]: [...(waiting()[agentId] ?? []), comment] });
}

export function removeComment(agentId: string, id: string): void {
	write({ ...waiting(), [agentId]: (waiting()[agentId] ?? []).filter((comment) => comment.id !== id) });
}

/** The waiting comments, handed over: they are about to be sent, so they stop waiting. */
export function takeComments(agentId: string): BoardComment[] {
	const taken = waiting()[agentId] ?? [];
	if (taken.length > 0) write({ ...waiting(), [agentId]: [] });
	return taken;
}
