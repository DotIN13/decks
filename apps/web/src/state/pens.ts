import { rebase } from "../connections/connection.ts";
import { createSignal } from "solid-js";
import type { ServerMessage } from "@decks/protocol";
import { applyEdits } from "@decks/pen";
import { send } from "./socket.ts";
import { wholeFolder } from "./whole-folder.ts";

/**
 * Each chat's stage drawing, from `canvas.pen` (`stage/pens.ts` on the server).
 *
 * A signal of whole documents rather than a field of the deck store: a drawing is replaced whole
 * on every change and read whole by the renderer, so a store's per-field proxies would be work
 * nobody reads. Keyed by agent, because the stage — and so its drawing — is per chat.
 */
export type StagePen = Omit<Extract<ServerMessage, { type: "stage.pen" }>, "type" | "agentId">;

const [pens, setPens] = createSignal<Record<string, StagePen>>({});

export { pens };

const folderOf = (base: string) => wholeFolder(rebase(base), location.href);

export function receivePen(message: Extract<ServerMessage, { type: "stage.pen" }>): void {
	const { type: _type, agentId, ...given } = message;
	// The folder image fills are read against: under this tab's prefix, and whole (`whole-folder.ts`).
	const pen = { ...given, base: folderOf(given.base) };
	const known = pens()[agentId];
	if (known && known.rev === pen.rev && known.stage === pen.stage) return;
	setPens({ ...pens(), [agentId]: pen });
}

/**
 * What changed in a drawing: applied to the copy held when it is the revision the edits are from,
 * as a new document (the renderer reads whole documents). Any other revision, or edits that do not
 * apply, and the whole drawing is asked for again.
 */
export function receivePenDelta(message: Extract<ServerMessage, { type: "stage.pen.delta" }>): void {
	const known = pens()[message.agentId];
	if (!known || known.stage !== message.stage || known.rev !== message.from) {
		if (known?.rev !== message.rev) send({ type: "stage.pen.get", agentId: message.agentId });
		return;
	}
	try {
		const doc = applyEdits(known.doc, message.edits);
		lastEdits.set(message.agentId, { stage: message.stage, from: message.from, rev: message.rev, edits: message.edits });
		setPens({ ...pens(), [message.agentId]: { ...known, doc, rev: message.rev, base: folderOf(message.base), error: undefined } });
	} catch {
		send({ type: "stage.pen.get", agentId: message.agentId });
	}
}

/**
 * The edits that made each drawing's latest revision, for the stage's engine to apply in place of the
 * whole drawing (`stage/engine.ts`). Only ever the last: an engine further behind takes the drawing whole.
 */
const lastEdits = new Map<string, { stage: string; from: number; rev: number; edits: Extract<ServerMessage, { type: "stage.pen.delta" }>["edits"] }>();
export function editsTo(agentId: string, stage: string, rev: number) {
	const last = lastEdits.get(agentId);
	return last && last.stage === stage && last.rev === rev ? last : undefined;
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
