import type { ChatItem } from "@decks/protocol";
import { floatRows } from "./float-rows.ts";
import { toolSlots, type ToolSlot } from "./tool-groups.ts";

/**
 * A piece of what the agent did in one turn, in the order it happened.
 *
 * A tools part carries **slots**, not calls: which of a turn's calls may hide behind a count
 * is decided here, once, by `tool-groups.ts`. A surface that re-decided it would be a second
 * opinion about what a transcript looks like, and this project has already paid for one.
 */
export type AgentPart =
	| { kind: "text"; id: string; text: string; streaming: boolean; thinking?: string }
	| { kind: "tools"; id: string; slots: ToolSlot[] };

/**
 * One card in the column.
 *
 * A turn is one card however many calls it made — `parts` is what the agent did, in order,
 * and the card is the object the reader drags their eye down. Notices are their own card
 * rather than a line inside one: a failure to launch is not something the agent said, and
 * burying it in a reply's card is how it gets missed.
 */
export type TurnCard =
	| { kind: "mine"; id: string; at?: number; text: string; entryId?: string }
	| { kind: "agent"; id: string; at?: number; parts: AgentPart[] }
	| { kind: "notice"; id: string; at?: number; level: "info" | "warn" | "error"; text: string };

/**
 * The transcript as cards: the conversation column's unit of layout, and now a mirror's too.
 *
 * Two folds, and they are different questions. `floatRows` asks what was *said* — a bubble per
 * message, a row per run of tool calls, and nothing at all for a reply that has not started.
 * This asks what belongs *together*: consecutive rows from the agent's side are one object in
 * the column however many calls it made, so they become one card's `parts`. No turn check is
 * needed to stop them merging across turns, because what starts a turn is a user message,
 * which puts a card of its own in between.
 *
 * **It is here, and not in the component, because a board draws it too.** `lib/live-chat.js`
 * renders a mirror, and until now it carried its own copy of `floatRows` — which had already
 * drifted: the panel drops a finished turn whose only content is thinking, the copy kept it,
 * so the same conversation had a row in the mirror that was not in the column. The fix for a
 * duplicated rule is not a better comment about keeping them in step; it is to stop having
 * two. The app posts these cards (`canvas/live-chat.ts`) and the board draws what it is given.
 *
 * Pure, and separate from `Turn.tsx`, because the folds are the part worth asserting and a
 * component is a poor place to assert anything.
 */
export function turnCards(items: readonly ChatItem[]): TurnCard[] {
	const rows = floatRows([...items]);
	const byId = new Map(items.map((item) => [item.id, item]));
	/** When something was said — the time on a card's `title`, and what a day boundary is read from. */
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
