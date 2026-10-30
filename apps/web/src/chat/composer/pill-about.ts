import { FROM_CANVAS, type PillAbout } from "@decks/agent-ui/composer";
import { commentItem } from "../../markup/comments.ts";
import type { WaitingComment } from "../../state/comments.ts";
import { commentLabel, mentionAddress, type Draft, type DraftMention } from "./draft.ts";

/**
 * What a pill is about, for its tooltip and its card (`@decks/agent-ui` `pill-card.ts`), and a sent
 * message read back into its pills.
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

/**
 * A comment's pill. A comment from the canvas shows its whole text, not only on hover, marked as from
 * the canvas: anything there can hand one over, a card's script too, and it goes with your next
 * message, so you read all of what goes (`state/comments.ts`, `cleanFrameComment`).
 */
export function commentPill(comment: WaitingComment): DraftMention {
	const where = comment.quote ? commentLabel(comment.quote) : comment.board.split("/").pop() ?? comment.board;
	if (comment.from !== "canvas") return { type: "mention", kind: "comment", id: comment.id, label: where };
	const quote = comment.quote ? `“${comment.quote}”` : where;
	return { type: "mention", kind: "comment", id: comment.id, label: `${FROM_CANVAS} ${quote}${comment.text ? ` — ${comment.text}` : ""}` };
}

/** What comment `n` of a message is about: the board or card it is on, the quote, the note, and its entry in the message. */
export function aboutComment(comment: WaitingComment, n: number, titleOf: TitleOf = () => undefined): PillAbout {
	const drawn = !!comment.items?.length;
	const name = drawn ? (comment.items!.length === 1 ? comment.items![0]! : `${comment.items!.length} items`) : comment.title ?? titleOf(comment.board) ?? pathName(comment.board);
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

/** What a board, an item or a file pill is about. */
export function aboutAddress(node: DraftMention, titleOf: TitleOf = () => undefined): PillAbout {
	const exact = mentionAddress(node);
	if (node.kind === "file") return { name: pathName(node.id), of: "file", source: `File, in the deck as ${node.id}`, exact };
	if (node.kind === "item") return { name: node.label, of: "shape", source: "On the canvas, a drawn item", exact };
	return { name: titleOf(node.id) ?? node.label, of: "card", source: "On the canvas, a board or card", exact };
}

// --- a sent message, read back ----------------------------------------------------------

/*
 * Which comments came from the canvas is not in the message: the agent reads them like yours. So it is
 * remembered on this device as they are sent, by their entry without its number, for the dashed edge.
 */
const CANVAS_KEY = "decks.sent-from-canvas";
const CANVAS_LIMIT = 100;
type Store = Pick<Storage, "getItem" | "setItem">;
const unnumbered = (entry: string) => entry.replace(/^\d+\. /, "");

function canvasEntries(store: Store | undefined): string[] {
	try {
		const raw: unknown = JSON.parse(store?.getItem(CANVAS_KEY) ?? "[]");
		return Array.isArray(raw) ? raw.filter((one): one is string => typeof one === "string") : [];
	} catch {
		return [];
	}
}

/** Remember the comments from the canvas in a message about to be sent. */
export function rememberFromCanvas(store: Store | undefined, comments: readonly WaitingComment[]): void {
	const handed = comments.filter((comment) => comment.from === "canvas").map((comment) => unnumbered(commentItem(comment, 1)));
	if (!handed.length) return;
	try {
		store?.setItem(CANVAS_KEY, JSON.stringify([...canvasEntries(store).filter((one) => !handed.includes(one)), ...handed].slice(-CANVAS_LIMIT)));
	} catch {
		/* a full store: the pill is drawn as yours */
	}
}

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
	/** The comments the message carried, by their pills' ids, read back out of its text. */
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
export function readSent(text: string, store?: Store, titleOf: TitleOf = () => undefined): SentReading | undefined {
	const comments = new Map<string, WaitingComment>();
	const exact = new Map<string, string>();
	let said = text;
	const lines = text.split("\n");
	const head = HEADS.map(([pattern, count]) => {
		const match = pattern.exec(lines[0] ?? "");
		return match ? count(match) : 0;
	}).find((count) => count > 0);
	if (head && lines[1] === "") {
		const handed = canvasEntries(store);
		let at = 2;
		for (let n = 1; n <= head; n++) {
			if (!lines[at]?.startsWith(`${n}. `)) return undefined;
			const entry = [lines[at]!];
			at++;
			while (at < lines.length && lines[at]!.startsWith("   ")) entry.push(lines[at++]!);
			const comment = readEntry(entry, n);
			const written = entry.join("\n");
			if (handed.includes(unnumbered(written))) comment.from = "canvas";
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
			draft.push(commentPill(comments.get(mark.comment!)!));
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
	const lead: Draft = front.flatMap((id, index) => [...(index ? [{ type: "text" as const, text: " " }] : []), commentPill(comments.get(id)!)]);
	if (lead.length && said.trim()) lead.push({ type: "text", text: " " });
	const whole = [...lead, ...draft].filter((node) => node.type !== "text" || node.text !== "");
	return whole.some((node) => node.type === "mention") ? { draft: whole, comments, exact } : undefined;
}

/** What a pill in a sent message is about: a comment's card shows its entry exactly as it was sent. */
export function aboutSent(reading: SentReading, node: DraftMention, titleOf?: TitleOf): PillAbout | undefined {
	if (node.kind !== "comment") return aboutAddress(node, titleOf);
	const comment = reading.comments.get(node.id);
	if (!comment) return undefined;
	const n = Number(node.id.slice("sent-".length));
	return { ...aboutComment(comment, n, titleOf), exact: reading.exact.get(node.id) ?? commentItem(comment, n) };
}
