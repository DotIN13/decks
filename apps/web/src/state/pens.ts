import { rebase } from "../connections/connection.ts";
import { createSignal } from "solid-js";
import type { ServerMessage } from "@decks/protocol";
import { editDocument, type PenDocument, type PenEdit } from "@decks/pen";
import { send } from "./socket.ts";

/**
 * The drawings this page holds, by canvas: what `canvas.changed` says. The page watches the canvas
 * of the agent it is on (`watchCanvas`), gets it whole, and keeps it current from the edits every
 * change carries; an edit that does not follow what is held asks for the whole again.
 */
export type StagePen = {
	stage: string;
	rev: number;
	doc: PenDocument;
	base: string;
	error?: string;
	made?: string[];
	by?: string;
	edits?: { from: PenDocument; edits: readonly PenEdit[] };
};

const [pens, setPens] = createSignal<Record<string, StagePen>>({});

export { pens };

const KEEP_MADE = 64;
const madeSince = (known: StagePen | undefined, made: readonly string[] | undefined): string[] | undefined => {
	const kept = known ? [...(known.made ?? []), ...(made ?? [])].slice(-KEEP_MADE) : made ? [...made] : undefined;
	return kept?.length ? kept : undefined;
};

let watched: string | undefined;

/** Hear a canvas: whole first, then every change. The one before is let go. */
export function watchCanvas(canvas: string | undefined): void {
	if (canvas === watched) return;
	if (watched) send({ type: "canvas.unwatch", canvas: watched });
	watched = canvas;
	if (canvas) send({ type: "canvas.watch", canvas, whole: true });
}

/** Ask for the drawing whole again: after a reconnect, or an edit that did not follow. */
export function rewatch(canvas?: string): void {
	const name = canvas ?? watched;
	if (name) send({ type: "canvas.watch", canvas: name, whole: true });
}

export function receiveCanvasChanged(message: Extract<ServerMessage, { type: "canvas.changed" }>): void {
	const known = pens()[message.canvas];
	if (message.doc) {
		if (known && known.rev === message.rev) return;
		setPens({ ...pens(), [message.canvas]: { stage: message.canvas, rev: message.rev, doc: message.doc, base: rebase(message.base), ...(message.error ? { error: message.error } : {}), ...(madeSince(known, message.made) ? { made: madeSince(known, message.made) } : {}), ...(message.by ? { by: message.by } : {}) } });
		return;
	}
	if (!message.edits) return;
	if (!known || known.rev !== message.from) {
		if (known?.rev !== message.rev && message.canvas === watched) rewatch(message.canvas);
		return;
	}
	try {
		const doc = editDocument(known.doc, message.edits);
		setPens({ ...pens(), [message.canvas]: { ...known, doc, rev: message.rev, base: rebase(message.base), error: undefined, edits: { from: known.doc, edits: message.edits }, made: madeSince(known, message.made), by: message.by ?? known.by } });
	} catch {
		rewatch(message.canvas);
	}
}

export function resetPens(): void {
	setPens({});
	watched = undefined;
}
