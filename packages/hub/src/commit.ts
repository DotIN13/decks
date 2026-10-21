import { diff, type PenDocument, type PenEdit } from "@decks/pen";
import type { Changes, EditsAnswer, Role } from "@decks/sync-protocol";
import { merge } from "./merge.ts";
import type { HubStore } from "./store.ts";
import type { Live } from "./live.ts";

/** Whether a role may change a canvas. */
export const mayEdit = (role: Role | undefined): boolean => role === "owner" || role === "edit";

/**
 * Edits from a page or a harness, made against revision `base`, onto the canvas as it is now. They
 * are merged item by item (`merge`), kept as one revision, and sent to everyone watching.
 *
 * The log holds what happened, not what was asked: when every edit fitted, that is the edits as
 * merged; when some were adjusted or dropped, it is worked out again from the two drawings. Edits
 * that set what was already there change nothing and make no revision.
 *
 * A caller that names itself (`client`) keeps its own copy and is not sent the drawing back.
 */
export function commitEdits(store: HubStore, live: Live | undefined, id: string, edits: readonly PenEdit[], by: string, client?: string): EditsAnswer {
	const current = store.canvas(id);
	if (!current) throw new Error(`No canvas ${id}.`);
	const merged = merge(current.pen, edits as PenEdit[]);
	const happened = merged.adjusted || merged.dropped.length ? diff(current.pen, merged.doc) : changesNothing(current.pen, merged.edits) ? [] : merged.edits;
	const rev = happened.length ? store.commitCanvas(id, merged.doc, happened, by) : current.rev;
	if (happened.length) live?.canvasChanged({ id, rev, base: current.rev, by, ...(client ? { client } : {}), changes: happened });
	return {
		rev,
		base: current.rev,
		applied: merged.applied,
		adjusted: merged.adjusted,
		dropped: merged.dropped.length,
		changes: happened as EditsAnswer["changes"],
		...(client ? {} : { pen: merged.doc as unknown as Record<string, unknown> }),
	};
}

/** `changes?since=N`: the revisions after N, or `tooOld` when the log no longer reaches back to N. */
export function changesSince(store: HubStore, id: string, since: number): Changes {
	const got = store.changesSince(id, since);
	const rev = store.revOf(id);
	return got ? { rev, changes: got.map((c) => c.edits as Changes extends { changes: infer C } ? C extends (infer R)[] ? R : never : never) } : { rev, tooOld: true };
}

/** Whether edits only set fields and items' fields to what they already are: then nothing happened. */
export function changesNothing(doc: PenDocument, edits: readonly PenEdit[]): boolean {
	if (!edits.every((e) => e.op === "set" || e.op === "meta")) return false;
	const items = new Map<string, Record<string, unknown>>();
	const visit = (list: readonly Record<string, unknown>[]) => {
		for (const n of list) {
			items.set(String(n.id), n);
			if (Array.isArray(n.children)) visit(n.children as Record<string, unknown>[]);
		}
	};
	visit(doc.children as unknown as Record<string, unknown>[]);
	const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
	return edits.every((e) => {
		if (e.op === "meta") return same((doc as unknown as Record<string, unknown>)[e.key], e.value);
		if (e.op !== "set" || e.key === "children") return false;
		const item = items.get(e.id);
		return item !== undefined && same(item[e.key], e.value);
	});
}
