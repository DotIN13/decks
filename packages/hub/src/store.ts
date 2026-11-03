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

/** A value, or a promise of it: what every store call may answer. */
export type Maybe<T> = T | Promise<T>;

/** `commitCanvas` refused: the canvas moved past the revision the edits were merged onto. The hub merges again. */
export class Stale extends Error {
	constructor(readonly canvas: string, readonly onto: number, readonly now: number) {
		super(`Canvas ${canvas} is at revision ${now}, not ${onto}.`);
	}
}

/** What a stored file became: its version, whether it is now the current one, and its hash. */
export interface Stored {
	version: number;
	current: boolean;
	hash: string;
}

/**
 * Where a sharing service keeps canvases, their history and their files. Decks Studio keeps them in
 * SQLite and a blob store; `MemoryStore` keeps them in memory; anything else fits by implementing
 * these calls. Every call may answer its value or a promise of it (`Maybe`): a store over SQLite or
 * memory answers at once, one over a database on the network or a bucket answers later, and the hub
 * awaits either. `Live` asks `role` for every socket on every message, so a store over a network
 * answers that one from a cache it keeps current (Studio's Postgres store does).
 *
 * Who may do what is the store's too, through `role`: the hub asks before every read and write.
 */
export interface HubStore {
	/** What this person may do with this canvas, or nothing when they may not see it. */
	role(user: string, canvas: string): Maybe<Role | undefined>;
	/** Every canvas this person may see: their own, and those shared with them. */
	canvases(user: string): Maybe<SyncCanvas[]>;
	/** A new canvas owned by `owner`, in a folder called `name`. */
	createCanvas(owner: string, title: string, name: string, pen?: PenDocument): Maybe<SyncCanvas>;
	/** A canvas with its current drawing. */
	canvas(id: string): Maybe<(SyncCanvas & { pen: PenDocument }) | undefined>;
	/** Its current revision. */
	revOf(id: string): Maybe<number>;
	/** The revisions after `since`, in order, or nothing when the log no longer reaches back that far. */
	changesSince(id: string, since: number): Maybe<{ rev: number; edits: unknown[] }[] | undefined>;
	/**
	 * Keep a new drawing and the edits that made it, by `by`; the new revision. `onto` is the revision
	 * the caller read and merged onto: a store that finds the canvas past it throws `Stale`, and the hub
	 * reads and merges again, so two processes editing one canvas never keep a drawing made on an old one.
	 */
	commitCanvas(id: string, pen: PenDocument, edits: PenEdit[], by: string, onto?: number): Maybe<number>;
	/** A canvas's files, by their path in its folder (`boards/a.html`). */
	canvasFiles(id: string): Maybe<SyncFile[]>;
	canvasFile(id: string, path: string): Maybe<SyncFile | undefined>;
	/** Keep a file's bytes; `base` is the version the writer replaced, and a stale one is kept as a version only. */
	putCanvasFile(id: string, path: string, bytes: Uint8Array, base: number | undefined, by: string): Maybe<Stored>;
	/** Remove a file, unless it changed since `base`. */
	removeCanvasFile(id: string, path: string, base?: number): Maybe<boolean>;
	/** Whether this person may read these bytes: a file of a canvas they may see has, or had, them. */
	mayReadBlob(user: string, hash: string): Maybe<boolean>;
	blob(hash: string): Maybe<Uint8Array | undefined>;
	/** What a harness says it serves. Optional: a service with no apps leaves it out, and the route answers 404. */
	setInventory?(harness: string, apps: HarnessApp[]): Maybe<void>;
}
