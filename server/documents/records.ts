import { readJson, writeJson } from "../kernel/store.ts";
import type { Store } from "../kernel/types.ts";
import type { Splice } from "./splice.ts";

// What the feature keeps about a document in its store: the typing revisions
// that are not versions, and the changes waiting for review. Rules 5, 6, 8.

export type DocChange = { id: string; by: string; at: number; from: string; to: string; splices: Splice[] };
/** A waiting change, with the document's revision just after it. */
export type Waiting = { change: DocChange; rev: number };

const KEEP_CHANGES = 200;
const KEEP_SKIPPED = 5000;

/** Typing revisions that a later keystroke, before a pause, made not a version. */
export async function skipped(store: Store, path: string): Promise<Set<number>> {
	return new Set(await readJson<number[]>(store, `skipped/${path}`, []));
}

export async function skip(store: Store, path: string, rev: number): Promise<void> {
	const all = [...(await skipped(store, path)), rev].slice(-KEEP_SKIPPED);
	await writeJson(store, `skipped/${path}`, all);
}

export async function loadChanges(store: Store, path: string): Promise<Waiting[]> {
	return readJson<Waiting[]>(store, `changes/${path}`, []);
}

/** The newest waiting changes, the oldest dropped past 200 (taken as accepted). */
export async function saveChanges(store: Store, path: string, changes: Iterable<Waiting>): Promise<void> {
	const list = [...changes].slice(-KEEP_CHANGES);
	if (list.length === 0) await store.delete(`changes/${path}`);
	else await writeJson(store, `changes/${path}`, list);
}
