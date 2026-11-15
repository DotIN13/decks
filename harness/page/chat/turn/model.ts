import type { ChatItem, MessagePart } from "@decks/protocol";
import { floatRows } from "./rows.ts";
import { toolSlots, type ToolSlot } from "../tool/model.ts";

// The conversation's rows folded into one card per speaker's turn.

/** A piece of what the agent did in one turn, in the order it happened. */
export type AgentPart =
	| { kind: "text"; id: string; text: string; streaming: boolean; thinking?: string }
	| { kind: "tools"; id: string; slots: ToolSlot[] };

/** One card in the column. */
export type TurnCard =
	/** `parts`: the message as written, its pills as data, when it was sent with them (`MessagePart`). */
	| { kind: "mine"; id: string; at?: number; text: string; entryId?: string; parts?: MessagePart[] }
	| { kind: "agent"; id: string; at?: number; parts: AgentPart[] }
	| { kind: "notice"; id: string; at?: number; level: "info" | "warn" | "error"; text: string };

/** The transcript as cards: the conversation column's unit of layout. */
export function turnCards(items: readonly ChatItem[]): TurnCard[] {
	const rows = floatRows([...items]);
	const byId = new Map(items.map((item) => [item.id, item]));
	/** When something was said, the time on a card's `title`, and what a day boundary is read from. */
	const at = (id: string) => {
		const item = byId.get(id);
		return item && item.kind !== "tool" ? item.at : undefined;
	};

	const cards: TurnCard[] = [];
	for (const row of rows) {
		if (row.kind === "user") {
			const item = byId.get(row.id);
			cards.push({
				kind: "mine",
				id: row.id,
				text: row.text,
				at: at(row.id),
				// Only once the server has paired it with the session entry it became, which is
				// what there would be to rewind to.
				...(item?.kind === "user" && item.entryId ? { entryId: item.entryId } : {}),
				...(item?.kind === "user" && item.parts?.length ? { parts: item.parts } : {}),
			});
			continue;
		}
		if (row.kind === "notice") {
			cards.push({ kind: "notice", id: row.id, at: at(row.id), level: row.level, text: row.text });
			continue;
		}
		const part: AgentPart =
			row.kind === "tools"
				? { kind: "tools", id: row.id, slots: toolSlots(row.calls) }
				: { kind: "text", id: row.id, text: row.text, streaming: row.streaming, ...(row.thinking ? { thinking: row.thinking } : {}) };
		const last = cards.at(-1);
		if (last?.kind === "agent") last.parts.push(part);
		else cards.push({ kind: "agent", id: row.id, parts: [part], at: at(row.id) });
	}
	return cards;
}
