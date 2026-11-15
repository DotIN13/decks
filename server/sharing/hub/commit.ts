import { diff, type PenDocument, type PenEdit } from "@decks/pen";
import type { Live } from "./live.ts";
import { changesNothing, merge } from "./merge.ts";
import { Stale, type HubStore } from "./store.ts";

// Edits made against an older revision, onto the canvas as it is now. The log
// keeps what happened: the edits as merged, or the diff when some had to change.

export type EditsAnswer = { rev: number; base: number; applied: number; adjusted: number; dropped: number; changes: PenEdit[]; pen?: PenDocument };

/** Merge, keep as one revision, tell everyone. A caller that names itself (client) is not sent the drawing. */
export function commitEdits(hub: HubStore, live: Live | undefined, id: string, edits: readonly PenEdit[], by: string, client?: string): EditsAnswer {
	for (let attempt = 0; ; attempt++) {
		const current = hub.canvas(id);
		if (!current) throw new Error(`No canvas ${id}.`);
		const { merged, made } = happened(current.pen, edits);
		let rev = current.rev;
		try {
			if (made.length) rev = hub.commitCanvas(id, merged.doc, made, current.rev);
		} catch (error) {
			if (error instanceof Stale && attempt < 5) continue;
			throw error;
		}
		if (made.length) live?.canvasChanged({ id, rev, base: current.rev, by, ...(client ? { client } : {}), changes: made });
		const answer = { rev, base: current.rev, applied: merged.applied, adjusted: merged.adjusted, dropped: merged.dropped.length, changes: made };
		return client ? answer : { ...answer, pen: merged.doc };
	}
}

function happened(pen: PenDocument, edits: readonly PenEdit[]) {
	const merged = merge(pen, edits);
	const made = merged.adjusted || merged.dropped.length ? diff(pen, merged.doc) : changesNothing(pen, merged.edits) ? [] : merged.edits;
	return { merged, made };
}
