import { createSignal } from "solid-js";
import { adoptComments, commentsKey, loadComments, saveComments, type CardComment } from "../markup/comments.ts";

/**
 * Comments on boards: whether the one being written has words in it, and the ones waiting for the next message.
 *
 * Waiting comments are kept per agent and canvas, because a comment is said *to* somebody about
 * something: it was made on that agent's canvas and goes with the next thing sent to that agent
 * from there. They are in localStorage (this device's) so a reload between writing a comment and
 * sending it does not lose it.
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
	/** Drawn items commented on, by id; `path` is then the canvas's file (`CardComment.items`). */
	items?: string[];
}

/** Something has been typed into the popup, so a stray click on the board must not throw it away. */
const [commentDirty, setCommentDirty] = createSignal(false);
export { commentDirty, setCommentDirty };

const storage = () => (typeof localStorage === "undefined" ? undefined : localStorage);
const [waiting, setWaiting] = createSignal<Record<string, CardComment[]>>(loadComments(storage()));

const write = (next: Record<string, CardComment[]>) => {
	setWaiting(next);
	saveComments(storage(), next);
};

export function waitingComments(agentId: string | undefined, canvas: string | undefined): WaitingComment[] {
	return agentId ? waiting()[commentsKey(agentId, canvas)] ?? [] : [];
}

export function addComment(agentId: string, canvas: string | undefined, comment: WaitingComment): void {
	const key = commentsKey(agentId, canvas);
	write({ ...waiting(), [key]: [...(waiting()[key] ?? []), comment] });
}

export function removeComment(agentId: string, canvas: string | undefined, id: string): void {
	const key = commentsKey(agentId, canvas);
	write({ ...waiting(), [key]: (waiting()[key] ?? []).filter((comment) => comment.id !== id) });
}

/** The waiting comments, handed over: they are about to be sent, so they stop waiting. */
export function takeComments(agentId: string, canvas: string | undefined): CardComment[] {
	const key = commentsKey(agentId, canvas);
	const taken = waiting()[key] ?? [];
	if (taken.length > 0) write({ ...waiting(), [key]: [] });
	return taken;
}

/** Comments kept under this agent alone, by an earlier build, moved to the canvas it is on now (`adoptComments`). */
export function adoptFormerComments(agentId: string, canvas: string | undefined): void {
	const next = adoptComments(waiting(), agentId, canvas);
	if (next !== waiting()) write(next);
}

// --- what the canvas frame hands over -------------------------------------------------

/**
 * A comment the canvas frame handed over: marked, so its pill says where it came from. Anything in the
 * frame can hand one over, a card's script too, so its pill has a dashed amber edge and its card says a
 * card handed it over; the card's Exact text is all of what goes with your next message.
 */
export type WaitingComment = CardComment & { from?: "canvas" };

/** The most of any one text a frame draft may carry: longer is cut, with an ellipsis, and the cut is what is sent. */
export const FRAME_TEXT_LIMIT = 2000;
/** The most ids a sketch handed over may name. */
export const FRAME_IDS_LIMIT = 500;

/**
 * Characters that show nothing: zero-width spaces and joiners, bidi controls, word joiners and invisible
 * operators, the byte-order mark, soft hyphen, variation selectors, Unicode tags (which can spell out
 * text no font draws), and control characters other than tab and newline.
 */
const INVISIBLE =
	/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u2028-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF0-\uFFFB]|[\u{1D173}-\u{1D17A}\u{E0000}-\u{E0FFF}]/gu;

/** A text from the frame, cleaned of what cannot be seen and cut at `limit` characters. */
export function frameText(value: unknown, limit = FRAME_TEXT_LIMIT): string {
	const clean = (typeof value === "string" ? value : "").replace(INVISIBLE, "");
	const chars = Array.from(clean);
	return chars.length <= limit ? clean : `${chars.slice(0, limit - 1).join("")}…`;
}

/** A list of texts from the frame: each cleaned and cut, the empty ones gone, at most `count`. */
export function frameTexts(values: unknown, count = FRAME_IDS_LIMIT): string[] {
	return (Array.isArray(values) ? values : []).slice(0, count).map((value) => frameText(value)).filter((value) => value !== "");
}

type FrameComment = { path: string; title: string; quote: string; text: string; send?: boolean; component?: string; items?: string[] };
/** A pill as the frame hands it: a card or a drawn item. */
type FramePill = { kind: "card" | "item"; id: string; label: string; name?: string };
/** A pill for the composer, of the mention kind a sent message's parts say. */
type ComposerPill = { kind: "card" | "item"; id: string; label: string; name?: string };
type FrameInk = { action: "drawing" | "card" | "send"; ids: string[]; canvas: string; box: { x: number; y: number; w: number; h: number } };

/** A comment from the frame, every text in it cleaned and cut. */
export function cleanFrameComment(comment: FrameComment): FrameComment {
	const component = frameText(comment.component);
	const items = frameTexts(comment.items);
	return {
		path: frameText(comment.path),
		title: frameText(comment.title),
		quote: frameText(comment.quote),
		text: frameText(comment.text),
		...(comment.send === true ? { send: true } : {}),
		...(component ? { component } : {}),
		...(items.length ? { items } : {}),
	};
}

/** Pills from the frame, their ids and labels cleaned and cut. */
export function cleanFramePills(pills: readonly FramePill[]): ComposerPill[] {
	return pills
		.slice(0, FRAME_IDS_LIMIT)
		.filter((pill) => pill && (pill.kind === "card" || pill.kind === "item"))
		.map((pill): ComposerPill => ({ kind: pill.kind, id: frameText(pill.id), label: frameText(pill.label), ...(pill.name ? { name: frameText(pill.name) } : {}) }))
		.filter((pill) => pill.id !== "");
}

/** A sketch from the frame, its ids and canvas cleaned and cut, its box plain numbers. */
export function cleanFrameInk<T extends FrameInk>(ink: T): Omit<T, "action"> & { action: "drawing" | "card" | "send" } {
	const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
	const action = ink.action === "drawing" ? "drawing" : ink.action === "card" ? "card" : "send";
	return { ...ink, action, ids: frameTexts(ink.ids), canvas: frameText(ink.canvas), box: { x: num(ink.box?.x), y: num(ink.box?.y), w: num(ink.box?.w), h: num(ink.box?.h) } };
}
