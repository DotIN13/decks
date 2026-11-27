import { join } from "node:path";
import type { PenEdit } from "@decks/pen";
import { PICTURES, safeCanvasFolder, safeCanvasName, safeSyncPath, secretLooking, type LiveEvent, type SyncCanvas, type SyncFile, type SyncProgress } from "@decks/sync-protocol";
import { Bases } from "./bases.ts";
import { CanvasSync } from "./canvas-sync.ts";
import { FileSync } from "./file-sync.ts";
import { RECHECK_MS } from "./hash-cache.ts";
import { PictureSync } from "./picture-sync.ts";
import { SyncScheduler } from "./scheduler.ts";
import { SyncStore, type SyncOptions } from "./state.ts";
import { StudioTransport, type PresenceMessage } from "./transport.ts";
import { FolderWatch } from "./watch.ts";

// The rules a harness checks what a service sends against, from @decks/sync-protocol.
export { safeCanvasFolder, safeCanvasName, safeSyncPath, secretLooking };
export type { SyncOptions };
export { conflictName, landingFor } from "./file-sync.ts";

/** The backstop: a pass over every canvas this often, besides the targeted ones. */
export const FULL_PASS_MS = 5 * 60_000;

/**
 * Keeps this harness's canvases and Decks Studio in step, once Studio has given it an API key.
 *
 * Nothing else in the harness knows: it goes on reading and writing its folder, and so do its
 * agents, and this watches the same folder from inside the same process.
 *
 * A canvas is a folder that stands alone (`deck/layout.ts`), and it goes to Studio as one bundle:
 * its drawing, pushed as edits (`diff` against the last version both sides agreed on) and merged item
 * by item in Studio; and its files, whole, with versions, by their path in the canvas's folder —
 * its `cards/`, `frames/` and `files/`, the deck's `assets/` and `docs/` files its cards point at
 * (at their deck paths, `assets/…`, `docs/…`), and pictures (`.pictures/…`). Studio keeps them with
 * the canvas, so sharing a canvas shares that bundle and nothing else of this deck.
 *
 * A canvas a friend shared comes down into `shared/canvases/<their name>/<canvas>/`, bundle and all,
 * the deck files mirrored inside it, so its cards read their own copies and never this deck's. If
 * they let you edit it, your changes go back; if only view, it follows theirs. When they stop sharing
 * it, its folder is moved to `.decks/shared-removed/`, never deleted.
 *
 * It works one canvas at a time: a live message about a canvas syncs that canvas (its edits come in
 * the message, or as the changes since this harness's revision; the whole drawing only when Studio's
 * log no longer reaches back), and a change in a canvas's folder syncs that canvas. A file is hashed
 * again only when its size or time changed (`hash-cache.ts`). A full pass over everything runs on
 * connecting and every 5 minutes, as a backstop; every 10 minutes it hashes every file again.
 *
 * What it remembers between runs is in `<deck>/.decks/`: `studio-sync.json` (each canvas's revision
 * and its files' versions), `sync/<canvas id>.pen` (each canvas's drawing as both sides last agreed
 * on, what local edits are worked out against) and `studio-hashes.json` (the hash cache).
 *
 * A canvas is its Studio id, not its folder name (`canvas.json` carries the id with the folder). A
 * folder this state does not know is matched by that id first: renamed, copied from another machine,
 * or found after `.decks/` was lost, it is adopted and its differences merged, never uploaded twice
 * and never overwritten. One with no id whose name Studio already has is adopted the same way. A
 * file both sides have, differently, with no version agreed on, is a conflict: Studio's copy stays
 * current, this one is kept beside it as `<name>.conflict-<when>.<ext>` and goes up like any file,
 * so both are seen everywhere and a person chooses.
 *
 * This class is the front: it builds the parts and runs the passes over them. Each part keeps its
 * own subject and its own fields — `StudioTransport` (every call to Studio and the live socket),
 * `SyncScheduler` (the queue, Studio's waits, the progress), `CanvasSync` (the drawings),
 * `FileSync` (the files), `PictureSync` (the pictures) and `FolderWatch` (the folder) — shares the
 * options and the stored state (`state.ts`), and reaches the others only through what they offer.
 */
