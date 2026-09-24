/**
 * What the composer is holding, as a document rather than a string.
 *
 * Ported from picone (`apps/web/src/lib/draft.ts`, its §57), where the reasoning was worked
 * out: a mention is an atomic thing that happens to be spelled `@something`. Kept as a string
 * it has to be found again by pattern every time it is drawn, deleted or sent, and what it
 * stands for has to be guessed back out of its label. So the draft is a list of nodes, each
 * mention carrying the id it stands for, and text is *derived* from it.
 *
 * Three kinds of mention, each standing for something the app already holds:
 *
 * - a **comment** on words selected on a board (`markup/comments.ts`), whose id is the
 *   comment's;
 * - a **board**, whose id is its path;
 * - an **item** drawn on the stage, whose id is its id in `stage.pen`.
 *
 * The last two arrive by dragging the thing onto the input bar (`canvas/Stage.tsx`). They are
 * pills rather than typed text for the reason the comment is: what a mention stands for should
 * not have to be guessed back out of its label, and a thing you dragged is a thing you pointed
 * at, not a path you typed. A file attached from disk is still spelled `@path` in plain text,
 * because a file has no identity here to lose.
 */

/** What a pill stands for. Each has its own colour and icon in the field. */
export type MentionKind = "comment" | "board" | "item";

export type DraftNode =
	| { type: "text"; text: string }
	| {
			type: "mention";
			kind: MentionKind;
			/** The comment's id in `state/comments.ts`, a board's path, or an item's id on the stage. */
			id: string;
			/** What the pill shows after its icon: the quoted words, the board's title, the item's name. */
			label: string;
	  };

export type Draft = DraftNode[];
export type DraftMention = Extract<DraftNode, { type: "mention" }>;

/** Adjacent text merged and empties dropped, so equal drafts compare equal. */
export function normalize(draft: Draft): Draft {
	const out: Draft = [];
	for (const node of draft) {
		if (node.type === "text") {
			if (node.text === "") continue;
			const last = out[out.length - 1];
			if (last?.type === "text") {
				last.text += node.text;
				continue;
			}
		}
		out.push({ ...node });
	}
	return out;
}

/**
 * What a pill draws: the words it points at, and no `@`.
 *
 * A comment is not something anyone types, it is a place on a board, so it carries no sigil.
 * What marks it out is the icon the field puts in front of it and the wash behind it, which
 * is picone's rule for the same pill.
 */
export function draftLabel(node: DraftMention): string {
	return node.label;
}

export const LABEL_LIMIT = 28;

/** Any words, on one line, short enough to sit in a sentence. */
export function shortLabel(words: string): string {
	const flat = words.replace(/\s+/g, " ").trim();
	return flat.length > LABEL_LIMIT ? `${flat.slice(0, LABEL_LIMIT - 1).trimEnd()}…` : flat;
}

/** The start of a quotation, in quotes, short enough to sit in a sentence. */
export function commentLabel(quote: string): string {
	return `“${shortLabel(quote)}”`;
}

/**
 * How the agent reads a pill that stands for a thing with an address.
 *
 * A board is `@boards/plan.html`, which is how a file dropped on the bar is already spelled,
 * because the path is what an agent opens it by. A drawn item has no file, so it is the same
 * spelling with the kind said: its id on the stage, which is what `stage.pen.read()` lists.
 */
export function mentionAddress(node: DraftMention): string {
	return node.kind === "board" ? `@${node.id}` : `@item:${node.id}`;
}

/**
 * What the draft reads as, and what is sent as the typed part of the message.
 *
 * A comment pill reads as nothing. It stands for a comment the app already holds, and what
 * the agent gets for it is a block composed from that comment (`commentBlock`), so writing
 * the label in as well would say the same thing twice.
 */
export function draftText(draft: Draft): string {
	return draft.map((node) => (node.type === "text" ? node.text : "")).join("");
}

/**
 * The typed part of the message as the agent reads it.
 *
 * A pill in the middle of a sentence has to stand for something there, or "Look at ⟨pill⟩ and
 * fix it" arrives as "Look at and fix it". So each reads as `[comment 1]`, numbered in the
 * order the pills sit, which is the order `commentBlock` lists them in. A draft that is
 * nothing but pills sends no words at all: the list is the whole message.
 */
export function draftForAgent(draft: Draft): string {
	let count = 0;
	const written = draft
		.map((node) => {
			if (node.type === "text") return node.text;
			return node.kind === "comment" ? `[comment ${++count}]` : mentionAddress(node);
		})
		.join("")
		.trim();
	/*
	 * A draft of comment pills and nothing else sends no words: the comments are the whole
	 * message, and each is composed into a block of its own. A board or an item is not composed
	 * into anything, so its address *is* the message, and dropping it would send nothing at all.
	 */
	return draftText(draft).trim() === "" && !draft.some((node) => node.type === "mention" && node.kind !== "comment") ? "" : written;
}

/** The comments the draft carries, in the order their pills sit in it — not the other pills. */
export function draftComments(draft: Draft): string[] {
	const ids: string[] = [];
	for (const node of draft) if (node.type === "mention" && node.kind === "comment") ids.push(node.id);
	return ids;
}

/** Nothing typed and nothing mentioned. A comment, a board or an item alone is a message. */
export function draftIsEmpty(draft: Draft): boolean {
	return draftText(draft).trim() === "" && !draft.some((node) => node.type === "mention");
}

export function textDraft(text: string): Draft {
	return text === "" ? [] : [{ type: "text", text }];
}

/** The clipboard type that carries pills between the composer and itself. */
export const DRAFT_MIME = "application/x-decks-draft";

export function serializeDraft(draft: Draft): string {
	return JSON.stringify(normalize(draft));
}

/** A draft off the clipboard. Anything unrecognised is refused; `text/plain` is the fallback. */
export function parseDraft(raw: string): Draft | null {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		const draft: Draft = [];
		for (const node of parsed) {
			if (!node || typeof node !== "object") return null;
			const value = node as Record<string, unknown>;
			if (value.type === "text" && typeof value.text === "string") draft.push({ type: "text", text: value.text });
			else if (
				value.type === "mention" &&
				(value.kind === "comment" || value.kind === "board" || value.kind === "item") &&
				typeof value.id === "string" &&
				typeof value.label === "string"
			) {
				draft.push({ type: "mention", kind: value.kind, id: value.id, label: value.label });
			} else return null;
		}
		return normalize(draft);
	} catch {
		return null;
	}
}
