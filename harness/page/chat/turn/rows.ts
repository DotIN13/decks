import type { ChatItem } from "@decks-next/protocol";

/** A tool call as the transcript carries it. */
export type ToolItem = Extract<ChatItem, { kind: "tool" }>;

/** One bubble in the floating transcript, addressed to the turn it belongs to. */
export type FloatRow =
	| { kind: "user"; id: string; turnId: string; text: string }
	| { kind: "assistant"; id: string; turnId: string; text: string; streaming: boolean; thinking?: string }
	| { kind: "tools"; id: string; turnId: string; calls: ToolItem[]; running: boolean; failed: boolean }
	| { kind: "notice"; id: string; turnId: string; text: string; level: "info" | "warn" | "error" };

/** The transcript, condensed for floating over the cards. */
export function floatRows(items: ChatItem[]): FloatRow[] {
	const rows: FloatRow[] = [];
	// A turn starts at a user message, the same rule `turnsOf` uses, and anything
	// before the first one belongs to the "before you asked" turn.
	let turnId = items[0]?.id ?? "";
	for (const item of items) {
		if (item.kind === "user") turnId = item.id;
		if (item.kind === "assistant") {
			/* A bubble needs something in it. */
			const said = item.text.trim() || (item.streaming === true && item.thinking?.trim());
			if (!said) continue;
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