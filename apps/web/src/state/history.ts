import { PAGE, prepend } from "../chat/history-page.ts";
import { scratch } from "./agent.ts";
import { state, setState } from "./deck.ts";
import { send, started } from "./socket.ts";

/**
 * The browser's window over a conversation, and the server's copy behind it.
 *
 * A history is asked for when a chat is **shown** — opened, or mirrored on a board — rather
 * than greeted: the greeting used to carry every chat's, 8.2 MB on the live deck, with the
 * one on screen arriving last. Two flags on the agent's scratch record keep that from being
 * asked twice, and they are not reactive because nothing renders from them.
 *
 * Reaching further back is the other half. The column owns the window over what is held;
 * the server owns everything older (`agents/store.ts`), and this is the seam between them:
 * a page asked for by its first row's id, and a promise that resolves with **how many rows
 * arrived** — which is what the column uses to hold the reader's place while it grows above
 * them.
 *
 * The map of waiting readers lives here because this is what mints the request. That is the
 * rule for a registry like it: it belongs to the module that makes the promise, not to the
 * handler that answers it.
 */

/** Readers waiting on a page of scrollback, keyed by the row they asked from. */
const waiting = new Map<string, (added: number) => void>();

/**
 * Ask for a conversation's history, once per connection.
 *
 * The flags are on the scratch record rather than in store state, so a reconnect clears
 * them (`scratch.forgetAsked`) and everything else on that record survives — the view you
 * parked, the state an agent was last in.
 */
export function ensureHistory(agentId: string | undefined): void {
	if (!agentId || !started()) return;
	const held = scratch.of(agentId);
	if (held.historyHeld || held.historyAsked) return;
	held.historyAsked = true;
	send({ type: "chat.open", agentId });
}

/**
 * Reach back past what the browser holds (`chat/history-page.ts`).
 *
 * Resolves with how many rows arrived, and with zero for every case where nothing will:
 * an empty conversation, a server that has already said there is nothing older, a request
 * already in flight for this cursor, or an answer that never comes. A promise that resolves
 * with nothing is what lets the column try again rather than deciding it has reached the
 * beginning.
 */
export function loadEarlier(agentId: string): Promise<number> {
	const held = state.agents[agentId]?.transcript ?? [];
	const before = held[0]?.id;
	if (!before || state.agents[agentId]?.moreHistory === false) return Promise.resolve(0);
	if (waiting.has(before)) return Promise.resolve(0);
	return new Promise<number>((resolve) => {
		waiting.set(before, resolve);
		send({ type: "chat.earlier", agentId, before, limit: PAGE });
		/*
		 * A dropped socket must not leave the column unable to ask again. Ten seconds is far
		 * longer than a read of a log file and short enough that a reader who has given up
		 * scrolling has not yet come back.
		 */
		setTimeout(() => {
			if (waiting.delete(before)) resolve(0);
		}, 10_000);
	});
}

/**
 * A page has landed: whoever asked for it wants the count.
 *
 * Called from the frame switch, which is the only thing that sees the answer arrive.
 */
export function resolveEarlier(before: string, added: number): void {
	const resolve = waiting.get(before);
	if (!resolve) return;
	waiting.delete(before);
	resolve(added);
}
