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

export function receiveStages(message: Extract<ServerMessage, { type: "canvas.list" }>): void {
	setStages(message.stages);
	// A move the server now shows is done; one it shows otherwise stays until its own answer comes back.
	const going = moving();
	if (going && message.stages.some((one) => one.name === going.canvas && one.agents.some((agent) => agent.id === going.agent))) setMoving(undefined);
}

/**
 * A move to another canvas this page has made and the server has not shown yet (`moveTo`): the page
 * goes there at once, and every reader of `stageOf` with it, rather than waiting for the server's
 * answer and the canvas list after it.
 */
const [moving, setMoving] = createSignal<{ agent: string; canvas: string }>();

/**
 * Move an agent to a canvas on this page now, while `send` tells the server: the canvas on screen follows
 * at once. A move the server refuses goes back, and the refusal is passed on.
 */
export async function moveTo(agent: string, canvas: string, send: () => Promise<unknown>): Promise<void> {
	setMoving({ agent, canvas });
	try {
		await send();
	} catch (error) {
		if (moving()?.agent === agent && moving()?.canvas === canvas) setMoving(undefined);
		throw error;
	}
}

/** The stage a given agent is on, by name, or nothing when it has never drawn. */
export function stageOf(agentId: string | undefined): StageRow | undefined {
	if (!agentId) return undefined;
	const going = moving();
	if (going?.agent === agentId) {
		const there = stages().find((one) => one.name === going.canvas);
		if (there) return there;
	}
	return stages().find((one) => one.agents.some((agent) => agent.id === agentId));
}

/** The canvas of this name when it is a friend's, shared with you to view: read here, changed only in a copy. */
export function viewOnly(name: string | undefined): StageRow | undefined {
	const row = name ? stages().find((one) => one.name === name) : undefined;
	return row?.shared?.role === "view" ? row : undefined;
}

/**
 * The stages a query matches, and whether each did.
 *
 * Matched on the name, the folder, the words its boards and notes carry, and who is on it — the
 * things a person has to go on when they are looking for the room they left something in. Every
 * stage comes back with `hit`, in its order; the manager shows only the hits.
 */
export function searchStages(list: StageRow[], query: string): Array<{ stage: StageRow; hit: boolean }> {
	const q = query.trim().toLowerCase();
	return list.map((stage) => ({
		stage,
		hit: q === "" || `${stage.title} ${stage.name} ${stage.words} ${stage.agents.map((agent) => agent.name).join(" ")}`.toLowerCase().includes(q),
	}));
}

/** No stages: a switch to another backend (`connections/switch.ts`). */
export function resetStages(): void {
	setStages([]);
}
