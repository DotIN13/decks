import { createSignal } from "solid-js";

/**
 * What you queued for each agent with Ctrl+Enter, as the agent's session holds it
 * (`harness/sessions/queue.ts`): that copy is the one record, so it survives a reload and shows on every device.
 */
type Queued = { items: Array<{ id: string; text: string }>; held: boolean };
const [queuedByAgent, setQueuedByAgent] = createSignal<Record<string, Queued>>({});

export function queuedFor(agentId: string | undefined): Queued | undefined {
	return agentId ? queuedByAgent()[agentId] : undefined;
}

export function setQueued(agentId: string, queued: Queued): void {
	setQueuedByAgent((was) => ({ ...was, [agentId]: { items: queued.items, held: queued.held } }));
}
