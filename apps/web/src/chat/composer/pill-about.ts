import type { PillAbout } from "@decks/agent-ui/composer";
import type { MessageMention, MessagePart } from "@decks/protocol";
import { commentItem } from "../../markup/comments.ts";
import type { WaitingComment } from "../../state/comments.ts";
import { commentLabel, mentionAddress, shortLabel, type Draft, type DraftMention } from "./draft.ts";

/**
 * What a pill is about, for its tooltip and its card (`@decks/agent-ui` `pill-card.ts`), what a sent
 * message keeps of its pills (`messageParts`), and a sent message read back into its pills.
 *
 * Pure, so the exact text a card shows is tested against what the message is built from: a comment's
 * is `commentItem`, the entry `commentBlock` lists it as, and a board's, an item's or a file's is
 * `mentionAddress`, the address `draftForAgent` writes.
 */

/** A board's, a card's or a file's name from its path: `cards/sdk/index.html` is "sdk", `boards/plan.html` "plan". */
export function pathName(path: string): string {
	const parts = path.replace(/\/index\.html?$/, "").split("/");
	return (parts.pop() || path).replace(/\.html?$/, "");
}

/** Looks a board's title up by its path; the app's boards know theirs. */
export type TitleOf = (path: string) => string | undefined;
/** Looks a drawn item's name up by its id: its own name, or a few of its words (the layers list's label). */
export type ItemName = (id: string) => string | undefined;

const none = () => undefined;

/**
 * What a comment is called: the title of the board or card it is on, or the drawn item it is on by its
 * name (`3 items` for several). A comment kept with a sent message has its name as its `title`.
 */
export function commentName(comment: WaitingComment, titleOf: TitleOf = none, itemName: ItemName = none): string {
	if (comment.title) return comment.title;
	const items = comment.items ?? [];
	if (items.length > 1) return `${items.length} items`;
	if (items.length === 1) return itemName(items[0]!) ?? items[0]!;
	return titleOf(comment.board) ?? pathName(comment.board);
}

/**
 * A comment's pill: the start of its quote, or the name of what it is on when it quotes nothing. A
 * comment from the canvas is as short as yours, with a dashed edge (`from`); all of it is in its card.
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

/** What comment `n` of a message is about: the board or card it is on, the quote, the note, and its entry in the message. */
export function aboutComment(comment: WaitingComment, n: number, titleOf: TitleOf = none, itemName: ItemName = none): PillAbout {
	const drawn = !!comment.items?.length;
	const name = commentName(comment, titleOf, itemName);
	const where = drawn ? `on ${pathName(comment.board.replace(/\/canvas\.pen$/, ""))}` : `on “${name}”${comment.component ? `, #${comment.component}` : ""}`;
	return {
		name,
		of: drawn ? "shape" : "card",
		...(comment.quote ? { quote: comment.quote } : {}),
		note: comment.text,
		source: comment.from === "canvas" ? `From the canvas: a card handed this over, ${where}` : `Your comment, ${where}`,
		exact: commentItem(comment, n),
		...(comment.from === "canvas" ? { canvas: true } : {}),
	};
}

/** What a board, an item or a file is called: its title, its name or words, its file's name. */
export function addressName(node: DraftMention, titleOf: TitleOf = none, itemName: ItemName = none): string {
	if (node.kind === "file") return node.name ?? (node.id.split("/").pop() || node.id);
	if (node.kind === "item") return itemName(node.id) ?? node.name ?? node.label;
	return titleOf(node.id) ?? node.name ?? node.label;
}

/** What a board, an item or a file pill is about. */
export function aboutAddress(node: DraftMention, titleOf?: TitleOf, itemName?: ItemName): PillAbout {
	const exact = mentionAddress(node);
	const name = addressName(node, titleOf, itemName);
	if (node.kind === "file") return { name, of: "file", source: `File, in the deck as ${node.id}`, exact };
	if (node.kind === "item") return { name, of: "shape", source: "On the canvas, a drawn item", exact };
	return { name, of: "card", source: `On the canvas, a board or card: ${node.id}`, exact };
}

// --- a sent message, kept as its parts --------------------------------------------------

/**
 * A message as it is sent, as data (`MessagePart`): its words, and each pill with what it is called, who
 * put it in, and what its card shows, kept with the message beside the text the agent gets, which this
 * does not change. `comments` are the comments the message carries, in the order `[comment n]` counts
 * them (`withComments`); a comment pill whose comment is not among them was not sent, and is left out.
 * `canvas` is the canvas a drawn item is on.
 */
