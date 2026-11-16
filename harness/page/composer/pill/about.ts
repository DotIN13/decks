import { commentLabel, type DraftMention, mentionAddress, shortLabel } from "../draft/model.ts";
import type { PillAbout } from "./card.ts";
import { commentItem } from "../../markup/comments.ts";
import type { WaitingComment } from "../../state/index.ts";

// What a pill is about: its name, and the words and address its card shows, for a comment,
// a card, an item or a file.

/** Looks a card's title up by its path; the app's cards know theirs. */
export type TitleOf = (path: string) => string | undefined;

/** Looks a drawn item's name up by its id: its own name, or a few of its words (the layers list's label). */
export type ItemName = (id: string) => string | undefined;

export const none = () => undefined;

/** A card's or a file's name from its path: `cards/sdk/index.html` is "sdk", the canvas "plan". */
export function pathName(path: string): string {
	const parts = path.replace(/\/index\.html?$/, "").split("/");
	return (parts.pop() || path).replace(/\.html?$/, "");
}

// Comment pills.
/**
 * What a comment is called: the title of the card it is on, or the drawn item it is on by its
 * name (`3 items` for several). A comment kept with a sent message has its name as its `title`.
 */
export function commentName(comment: WaitingComment, titleOf: TitleOf = none, itemName: ItemName = none): string {
	if (comment.title) return comment.title;
	const items = comment.items ?? [];
	if (items.length > 1) return `${items.length} items`;
	if (items.length === 1) return itemName(items[0]!) ?? items[0]!;
	const path = comment.path ?? "";
	return titleOf(path) ?? pathName(path);
}

/**
 * A comment's pill: the start of its quote, or the name of what it is on when it quotes nothing. A
 * comment from the canvas is as short as yours (`from` marks it, and its card names it in amber); all of it is in its card.
 */
export function commentPill(comment: WaitingComment, titleOf?: TitleOf, itemName?: ItemName): DraftMention {
	const name = commentName(comment, titleOf, itemName);
	return {
		type: "mention",
		kind: "comment",
		id: comment.id,
		label: comment.quote ? commentLabel(comment.quote) : shortLabel(name),
		name,
		...(comment.from === "canvas" ? { from: "canvas" as const } : {}),
	};
}

/** What comment `n` of a message is about: the card it is on, the quote, the note, and its entry in the message. */
export function aboutComment(comment: WaitingComment, n: number, titleOf: TitleOf = none, itemName: ItemName = none): PillAbout {
	const drawn = !!comment.items?.length;
	const name = commentName(comment, titleOf, itemName);
	// Where on it, never its name again: the tooltip and the card name it already.
	const where = drawn ? `, on ${pathName((comment.path ?? "").replace(/\/canvas\.pen$/, ""))}` : comment.component ? `, #${comment.component}` : "";
	return {
		name,
		of: drawn ? "shape" : "card",
		...(comment.quote ? { quote: comment.quote } : {}),
		note: comment.text,
		source: comment.from === "canvas" ? `From the canvas${where}` : `Your comment${where}`,
		exact: commentItem(comment, n),
		...(comment.from === "canvas" ? { canvas: true } : {}),
	};
}

// Card, item and file pills.
/** What a card, an item or a file pill is about. */
export function aboutAddress(node: DraftMention, titleOf?: TitleOf, itemName?: ItemName): PillAbout {
	const exact = mentionAddress(node);
	const name = addressName(node, titleOf, itemName);
	if (node.kind === "file") return { name, of: "file", source: `File, in the deck as ${node.id}`, exact };
	if (node.kind === "item") return { name, of: "shape", source: "On the canvas, a drawn item", exact };
	return { name, of: "card", source: `On the canvas, a card: ${node.id}`, exact };
}

/** What a card, an item or a file is called: its title, its name or words, its file's name. */
export function addressName(node: DraftMention, titleOf: TitleOf = none, itemName: ItemName = none): string {
	if (node.kind === "file") return node.name ?? (node.id.split("/").pop() || node.id);
	if (node.kind === "item") return itemName(node.id) ?? node.name ?? node.label;
	return titleOf(node.id) ?? node.name ?? node.label;
}
