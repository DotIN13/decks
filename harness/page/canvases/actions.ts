import { createSignal } from "solid-js";
import { act } from "../state/decks.ts";
import { moveTo, stageOf } from "../state/canvases.ts";
import { state } from "../state/deck.ts";
import { call, warnIfFailed } from "../state/line.ts";
import { notice } from "../state/notices.ts";

// What the person does to canvases: make one, open one (move the conversation
// there), copy a friend's, rename and delete; and whether the manager is open.

const [stagesOpen, setStagesOpen] = createSignal(false);
export { stagesOpen, setStagesOpen };

/** Move a conversation to a canvas: its home becomes that canvas, and the screen goes with it. */
export function moveConversation(agentId: string | undefined, name: string): void {
	if (!agentId || stageOf(agentId)?.name === name) return;
	void moveTo(agentId, name, async () => {
		if ((await act("agent.update", { agent: agentId, change: { canvas: name } })) === undefined) throw new Error(`not moved to ${name}`);
	}).catch(() => undefined);
}

export const openCanvas = (name: string) => moveConversation(state.focused, name);

/** A new canvas, made the home of the conversation on screen. */
export function newCanvas(title = "Untitled"): void {
	const agentId = state.focused;
	if (!agentId) return;
	void act<{ name: string }>("canvas.create", { title }).then((made) => made && act("agent.update", { agent: agentId, change: { canvas: made.name } }));
}

/** Your own copy of a canvas shared with you to view, made the conversation's home. */
export function copyShared(name: string): void {
	const agentId = state.focused;
	void act<{ name: string; title: string }>("canvas.copy", { canvas: name }).then((made) => {
		if (!made) return;
		setStagesOpen(false);
		notice("info", `${made.title} is your own copy: change it as you like. It never changes theirs.`);
		if (agentId) void act("agent.update", { agent: agentId, change: { canvas: made.name } });
	});
}

export const renameCanvas = (name: string, title: string) => void call("canvas.update", { canvas: name, title }).then(warnIfFailed);
export const deleteCanvas = (name: string) => void call("canvas.delete", { canvas: name }).then(warnIfFailed);