export function messageParts(draft: Draft, comments: readonly WaitingComment[], names: { titleOf?: TitleOf; itemName?: ItemName; canvas?: string } = {}): MessagePart[] {
	const parts: MessagePart[] = [];
	for (const node of draft) {
		if (node.type === "text") {
			if (node.text) parts.push({ type: "text", text: node.text });
			continue;
		}
		if (node.kind === "comment") {
			const n = comments.findIndex((comment) => comment.id === node.id) + 1;
			const comment = comments[n - 1];
			if (!comment) continue;
			parts.push({
				type: "mention",
				kind: "comment",
				id: comment.id,
				name: commentName(comment, names.titleOf, names.itemName),
				from: comment.from === "canvas" ? "canvas" : "you",
				label: commentPill(comment, names.titleOf, names.itemName).label,
				...(comment.quote ? { quote: comment.quote } : {}),
				...(comment.text ? { note: comment.text } : {}),
				path: comment.board,
				...(comment.items?.length ? { items: [...comment.items] } : {}),
				...(comment.component ? { component: comment.component } : {}),
				exact: commentItem(comment, n),
			});
			continue;
		}
		const path = node.kind === "item" ? names.canvas : node.id;
		parts.push({
			type: "mention",
			kind: node.kind,
			id: node.id,
			name: addressName(node, names.titleOf, names.itemName),
			from: "you",
			label: node.label,
			...(path ? { path } : {}),
			exact: mentionAddress(node),
		});
	}
	return parts;
}

/** The comment a stored comment part was written from, for its card and for showing it. */
function partComment(part: MessageMention): WaitingComment {
	return {
		id: part.id,
		board: part.path ?? "",
		quote: part.quote ?? "",
		text: part.note ?? "",
		at: 0,
		title: part.name,
		...(part.items?.length ? { items: [...part.items] } : {}),
		...(part.component ? { component: part.component } : {}),
		...(part.from === "canvas" ? { from: "canvas" as const } : {}),
	};
}

/** A message's stored parts, read into the pills it was written with and what each is about. */
export function readParts(parts: readonly MessagePart[]): SentReading | undefined {
	const comments = new Map<string, WaitingComment>();
	const exact = new Map<string, string>();
	const draft: Draft = [];
	for (const part of parts) {
		if (part.type === "text") {
			draft.push({ type: "text", text: part.text });
			continue;
		}
		const name = part.name || part.id;
		if (part.kind === "comment") {
			const comment = partComment(part);
			comments.set(part.id, comment);
			if (part.exact) exact.set(part.id, part.exact);
			draft.push(commentPill(comment));
			continue;
		}
		draft.push({ type: "mention", kind: part.kind, id: part.id, label: part.label || shortLabel(name), name });
	}
	return draft.some((node) => node.type === "mention") ? { draft, comments, exact } : undefined;
}

// --- a sent message, read back from its text (one sent before parts were kept) -------------

const HEADS: Array<[RegExp, (match: RegExpExecArray) => number]> = [
	[/^A comment on a board\. The quoted words are what I selected:$/, () => 1],
	[/^(\d+) comments on boards\. The quoted words are what I selected:$/, (m) => Number(m[1])],
	[/^A comment on items drawn on a canvas:$/, () => 1],
	[/^(\d+) comments on items drawn on a canvas:$/, (m) => Number(m[1])],
];

