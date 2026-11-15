import { call, warnIfFailed } from "../state/line.ts";
import { canvasOf } from "../state/canvases.ts";
import { setState, state } from "../state/deck.ts";
import { ensureHistory } from "../state/history.ts";
import { keepFocus } from "../state/focus.ts";
import { setDraft, setUnread } from "../state/ui.ts";
import type { AgentMode, ThinkingLevel } from "../state/types/index.ts";

// What the person does to agents: start one, open its conversation, close it,
// and change what it is called, its tags, workspace, mode and model.

/** Open an agent's conversation, as a click on its row does. */
export function focusAgent(id: string): void {
	if (state.focused === id) return;
	setState("focused", id);
	setUnread(id, 0);
	ensureHistory(id);
	setDraft(undefined);
	keepFocus(id);
	void call("chat.focus", { agent: id });
}

/** Start an agent beside the one on screen, on its canvas, and open it. */
export async function newAgent(spec: { kind?: string; workspace?: string }): Promise<void> {
	const canvas = canvasOf(state.focused)?.name;
	const answer = warnIfFailed(await call<{ id: string }>("agent.create", { ...spec, ...(state.focused ? { near: state.focused } : {}), ...(canvas ? { canvas } : {}) }));
	if (answer.ok && answer.value?.id) focusAgent(answer.value.id);
}

export const closeAgent = (id: string) => void call("agent.delete", { agent: id }).then(warnIfFailed);

/** Change one agent's record, as the person: name, tags, workspace, mode, model or thinking. */
export function changeAgent(id: string, change: Record<string, unknown>): void {
	void call("agent.update", { agent: id, change }).then(warnIfFailed);
}

export const renameAgent = (id: string, name: string) => changeAgent(id, { name });
export const tagAgent = (id: string, tags: string[]) => changeAgent(id, { tags });
export const moveAgentTo = (id: string, workspace: string | null) => changeAgent(id, { workspace });
export const setAgentMode = (id: string, mode: AgentMode) => changeAgent(id, { mode });
export const setAgentThinking = (id: string, thinking: ThinkingLevel) => changeAgent(id, { thinking });
export const setAgentModel = (id: string, provider: string, model: string, thinking?: ThinkingLevel) => changeAgent(id, { model: provider ? `${provider}/${model}` : model, ...(thinking ? { thinking } : {}) });

export const abortAgent = (id: string) => void call("chat.abort", { agent: id });

/** Answer a question the agent's runtime put up. */
export const answerAgent = (id: string, question: string, answer: unknown) => void call("chat.answer", { agent: id, question, answer });

/** The person's own queue for an agent: add, remove, send now, or release. */
export const queueAction = (id: string, action: "add" | "remove" | "send" | "release", item?: string) => void call("chat.queue", { agent: id, action, ...(item ? { item } : {}) });
