import { hashOf } from "../hash.ts";
import { emptyDocument, type PenDocument, type PenEdit } from "@decks/pen";

// Studio's side of sync, kept in memory: people's names and roles, canvases and their log,
// files and blobs, each harness's apps. Studio's own repo brings the same calls on a database.

export type Role = "owner" | "edit" | "view";
export type SyncCanvas = { id: string; name: string; title: string; rev: number; role: Role; owner: string; ownerName?: string };
export type SyncFile = { path: string; version: number; hash: string; size: number; at: number };
export type Stored = { version: number; current: boolean; hash: string };
export type App = { name: string; title: string; kind: string };
export type Logged = { rev: number; edits: PenEdit[] };

/** Who asks: a person, and the harness they ask through. */
export type Who = { user: { id: string; name: string; email?: string }; harness?: { id: string; name: string } };

/** What the hub's routes, commits and live socket need of a store. Studio implements it on a database. */
export interface HubStore {
	name(user: string, name: string): void;
	share(canvas: string, user: string, role: Exclude<Role, "owner">): void;
	role(user: string, canvas: string): Role | undefined;
	canvases(user: string): SyncCanvas[];
	createCanvas(owner: string, title: string, name: string, pen?: PenDocument): SyncCanvas;
	canvas(id: string): (SyncCanvas & { pen: PenDocument }) | undefined;
	/** The revisions after since, or undefined when the log no longer reaches back. */
	changesSince(id: string, since: number): Logged[] | undefined;
	/** Throws Stale when the canvas is not at onto. */
	commitCanvas(id: string, pen: PenDocument, edits: PenEdit[], onto: number): number;
	canvasFiles(id: string): SyncFile[];
	putCanvasFile(id: string, path: string, bytes: Uint8Array, base: number | undefined): Stored;
	removeCanvasFile(id: string, path: string, base?: number): boolean;
	blob(user: string, hash: string): Uint8Array | undefined;
	setInventory(harness: string, apps: App[]): void;
	inventory(harness: string): App[] | undefined;
}

/** A commit onto a revision the canvas has moved past. */
export class Stale extends Error {}

type Kept = { canvas: SyncCanvas; pen: PenDocument; log: Logged[]; files: Map<string, SyncFile>; people: Map<string, Role>; hashes: Set<string> };

/** The most revisions the log keeps; older ones come whole. */
export const LOG_MAX = 1000;

export class MemoryHub implements HubStore {
	private readonly kept = new Map<string, Kept>();
	private readonly blobs = new Map<string, Uint8Array>();
	private readonly names = new Map<string, string>();
	private readonly apps = new Map<string, App[]>();
	private next = 1;

	// People: their names and roles
	name(user: string, name: string): void {
		this.names.set(user, name);
	}

	share(canvas: string, user: string, role: Exclude<Role, "owner">): void {
		this.kept.get(canvas)?.people.set(user, role);
	}

	role(user: string, canvas: string): Role | undefined {
		return this.kept.get(canvas)?.people.get(user);
	}

	// Canvases and their log
	canvases(user: string): SyncCanvas[] {
		return [...this.kept.values()].filter((k) => k.people.has(user)).map((k) => ({ ...k.canvas, role: k.people.get(user)! }));
	}

	createCanvas(owner: string, title: string, name: string, pen?: PenDocument): SyncCanvas {
		const id = `c${this.next++}`;
		const canvas: SyncCanvas = { id, name, title, rev: 1, role: "owner", owner, ownerName: this.names.get(owner) ?? owner };
		this.kept.set(id, { canvas, pen: pen ?? emptyDocument(), log: [], files: new Map(), people: new Map([[owner, "owner"]]), hashes: new Set() });
		return { ...canvas };
	}

	canvas(id: string): (SyncCanvas & { pen: PenDocument }) | undefined {
		const k = this.kept.get(id);
		return k && { ...k.canvas, pen: k.pen };
	}

	changesSince(id: string, since: number): Logged[] | undefined {
		const k = this.kept.get(id);
		if (!k) return undefined;
		const oldest = k.log[0]?.rev ?? k.canvas.rev + 1;
		if (since + 1 < oldest && since < k.canvas.rev) return undefined;
		return k.log.filter((c) => c.rev > since);
	}

	commitCanvas(id: string, pen: PenDocument, edits: PenEdit[], onto: number): number {
		const k = this.kept.get(id)!;
		if (onto !== k.canvas.rev) throw new Stale(`Canvas ${id} is at ${k.canvas.rev}, not ${onto}.`);
		k.pen = pen;
		k.canvas.rev += 1;
		k.log.push({ rev: k.canvas.rev, edits });
		if (k.log.length > LOG_MAX) k.log.shift();
		return k.canvas.rev;
	}

	// Files and the bytes behind them
	canvasFiles(id: string): SyncFile[] {
		return [...(this.kept.get(id)?.files.values() ?? [])];
	}

	/** A writer that replaced an older version than the current one is kept, but not current. */
	putCanvasFile(id: string, path: string, bytes: Uint8Array, base: number | undefined): Stored {
		const k = this.kept.get(id)!;
		const hash = hashOf(bytes);
		this.blobs.set(hash, bytes);
		k.hashes.add(hash);
		const was = k.files.get(path);
		const version = (was?.version ?? 0) + 1;
		if (was && base !== undefined && base !== was.version) return { version, current: false, hash };
		k.files.set(path, { path, version, hash, size: bytes.length, at: Date.now() });
		return { version, current: true, hash };
	}

	removeCanvasFile(id: string, path: string, base?: number): boolean {
		const was = this.kept.get(id)?.files.get(path);
		if (!was) return true;
		if (base !== undefined && base !== was.version) return false;
		this.kept.get(id)!.files.delete(path);
		return true;
	}

	/** Bytes a person may read: a file of a canvas they may see has, or had, them. */
	blob(user: string, hash: string): Uint8Array | undefined {
		for (const k of this.kept.values()) {
			if (k.people.has(user) && k.hashes.has(hash)) return this.blobs.get(hash);
		}
		return undefined;
	}

	// Each harness's app list
	setInventory(harness: string, apps: App[]): void {
		this.apps.set(harness, apps);
	}

	inventory(harness: string): App[] | undefined {
		return this.apps.get(harness);
	}
}