/** One entry of `commentBlock`, read back into the comment it was written from. */
function readEntry(lines: string[], n: number): WaitingComment {
	const first = lines[0]!.slice(`${n}. `.length);
	const rest = lines.slice(1).map((line) => line.slice(3));
	const comment: WaitingComment = { id: `sent-${n}`, board: first, quote: "", text: "", at: 0 };
	const drawn = /^on (.+?), items? ((?:"[^"]*"(?:, )?)+)(?: \("([\s\S]*)"\))?$/.exec(first);
	if (drawn) {
		comment.board = drawn[1]!;
		comment.items = [...drawn[2]!.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
		comment.quote = drawn[3] ?? "";
	} else {
		let where = first;
		if (where.endsWith(", the whole board")) where = where.slice(0, -", the whole board".length);
		else if (rest[0]?.startsWith("> ")) comment.quote = rest.shift()!.slice(2);
		const inside = /^(.*), in #(\S+)$/.exec(where);
		comment.board = inside ? inside[1]! : where;
		if (inside) comment.component = inside[2]!;
	}
	comment.text = rest.join("\n");
	return comment;
}

/** An `@` address in typed words: `@item:id`, or a path with a folder or an extension. A name (`@Sable`) is not one. */
const ADDRESS = /(^|\s)@(item:[^\s]+|[^\s@]*\/[^\s]*|[^\s@/]+\.[A-Za-z0-9]{1,8})/g;
const COMMENT_REF = /\[comment (\d+)\]/g;

export interface SentReading {
	draft: Draft;
	/** The comments the message carried, by their pills' ids. */
	comments: Map<string, WaitingComment>;
	/** Each comment's entry exactly as it was sent. */
	exact: Map<string, string>;
}

/**
 * A message as it was sent (`withComments` over `draftForAgent`), read back into the pills it was
 * written with: the comments listed in front come back to where their `[comment n]` sat, or in front
 * when the words did not place them, and each address in the words is a board's, an item's or a
 * file's pill again. Nothing to draw as a pill: `undefined`, and the bubble is the text.
 */
export function readSent(text: string, titleOf: TitleOf = none): SentReading | undefined {
	const comments = new Map<string, WaitingComment>();
	const exact = new Map<string, string>();
	let said = text;
	const lines = text.split("\n");
	const head = HEADS.map(([pattern, count]) => {
		const match = pattern.exec(lines[0] ?? "");
		return match ? count(match) : 0;
	}).find((count) => count > 0);
	if (head && lines[1] === "") {
		let at = 2;
		for (let n = 1; n <= head; n++) {
			if (!lines[at]?.startsWith(`${n}. `)) return undefined;
			const entry = [lines[at]!];
			at++;
			while (at < lines.length && lines[at]!.startsWith("   ")) entry.push(lines[at++]!);
			const comment = readEntry(entry, n);
			const written = entry.join("\n");
			comments.set(comment.id, comment);
			exact.set(comment.id, written);
			if (n < head) {
				if (lines[at] !== "") return undefined;
				at++;
			}
		}
		if (at < lines.length && lines[at] !== "") return undefined;
		said = lines.slice(at + 1).join("\n");
	}

	const draft: Draft = [];
	const placed = new Set<string>();
	// The words, with each `[comment n]` and each address as its pill.
	const marks = [
		...[...said.matchAll(COMMENT_REF)].map((m) => ({ at: m.index!, length: m[0].length, comment: `sent-${m[1]}` })),
		...[...said.matchAll(ADDRESS)].map((m) => {
			const address = m[2]!.replace(/[.,;:!?)\]]+$/, "");
			return { at: m.index! + m[1]!.length, length: address.length + 1, address };
		}),
	].sort((a, b) => a.at - b.at);
	let from = 0;
	for (const mark of marks) {
		if (mark.at < from) continue;
		if ("comment" in mark && !comments.has(mark.comment!)) continue;
		draft.push({ type: "text", text: said.slice(from, mark.at) });
		if ("comment" in mark) {
			draft.push(commentPill(comments.get(mark.comment!)!, titleOf));
			placed.add(mark.comment!);
		} else {
			const address = mark.address!;
			if (address.startsWith("item:")) draft.push({ type: "mention", kind: "item", id: address.slice(5), label: address.slice(5) });
			else draft.push({ type: "mention", kind: /\.html?$/.test(address) ? "board" : "file", id: address, label: /\.html?$/.test(address) ? titleOf(address) ?? pathName(address) : address.split("/").pop() || address });
		}
		from = mark.at + mark.length;
	}
	draft.push({ type: "text", text: said.slice(from) });
	// Comments the words did not place, in front, in their order.
	const front = [...comments.keys()].filter((id) => !placed.has(id));
	const lead: Draft = front.flatMap((id, index) => [...(index ? [{ type: "text" as const, text: " " }] : []), commentPill(comments.get(id)!, titleOf)]);
	if (lead.length && said.trim()) lead.push({ type: "text", text: " " });
	const whole = [...lead, ...draft].filter((node) => node.type !== "text" || node.text !== "");
	return whole.some((node) => node.type === "mention") ? { draft: whole, comments, exact } : undefined;
}

/** What a pill in a sent message is about: as it was sent, by the name it had and the exact words it went as. */
export function aboutSent(reading: SentReading, node: DraftMention, titleOf?: TitleOf): PillAbout | undefined {
	// A board, an item or a file carries the name it was sent with (`readParts`), or its title now.
	if (node.kind !== "comment") return aboutAddress(node, titleOf);
	const comment = reading.comments.get(node.id);
	if (!comment) return undefined;
	const n = [...reading.comments.keys()].indexOf(node.id) + 1;
	return { ...aboutComment(comment, n, titleOf), exact: reading.exact.get(node.id) ?? commentItem(comment, n) };
}
