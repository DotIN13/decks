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

/**
 * The names of the person's edits a drawing says it has (`made`), with those of the drawings before it
 * that nobody may have read yet: the socket hands its messages over once a frame, in one batch, so the
 * canvas reads only the last of several drawings that came together, and the names on the others were
 * lost with them; an edit whose name was lost stayed on top of the server's drawings for six seconds,
 * putting back where it had left things after later ones landed. The canvas hears each name once and
 * passes over names it has heard, so the recent ones are kept rather than only the newest.
 */
const KEEP_MADE = 64;
const madeSince = (known: StagePen | undefined, made: readonly string[] | undefined, stage: string): string[] | undefined => {
	const kept = known && known.stage === stage ? [...(known.made ?? []), ...(made ?? [])].slice(-KEEP_MADE) : made ? [...made] : undefined;
	return kept?.length ? kept : undefined;
};

export function receivePen(message: Extract<ServerMessage, { type: "stage.pen" }>): void {
	const { type: _type, agentId, ...given } = message;
	// A drawing said to no agent is for a canvas frame following the canvas (`App.publishPen`).
	if (!agentId) return;
	const known = pens()[agentId];
	if (known && known.rev === given.rev && known.stage === given.stage) return;
	// The folder image fills are read against is a path on the backend, so it goes under this tab's prefix.
	const made = madeSince(known, given.made, given.stage);
	const { made: _made, ...rest } = given;
	setPens({ ...pens(), [agentId]: { ...rest, base: rebase(given.base), ...(made ? { made } : {}) } });
}

/**
 * What changed in a drawing: applied to the copy held when it is the revision the edits are from,
 * as a new document (the renderer reads whole documents) that shares every item the edits did not
 * reach (`editDocument`), and kept with it, so the stage's engines apply the same edits rather than
 * comparing the two drawings. Any other revision, or edits that do not apply, and the whole drawing
 * is asked for again.
 */
export function receivePenDelta(message: Extract<ServerMessage, { type: "stage.pen.delta" }>): void {
	if (!message.agentId) return;
	const known = pens()[message.agentId];
	if (!known || known.stage !== message.stage || known.rev !== message.from) {
		if (known?.rev !== message.rev) send({ type: "stage.pen.get", agentId: message.agentId });
		return;
	}
	try {
		const doc = editDocument(known.doc, message.edits);
		setPens({ ...pens(), [message.agentId]: { ...known, doc, rev: message.rev, base: rebase(message.base), error: undefined, edits: { from: known.doc, edits: message.edits }, made: madeSince(known, message.made, message.stage), by: message.by ?? known.by } });
	} catch {
		send({ type: "stage.pen.get", agentId: message.agentId });
	}
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
