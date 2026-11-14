import { emptyDocument, parse, serialize, type PenDocument } from "@decks/pen";
import type { Store } from "../../kernel/types.ts";

// What the feature keeps in its private store: Studio's address and key, and
// the sync state. The base drawing of each canvas is kept apart, one key each.

export type Link = { url: string; key: string };
export type FileSeen = { version: number; hash: string };
export type CanvasState = { id: string; rev: number; files: Record<string, FileSeen> };
export type SyncState = { user?: string; canvases: Record<string, CanvasState>; said: string[] };

const text = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : undefined);
const bytes = (value: string) => new TextEncoder().encode(value);

export async function readLink(store: Store): Promise<Link | undefined> {
	const got = text(await store.get("link"));
	return got ? (JSON.parse(got) as Link) : undefined;
}

export const writeLink = (store: Store, link: Link) => store.put("link", bytes(JSON.stringify(link)));

/** Forget Studio: the key, the state and every base drawing. */
export async function forget(store: Store): Promise<void> {
	for (const key of await store.keys()) await store.delete(key);
}

export async function readState(store: Store): Promise<SyncState> {
	const got = text(await store.get("state"));
	const state = got ? (JSON.parse(got) as Partial<SyncState>) : {};
	return { canvases: state.canvases ?? {}, said: state.said ?? [], ...(state.user ? { user: state.user } : {}) };
}

export const writeState = (store: Store, state: SyncState) => store.put("state", bytes(JSON.stringify(state)));

/** The last drawing both sides agreed on, or nothing. */
export async function readBase(store: Store, id: string): Promise<PenDocument | undefined> {
	const got = text(await store.get(`base/${id}`));
	return got ? parse(got) : undefined;
}

export const writeBase = (store: Store, id: string, doc: PenDocument) => store.put(`base/${id}`, bytes(serialize(doc)));

export const empty = (): PenDocument => emptyDocument();