export class HarnessSync {
	readonly skipped = new Set<string>();
	readonly conflicts: string[] = [];
	private readonly bases: Bases;
	private readonly store: SyncStore;
	private readonly scheduler: SyncScheduler;
	private readonly transport: StudioTransport;
	private readonly canvas: CanvasSync;
	private readonly files: FileSync;
	private readonly pictures: PictureSync;
	private readonly folders: FolderWatch;
	/** When every file was last hashed whatever the cache said. */
	private checkedAt = 0;

	constructor(private readonly o: SyncOptions) {
		const log = (line: string) => this.log(line);
		this.bases = new Bases(join(o.deck, ".decks", "sync"));
		this.store = new SyncStore(o.deck, o.studio, this.bases);
		// Both passes go through this object, so a wait's resume runs `sync` as a caller sees it.
		this.scheduler = new SyncScheduler({ log, progress: o.progress, hashes: this.store.hashes, skipped: this.skipped, resume: () => void this.sync(), targeted: () => this.targeted() });
		this.transport = new StudioTransport(o, log, this.store, this.bases, this.scheduler);
		this.files = new FileSync(o, log, this.store, this.transport, this.scheduler, this.skipped, this.conflicts);
		this.pictures = new PictureSync(o, log, this.store, this.transport, this.scheduler, this.files);
		this.canvas = new CanvasSync(o, log, this.store, this.bases, this.transport, this.scheduler, this.files, this.pictures);
		this.folders = new FolderWatch(o.deck, this.store, this.scheduler, this.files, this.pictures);
	}

	private log(line: string) {
		(this.o.log ?? ((l) => console.log(`[decks] studio: ${l}`)))(line);
	}

	// ---- what the harness calls ----

	/** Sync now, then on every change on either side, and every 5 minutes besides. */
	async start(): Promise<void> {
		await this.sync();
		this.transport.listen((e) => this.heard(e));
		this.folders.start();
		this.scheduler.every(FULL_PASS_MS, () => this.sync());
	}

	async stop() {
		this.scheduler.halt();
		this.folders.close();
		this.transport.close();
		await this.scheduler.idle();
	}

	/** One pass over everything; passes queue, so two never overlap. */
	sync(): Promise<void> {
		return this.scheduler.queue(() => this.pass());
	}

	/** How far the deck is in step with Studio, as last said. */
	progress(): SyncProgress {
		return this.scheduler.progress();
	}

	/** An edit made on this harness, as its canvas store logged it: sent up at once for a canvas on Studio (`CanvasSync.edited`). */
	edited(name: string, change: { edits: readonly PenEdit[]; by: { kind: string; id?: string } }): void {
		this.canvas.edited(name, change);
	}

	/** Where someone on this harness is on a canvas kept on Studio, said to everyone else on it (`StudioTransport.presence`). */
	presence(name: string, message: PresenceMessage): void {
		this.transport.presence(name, message);
	}

	// ---- passes ----

	/** Everything: every canvas both ways, its files, pictures and the app list. */
	private async pass() {
		this.files.forgetPlan();
		this.scheduler.begin();
		await this.transport.hello();
		this.scheduler.fullDue = false;
		const fresh = Date.now() - this.checkedAt >= RECHECK_MS;
		if (fresh) {
			this.canvas.forgetSeen();
			this.transport.forgetRefusals();
		}
		this.scheduler.pull.clear();
		this.scheduler.dirtyPens.clear();
		this.scheduler.dirtyFiles.clear();
		this.scheduler.dirtyPictures.clear();
		const synced = await this.canvas.syncCanvases();
		await this.syncBundles(synced, fresh);
		await this.transport.tellInventory();
		if (fresh) {
			this.checkedAt = Date.now();
			this.store.hashes.prune();
		}
		this.store.save();
		// A change to a friend's canvas that came down in this pass is seen at once, not on the next full pass.
		this.folders.refresh();
	}

