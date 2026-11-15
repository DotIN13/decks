import { PAGE, prepend } from "../chat/index.ts";
import { scratch } from "./agent.ts";
import { ensureAgent, setState, state } from "./deck.ts";
import { call, started } from "./line.ts";
import type { ChatItem } from "./types/index.ts";
import { releasePages } from "./ui.ts";

// A conversation's history, read by chat.list when it is first shown and paged
// back with before and limit. A full page means there may be more.

/** Read an agent's conversation once, the first time it is wanted. */
export function ensureHistory(agentId: string | undefined): void {
	if (!agentId || !started()) return;
	const held = scratch.of(agentId);
	if (held.historyHeld || held.historyAsked) return;
	held.historyAsked = true;
	void call<ChatItem[]>("chat.list", { agent: agentId, limit: PAGE }).then((answer) => {
		held.historyAsked = false;
		if (!answer.ok) return;
		ensureAgent(agentId);
		setState("agents", agentId, "transcript", answer.value);
		setState("agents", agentId, "moreHistory", answer.value.length >= PAGE);
		held.historyHeld = true;
		if (agentId === state.focused) releasePages();
	});
}

/** Read a held conversation again, as after a rewind: the latest page replaces what is held. */
export async function reread(agentId: string): Promise<void> {
	if (!scratch.of(agentId).historyHeld) return;
	const answer = await call<ChatItem[]>("chat.list", { agent: agentId, limit: PAGE });
	if (!answer.ok) return;
	setState("agents", agentId, "transcript", answer.value);
	setState("agents", agentId, "moreHistory", answer.value.length >= PAGE);
}

/** One page further back; answers how many entries it added. */
export async function loadEarlier(agentId: string): Promise<number> {
	const before = state.agents[agentId]?.transcript[0]?.id;
	if (!before || state.agents[agentId]?.moreHistory === false) return 0;
	const answer = await call<ChatItem[]>("chat.list", { agent: agentId, before, limit: PAGE });
	if (!answer.ok) return 0;
	setState("agents", agentId, "transcript", (held) => prepend(answer.value, held));
	setState("agents", agentId, "moreHistory", answer.value.length >= PAGE);
	return answer.value.length;
}

/** Nothing is kept between pages any more; kept for the callers that reset on a switch. */
export function resetHistory(): void {}
