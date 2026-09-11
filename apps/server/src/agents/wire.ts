import type { ChatItem } from "@decks/protocol";

/**
 * What a transcript row looks like on its way to a browser.
 *
 * The server keeps every row whole — the store writes them, rewind and the archive read them —
 * but a browser only ever *draws* them, and most of a tool call is not drawn. Measured on the
 * live deck (2026-09-11): opening the page greeted 15 chats with 8.2 MB, and 7.1 MB of it was
 * tool calls — 3.9 MB of arguments the chat column has never read, and 3.1 MB of output behind
 * chips nobody had opened. So a row is trimmed at the one place it leaves: the arguments stay
 * here, and an output longer than a preview is cut to one, with its whole length beside it so
 * the chip knows to ask for the rest when it is opened (`chat.tool`).
 */

/**
 * How many rows a history carries. The column renders sixty of them (`history-page.ts`), and
 * reaching back pages the rest in — from the window a session keeps, then from the archive.
 */
export const HISTORY_ITEMS = 100;

/** How much of a tool call's output travels with it, in characters. */
export const TOOL_PREVIEW = 1000;

export function forBrowser(item: ChatItem): ChatItem {
	if (item.kind !== "tool") return item;
	const out: Extract<ChatItem, { kind: "tool" }> = { ...item };
	delete out.args;
	const result = item.result;
	if (result === undefined || result.length <= TOOL_PREVIEW) return out;
	// Not through the middle of a surrogate pair, which would put a broken character at the
	// end of every long preview that happened to stop on an emoji.
	let cut = TOOL_PREVIEW;
	const last = result.charCodeAt(cut - 1);
	if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
	out.result = result.slice(0, cut);
	out.full = result.length;
	return out;
}
