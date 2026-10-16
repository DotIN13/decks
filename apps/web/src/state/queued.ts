import { createSignal } from "solid-js";
import type { ServerMessage } from "@decks/protocol";

/**
 * What you queued for each agent with Ctrl+Enter, as the server holds it (`DeckAgent.queueMine`):
 * the server's copy is the one record, so it survives a reload and shows on every device.
 */
type Queued = { items: Array<{ id: string; text: string }>; held: boolean };
const [queuedByAgent, setQueuedByAgent] = createSignal<Record<string, Queued>>({});

export function queuedFor(agentId: string | undefined): Queued | undefined {
	return agentId ? queuedByAgent()[agentId] : undefined;
}

export function receiveQueued(message: Extract<ServerMessage, { type: "agent.queued" }>): void {
	setQueuedByAgent((was) => ({ ...was, [message.agentId]: { items: message.items, held: message.held } }));
}
