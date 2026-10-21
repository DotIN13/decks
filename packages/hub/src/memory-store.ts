import { createHash } from "node:crypto";
import { emptyDocument, type PenDocument, type PenEdit } from "@decks/pen";
import type { HarnessApp, Role, SyncCanvas, SyncFile } from "@decks/sync-protocol";
import type { HubStore, Stored } from "./store.ts";

interface Kept {
	canvas: SyncCanvas;
	pen: PenDocument;
	log: { rev: number; edits: unknown[] }[];
	files: Map<string, SyncFile>;
	people: Map<string, Role>;
}

/**
 * A `HubStore` in memory: for tests, examples, and a first sharing site before it has a database.
 * Nothing survives a restart. Owners and shares are set with `share`; names of owners with `name`.
 */
export class MemoryStore implements HubStore {
	private readonly kept = new Map<string, Kept>();
	private readonly blobs = new Map<string, Uint8Array>();
	private readonly names = new Map<string, string>();
	readonly inventory = new Map<string, HarnessApp[]>();
	private next = 1;

	/** What to call a person in a friend's `shared/canvases/<owner>/` folder. */
	name(user: string, name: string): void {
		this.names.set(user, name);
	}

	share(canvas: string, user: string, role: Exclude<Role, "owner">): void {
		this.kept.get(canvas)?.people.set(user, role);
	}

	unshare(canvas: string, user: string): void {
		this.kept.get(canvas)?.people.delete(user);
	}

	role(user: string, canvas: string): Role | undefined {
		return this.kept.get(canvas)?.people.get(user);
	}

	canvases(user: string): SyncCanvas[] {
		return [...this.kept.values()].filter((k) => k.people.has(user)).map((k) => ({ ...k.canvas, role: k.people.get(user)! }));
	}

	createCanvas(owner: string, title: string, name: string, pen?: PenDocument): SyncCanvas {
		const id = `c${this.next++}`;
		const canvas: SyncCanvas = { id, name, title, rev: 1, role: "owner", owner, ownerName: this.names.get(owner) ?? owner };
		this.kept.set(id, { canvas, pen: pen ?? emptyDocument(), log: [], files: new Map(), people: new Map([[owner, "owner"]]) });
		return canvas;
	}

	canvas(id: string): (SyncCanvas & { pen: PenDocument }) | undefined {
		const k = this.kept.get(id);
		return k && { ...k.canvas, pen: k.pen };
	}

	revOf(id: string): number {
		return this.kept.get(id)?.canvas.rev ?? 0;
	}

	changesSince(id: string, since: number): { rev: number; edits: unknown[] }[] | undefined {
		const k = this.kept.get(id);
		if (!k) return undefined;
		const oldest = k.log[0]?.rev ?? k.canvas.rev + 1;
		if (since + 1 < oldest && since < k.canvas.rev) return undefined;
		return k.log.filter((c) => c.rev > since);
	}

	commitCanvas(id: string, pen: PenDocument, edits: PenEdit[], _by: string): number {
		const k = this.kept.get(id)!;
		k.pen = pen;
		k.canvas.rev += 1;
		k.log.push({ rev: k.canvas.rev, edits });
		if (k.log.length > 1000) k.log.shift();
		return k.canvas.rev;
	}

	canvasFiles(id: string): SyncFile[] {
		return [...(this.kept.get(id)?.files.values() ?? [])];
	}

	canvasFile(id: string, path: string): SyncFile | undefined {
		return this.kept.get(id)?.files.get(path);
	}

	putCanvasFile(id: string, path: string, bytes: Uint8Array, base: number | undefined, _by: string): Stored {
		const k = this.kept.get(id)!;
		const hash = createHash("sha256").update(bytes).digest("hex");
		this.blobs.set(hash, bytes);
		const was = k.files.get(path);
		const version = (was?.version ?? 0) + 1;
		// A writer that replaced an older version than the current one lost the race: kept, but not current.
		if (was && base !== undefined && base !== was.version) return { version, current: false, hash };
		k.files.set(path, { path, version, hash, size: bytes.length, at: Date.now() });
		return { version, current: true, hash };
	}

	removeCanvasFile(id: string, path: string, base?: number): boolean {
		const k = this.kept.get(id);
		const was = k?.files.get(path);
		if (!k || !was) return true;
		if (base !== undefined && base !== was.version) return false;
		k.files.delete(path);
		return true;
	}

	mayReadBlob(user: string, hash: string): boolean {
		for (const k of this.kept.values()) if (k.people.has(user) && [...k.files.values()].some((f) => f.hash === hash)) return true;
		return false;
	}

	blob(hash: string): Uint8Array | undefined {
		return this.blobs.get(hash);
	}

	setInventory(harness: string, apps: HarnessApp[]): void {
		this.inventory.set(harness, apps);
	}
}