	/** The files and pictures of the canvases a full pass synced, after all their drawings. */
	private async syncBundles(synced: [string, SyncCanvas][], fresh: boolean) {
		/*
		 * Every canvas's drawing first, then every canvas's files, then each canvas's picture, then the
		 * cards' pictures: Studio takes so many files a minute from a harness, so what a person made goes
		 * up before what can be taken again, and the picture Studio's list shows before the cards' (which
		 * a canvas in Studio takes from the harness while one is in reach).
		 */
		const lists = new Map<string, Map<string, SyncFile>>();
		this.files.plan(synced);
		this.scheduler.say({ canvases: { done: 0, total: synced.length } }, true);
		for (const [name, c] of synced) {
			const remote = await this.files.syncCanvasFiles(name, c, fresh);
			this.scheduler.say({ canvases: { done: this.scheduler.told.canvases.done + 1, total: synced.length } });
			if (!remote) continue;
			lists.set(name, remote);
			if (c.role !== "view" && !remote.has(`${PICTURES}/canvas.light.jpg`)) this.pictures.want(name);
		}
		await this.pictures.syncCanvasPictures();
		for (const [name, c] of synced) {
			const s = this.store.state.canvases[name];
			const remote = lists.get(name);
			if (s && remote && c.role !== "view" && !this.scheduler.holding("files")) await this.pictures.syncPictures(name, s.id, remote);
		}
		await this.pictures.syncCanvasPictures();
	}

	/** Only what changed: the canvases Studio named, and those whose folder changed here. */
	private async targeted() {
		if (this.scheduler.fullDue || !this.transport.me) return this.pass();
		this.files.forgetPlan();
		this.scheduler.begin();
		const byId = new Map(Object.entries(this.store.state.canvases).map(([name, s]) => [s.id, name]));
		const pens = new Set(this.scheduler.dirtyPens);
		const files = new Set(this.scheduler.dirtyFiles);
		const pictures = new Set(this.scheduler.dirtyPictures);
		const pulls = new Set(this.scheduler.pull);
		this.scheduler.dirtyPens.clear();
		this.scheduler.dirtyFiles.clear();
		this.scheduler.dirtyPictures.clear();
		this.scheduler.pull.clear();
		for (const id of pulls) {
			const name = byId.get(id);
			if (!name) return this.pass();
			pens.add(name);
		}
		// What was edited here goes up first, as logged: the file is compared only for what that missed.
		for (const name of this.canvas.queued()) {
			const s = this.store.state.canvases[name];
			const c = s && this.canvas.listed(s.id);
			if (!c) return this.pass();
			await this.canvas.pushEdits(name, c);
		}
		for (const name of new Set([...pens, ...files, ...pictures])) {
			const s = this.store.state.canvases[name];
			const c = s && this.canvas.listed(s.id);
			// A canvas Studio has not listed to this harness yet (new here, or just shared): a full pass takes it up.
			if (!c) return this.pass();
			if (pens.has(name)) await this.canvas.syncCanvas(name, c);
			if (files.has(name)) {
				this.files.plan([[name, c]]);
				const remote = await this.files.syncCanvasFiles(name, c, false);
				if (remote && c.role !== "view") await this.pictures.syncPictures(name, s.id, remote);
			} else if (pictures.has(name) && c.role !== "view") await this.pictures.syncPictures(name, s.id);
		}
		await this.pictures.syncCanvasPictures();
		this.store.save();
	}

	/** What a live message asks for: one canvas, its files, or (the list changed) a full pass. */
	private heard(e: LiveEvent) {
		if (e.type === "hello") {
			// Connected again: what was said while away is not known, so everything is looked at.
			this.scheduler.fullDue = true;
			return this.scheduler.soon(50);
		}
		if (e.type === "presence") {
			const name = this.store.nameOf(e.canvas);
			if (name) this.o.presence?.(name, e);
			return;
		}
		if ("by" in e && e.by && e.by === this.transport.me) return;
		switch (e.type) {
			case "canvas": {
				if (!e.id) return;
				this.canvas.heard(e);
				this.scheduler.pull.add(e.id);
				// Applied the moment it arrives: the frames on this harness hear the change as the canvas store writes it.
				return this.scheduler.soon(0);
			}
			case "file": {
				const name = this.store.nameOf(e.canvas);
				if (!name) return;
				this.scheduler.dirtyFiles.add(name);
				return this.scheduler.soon(50);
			}
			case "canvases":
			case "canvas.gone":
				this.scheduler.fullDue = true;
				return this.scheduler.soon(50);
			default:
				return; // Cursors, harnesses and the account's older tree are nothing to sync.
		}
	}
}
