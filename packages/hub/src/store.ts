import type { PenDocument, PenEdit } from "@decks/pen";
import type { HarnessApp, Role, SyncCanvas, SyncFile } from "@decks/sync-protocol";

/**
 * Who is asking: a person, and the harness they are asking through when it is one. How they proved
 * it (a session cookie, a harness's key) is the server's business; the hub only reads this.
 */
export interface Who {
	user: { id: string; name: string; email?: string };
	harness?: { id: string; name: string };
}

/** What a stored file became: its version, whether it is now the current one, and its hash. */
export interface Stored {
	version: number;
	current: boolean;
	hash: string;
}

/**
 * Where a sharing service keeps canvases, their history and their files. Decks Studio keeps them in
 * SQLite and a blob folder; `MemoryStore` keeps them in memory; anything else fits by implementing
 * these calls. Every call is synchronous: a store that talks to a database over the network keeps a
 * cache in front of it, as Studio keeps open drawings in memory.
 *
 * Who may do what is the store's too, through `role`: the hub asks before every read and write.
 */
export interface HubStore {
	/** What this person may do with this canvas, or nothing when they may not see it. */
	role(user: string, canvas: string): Role | undefined;
	/** Every canvas this person may see: their own, and those shared with them. */
	canvases(user: string): SyncCanvas[];
	/** A new canvas owned by `owner`, in a folder called `name`. */
	createCanvas(owner: string, title: string, name: string, pen?: PenDocument): SyncCanvas;
	/** A canvas with its current drawing. */
	canvas(id: string): (SyncCanvas & { pen: PenDocument }) | undefined;
	/** Its current revision. */
	revOf(id: string): number;
	/** The revisions after `since`, in order, or nothing when the log no longer reaches back that far. */
	changesSince(id: string, since: number): { rev: number; edits: unknown[] }[] | undefined;
	/** Keep a new drawing and the edits that made it, by `by`; the new revision. */
	commitCanvas(id: string, pen: PenDocument, edits: PenEdit[], by: string): number;
	/** A canvas's files, by their path in its folder (`boards/a.html`). */
	canvasFiles(id: string): SyncFile[];
	canvasFile(id: string, path: string): SyncFile | undefined;
	/** Keep a file's bytes; `base` is the version the writer replaced, and a stale one is kept as a version only. */
	putCanvasFile(id: string, path: string, bytes: Uint8Array, base: number | undefined, by: string): Stored;
	/** Remove a file, unless it changed since `base`. */
	removeCanvasFile(id: string, path: string, base?: number): boolean;
	/** Whether this person may read these bytes: a file of a canvas they may see has, or had, them. */
	mayReadBlob(user: string, hash: string): boolean;
	blob(hash: string): Uint8Array | undefined;
	/** What a harness says it serves. Optional: a service with no apps leaves it out, and the route answers 404. */
	setInventory?(harness: string, apps: HarnessApp[]): void;
}
