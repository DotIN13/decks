import { diff, type PenDocument, type PenEdit } from "@decks/pen";
import type { Changes, EditsAnswer, Role } from "@decks/sync-protocol";
import { merge } from "./merge.ts";
import { Stale, type HubStore } from "./store.ts";
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
export function commitEdits(store: HubStore, live: Live | undefined, id: string, edits: readonly PenEdit[], by: string, client?: string): Promise<EditsAnswer> {
	// One push of a canvas at a time in this process (the store answering later would let two interleave between the read and the write); `Stale` covers another process.
	const previous = inFlight.get(id) ?? Promise.resolve();
	const mine = previous.then(() => commitNow(store, live, id, edits, by, client));
	inFlight.set(id, mine.then(() => undefined, () => undefined));
	void mine.finally(() => inFlight.get(id) === mine && inFlight.delete(id));
	return mine;
}

const inFlight = new Map<string, Promise<unknown>>();

async function commitNow(store: HubStore, live: Live | undefined, id: string, edits: readonly PenEdit[], by: string, client?: string): Promise<EditsAnswer> {
	let current = await store.canvas(id);
	if (!current) throw new Error(`No canvas ${id}.`);
	let merged = merge(current.pen, edits as PenEdit[]);
	let happened = merged.adjusted || merged.dropped.length ? diff(current.pen, merged.doc) : changesNothing(current.pen, merged.edits) ? [] : merged.edits;
	let rev = current.rev;
	for (let attempt = 0; happened.length; attempt++) {
		try {
			rev = await store.commitCanvas(id, merged.doc, happened, by, current.rev);
			break;
		} catch (error) {
			// Another process kept a revision meanwhile: merge onto what the canvas is now, a few times.
			if (!(error instanceof Stale) || attempt >= 5) throw error;
			current = (await store.canvas(id))!;
			merged = merge(current.pen, edits as PenEdit[]);
			happened = merged.adjusted || merged.dropped.length ? diff(current.pen, merged.doc) : changesNothing(current.pen, merged.edits) ? [] : merged.edits;
			rev = current.rev;
		}
	}
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
export async function changesSince(store: HubStore, id: string, since: number): Promise<Changes> {
	const got = await store.changesSince(id, since);
	const rev = await store.revOf(id);
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
