import { createSignal } from "solid-js";
import type { ServerMessage } from "@decks/protocol";

/**
 * Each chat's stage drawing, from `stage.pen` (`stage/pens.ts` on the server).
 *
 * A signal of whole documents rather than a field of the deck store: a drawing is replaced whole
 * on every change and read whole by the renderer, so a store's per-field proxies would be work
 * nobody reads. Keyed by agent, because the stage — and so its drawing — is per chat.
 */
export type StagePen = Omit<Extract<ServerMessage, { type: "stage.pen" }>, "type" | "agentId">;

const [pens, setPens] = createSignal<Record<string, StagePen>>({});

export { pens };

export function receivePen(message: Extract<ServerMessage, { type: "stage.pen" }>): void {
	const { type: _type, agentId, ...pen } = message;
	const known = pens()[agentId];
	if (known && known.rev === pen.rev && known.stage === pen.stage) return;
	setPens({ ...pens(), [agentId]: pen });
}

export function forgetPen(agentId: string): void {
	if (!(agentId in pens())) return;
	const { [agentId]: _gone, ...rest } = pens();
	setPens(rest);
}
