import type { ChatItem } from "@decks/protocol";

/** A tool call as the transcript carries it. */
export type ToolItem = Extract<ChatItem, { kind: "tool" }>;

/**
 * One bubble in the floating transcript, addressed to the turn it belongs to.
 *
 * `id` is the item's own id; `turnId` is the id of the turn the row sits in —
 * the first user message of that turn, or the first item of all when nothing has
 * been asked yet. The turn is what a click on the bubble rewinds the sheet to.
 */
export type FloatRow =
	| { kind: "user"; id: string; turnId: string; text: string }
	| { kind: "assistant"; id: string; turnId: string; text: string; streaming: boolean; thinking?: string }
	| { kind: "tools"; id: string; turnId: string; calls: ToolItem[]; running: boolean; failed: boolean }
	| { kind: "notice"; id: string; turnId: string; text: string; level: "info" | "warn" | "error" };

/**
 * The transcript, condensed for floating over the boards.
 *
 * User and assistant items become bubbles; a run of consecutive tool items
 * collapses into one slim row, because a turn that edits files is mostly tool
 * calls and the float is about the conversation, not the code; notices stay as
 * slim lines. An assistant bubble that exists only between a turn starting and
 * its first token has nothing to float — it is skipped until there is text or
 * it is streaming.
 *
 * The collapsed row keeps the **whole call**, not just its name. The float is the
 * only transcript there is now — the chat column it used to summarise is gone — so
 * "3 tool calls" has to be something you can open, and what a person opens it for is
 * the output. Collapsed is the default and the detail is one click away, which is the
 * same bargain a tool chip has always made with its own output.
 */
export function floatRows(items: ChatItem[]): FloatRow[] {
	const rows: FloatRow[] = [];
	// A turn starts at a user message — the same rule `turnsOf` uses — and anything
	// before the first one belongs to the "before you asked" turn.
	let turnId = items[0]?.id ?? "";
	for (const item of items) {
		if (item.kind === "user") turnId = item.id;
		if (item.kind === "assistant") {
			if (!item.text.trim() && !item.streaming) continue;
			rows.push({
				kind: "assistant",
				id: item.id,
				turnId,
				text: item.text,
				streaming: item.streaming === true,
				...(item.thinking?.trim() ? { thinking: item.thinking } : {}),
			});
			continue;
		}
		if (item.kind === "notice") {
			rows.push({ kind: "notice", id: item.id, turnId, text: item.text, level: item.level });
			continue;
		}
		if (item.kind === "user") {
			rows.push({ kind: "user", id: item.id, turnId, text: item.text });
			continue;
		}
		// Tool: absorbed into the tools row behind it when there is one.
		const last = rows.at(-1);
		if (last?.kind === "tools" && last.turnId === turnId) {
			rows[rows.length - 1] = {
				...last,
				calls: [...last.calls, item],
				running: last.running || item.state === "running",
				failed: last.failed || item.state === "error",
			};
			continue;
		}
		rows.push({
			kind: "tools",
			id: item.id,
			turnId,
			calls: [item],
			running: item.state === "running",
			failed: item.state === "error",
		});
	}
	return rows;
}