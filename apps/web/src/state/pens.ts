import { rebase } from "../connections/connection.ts";
import { createSignal } from "solid-js";
import type { ServerMessage } from "@decks/protocol";
import { editDocument, type PenDocument, type PenEdit } from "@decks/pen";
import { send } from "./socket.ts";

/**
 * Each chat's stage drawing, from `canvas.pen` (`stage/pens.ts` on the server).
 *
 * A signal of whole documents rather than a field of the deck store: a drawing is replaced whole
 * on every change and read whole by the renderer, so a store's per-field proxies would be work
 * nobody reads. Keyed by agent, because the stage — and so its drawing — is per chat.
 */
export type StagePen = Omit<Extract<ServerMessage, { type: "stage.pen" }>, "type" | "agentId"> & {
	/** What made `doc` from the drawing held before it, when it came as a delta: the stage's engines apply these. */
	edits?: { from: PenDocument; edits: readonly PenEdit[] };
};

const [pens, setPens] = createSignal<Record<string, StagePen>>({});

export { pens };

export function receivePen(message: Extract<ServerMessage, { type: "stage.pen" }>): void {
	const { type: _type, agentId, ...given } = message;
	// The folder image fills are read against is a path on the backend, so it goes under this tab's prefix.
	const pen = { ...given, base: rebase(given.base) };
	const known = pens()[agentId];
	if (known && known.rev === pen.rev && known.stage === pen.stage) return;
	setPens({ ...pens(), [agentId]: pen });
}

/**
 * What changed in a drawing: applied to the copy held when it is the revision the edits are from,
 * as a new document (the renderer reads whole documents) that shares every item the edits did not
 * reach (`editDocument`), and kept with it, so the stage's engines apply the same edits rather than
 * comparing the two drawings. Any other revision, or edits that do not apply, and the whole drawing
 * is asked for again.
 */
export function receivePenDelta(message: Extract<ServerMessage, { type: "stage.pen.delta" }>): void {
	const known = pens()[message.agentId];
	if (!known || known.stage !== message.stage || known.rev !== message.from) {
		if (known?.rev !== message.rev) send({ type: "stage.pen.get", agentId: message.agentId });
		return;
	}
	try {
		const doc = editDocument(known.doc, message.edits);
		setPens({ ...pens(), [message.agentId]: { ...known, doc, rev: message.rev, base: rebase(message.base), error: undefined, edits: { from: known.doc, edits: message.edits }, made: message.made, by: message.by ?? known.by } });
	} catch {
		send({ type: "stage.pen.get", agentId: message.agentId });
	}
}

/**
 * Who hears that one of the person's named edits was not made (`stage.pen.refused`): the canvas showing
 * it ahead of the answer (`canvas/src/drawing.ts`), which then shows the drawing without it.
 */
let refusedTo: ((agentId: string, edit: string) => void) | undefined;
export function onPenRefused(hear: typeof refusedTo): void {
	refusedTo = hear;
}
export function receivePenRefused(message: Extract<ServerMessage, { type: "stage.pen.refused" }>): void {
	refusedTo?.(message.agentId, message.edit);
}

export function forgetPen(agentId: string): void {
	if (!(agentId in pens())) return;
	const { [agentId]: _gone, ...rest } = pens();
	setPens(rest);
}

/** No drawings: a switch to another backend (`connections/switch.ts`). */
export function resetPens(): void {
	setPens({});
}
