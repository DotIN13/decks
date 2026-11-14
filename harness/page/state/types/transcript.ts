/**
 * A thing put into a message as a pill (`@decks/agent-ui` `composer/draft.ts`): a comment, a card (or
 * an old board), a drawn item, a file. Kept with the message as it was sent, so the conversation draws
 * the same pill with the same card after a reload and on another device, without reading it back out of
 * the text. A message saved before cards says `"board"` for a card: whoever reads one reads it as `"card"`.
 */
export interface MessageMention {
	type: "mention";
	kind: "comment" | "card" | "item" | "file";
	/** The comment's id, a board's or a file's path, an item's id on the stage. */
	id: string;
	/** What it is called: the board or card a comment is on, the board's title, the item's name, the file's name. */
	name: string;
	/** Who put it in: you, or the canvas (a card's script can hand a comment over). */
	from: "you" | "canvas";
	/** What the pill showed. */
	label?: string;
	quote?: string;
	note?: string;
	/** Where it is: the board or card a comment is on, a board's or a file's path, an item's canvas. */
	path?: string;
	/** A comment on drawn items: their ids. */
	items?: string[];
	/** A comment inside a component of a board: its name. */
	component?: string;
	/** The words the agent received for it. */
	exact?: string;
}

/** A message as it was written: its words and pills in order. The text the agent got is beside it, unchanged. */
export type MessagePart = { type: "text"; text: string } | MessageMention;

/** One item in a conversation — what a turn looks like once it is on the wire. */
export type ChatItem =
	| { kind: "user"; id: string; text: string; at: number; entryId?: string; parts?: MessagePart[] }
	| { kind: "assistant"; id: string; text: string; at: number; thinking?: string; streaming?: boolean }
	/**
	 * A tool call. `args` stays on the server: the browser has never read them — the chip's
	 * `title` is what they are for — and they were half of what a greeting weighed. `result`
	 * travels as a preview when it is long, and `full` is then how long the whole of it is;
	 * opening the chip asks for the rest with `chat.tool` (`agents/wire.ts`).
	 */
	| { kind: "tool"; id: string; name: string; title: string; args?: unknown; result?: string; full?: number; images?: number; state: "running" | "done" | "error" }
	| { kind: "notice"; id: string; level: "info" | "warn" | "error"; text: string; at: number };
