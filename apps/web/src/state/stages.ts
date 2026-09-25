import { createSignal } from "solid-js";
import type { ServerMessage, StageRow } from "@decks/protocol";

/**
 * Every stage in the deck, as the server lists them (`app.stagesMessage`).
 *
 * A signal of the whole list rather than a store: it is short, it is replaced whole whenever
 * anything about it changes, and the one thing that reads it — the stage manager — reads all of
 * it at once. Kept here rather than in the deck store because a stage is not a board: the deck
 * store is what is *on* the canvas, and this is what other canvases there are.
 */
const [stages, setStages] = createSignal<StageRow[]>([]);

export { stages };

export function receiveStages(message: Extract<ServerMessage, { type: "stages" }>): void {
	setStages(message.stages);
}

/** The stage a given agent is on, by name, or nothing when it has never drawn. */
export function stageOf(agentId: string | undefined): StageRow | undefined {
	if (!agentId) return undefined;
	return stages().find((one) => one.agents.some((agent) => agent.id === agentId));
}

/**
 * The stages a query matches, and whether each did.
 *
 * Matched on the name, the words its boards and notes carry, and who is on it — the three
 * things a person has to go on when they are looking for the room they left something in. The
 * list keeps its order and its length: a stage that does not match is dimmed where it stands
 * rather than removed, so the wall does not reflow under the hand that is typing.
 */
export function searchStages(list: StageRow[], query: string): Array<{ stage: StageRow; hit: boolean }> {
	const q = query.trim().toLowerCase();
	return list.map((stage) => ({
		stage,
		hit: q === "" || `${stage.name} ${stage.words} ${stage.agents.map((agent) => agent.name).join(" ")}`.toLowerCase().includes(q),
	}));
}
