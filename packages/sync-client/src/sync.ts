import { existsSync, mkdirSync, readdirSync, renameSync, statSync, watch, type FSWatcher } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { applyEdits, diff, parse, serialize, type PenDocument, type PenEdit } from "@decks/pen";
import { canvasFolder, ownerFolderBase, plainSegment, SHARED_CANVASES, sharedName, sharedParts } from "@decks/hub/layout";
import { Bases } from "./bases.ts";
import { SyncScheduler } from "./scheduler.ts";
import { FileSync } from "./file-sync.ts";
import { PictureSync, THUMBS } from "./picture-sync.ts";
import { StudioTransport, type PresenceMessage } from "./transport.ts";
import { RECHECK_MS } from "./hash-cache.ts";
import { cost, folderOf, isShared, readFileSync, SyncStore, writeFileSync, type CanvasState, type SyncOptions } from "./state.ts";

import { LiveEvent, type SyncProgress, MIRRORED_PARTS, PICTURES, safeCanvasFolder, safeCanvasName, safeSyncPath, secretLooking, type SyncCanvas, type SyncFile } from "@decks/sync-protocol";

// The rules a harness checks what a service sends against, from @decks/sync-protocol.
export { safeCanvasFolder, safeCanvasName, safeSyncPath, secretLooking };
export type { SyncOptions };
export { conflictName, landingFor } from "./file-sync.ts";
const MIRRORED: readonly string[] = MIRRORED_PARTS;

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
 * its `boards/`, `frames/` and `files/`, the deck's `assets/` and `docs/` files its boards point at
 * (at their deck paths, `assets/…`, `docs/…`), and pictures (`.pictures/…`). Studio keeps them with
 * the canvas, so sharing a canvas shares that bundle and nothing else of this deck.
 *
 * A canvas a friend shared comes down into `shared/canvases/<their name>/<canvas>/`, bundle and all,
 * the deck files mirrored inside it, so its boards read their own copies and never this deck's. If
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
 */
export class HarnessSync {
	private readonly bases: Bases;
	private readonly store: SyncStore;
	private readonly scheduler: SyncScheduler;
	private readonly transport: StudioTransport;
	private readonly files: FileSync;
	private readonly pictures: PictureSync;
	private watchers: FSWatcher[] = [];
	readonly skipped = new Set<string>();
	readonly conflicts: string[] = [];

	// ---- what a targeted pass has to do ----
	/** Each canvas.pen as this harness last read or wrote it (size, time), by name: one that has not changed since is not read again. */
	private penSeen = new Map<string, { size: number; mtimeMs: number }>();
	/** Studio's canvases as last listed, by id: their role, owner and revision. */
	private remote = new Map<string, SyncCanvas>();
	/** The newest revision Studio has said each canvas is at, by id. */
	private latest = new Map<string, number>();
	/** Edits that came inside live messages and are not applied yet, by canvas id. */
	private inbox = new Map<string, { base: number; rev: number; changes: PenEdit[] }[]>();
	/** Edits made here and not sent yet, by canvas name, as the canvas store logged them (`edited`). */
	private outbox = new Map<string, PenEdit[][]>();
	/** Canvases (by name) adopted this pass: their first push adds what is here and removes nothing, since what is in Studio was never seen here. */
	private adopted = new Set<string>();
	/** When every file was last hashed whatever the cache said. */
	private checkedAt = 0;
	/** Whether Studio answers `changes?since=` (one from before 2026-10-21 does not: the whole drawing then). */
	private changesRoute = true;
	/** Canvases Studio refused to take up, so each refusal is logged once. */
	private refused = new Set<string>();
	constructor(private readonly o: SyncOptions) {
		this.bases = new Bases(join(o.deck, ".decks", "sync"));
		this.store = new SyncStore(o.deck, o.studio, this.bases);
		this.scheduler = new SyncScheduler({ log: (line) => this.log(line), progress: o.progress, hashes: this.store.hashes, skipped: this.skipped, resume: () => void this.sync(), targeted: () => this.targeted() });
		this.transport = new StudioTransport(o, (line) => this.log(line), this.store, this.bases, this.scheduler);
		this.files = new FileSync(o, (line) => this.log(line), this.store, this.transport, this.scheduler, this.skipped, this.conflicts);
		this.pictures = new PictureSync(o, (line) => this.log(line), this.store, this.transport, this.scheduler, this.files);
	}

	private log(line: string) {
		(this.o.log ?? ((l) => console.log(`[decks] studio: ${l}`)))(line);
	}

	/** One pass over everything; passes queue, so two never overlap. */
	sync(): Promise<void> {
		return this.scheduler.queue(() => this.pass());
	}

	/** Everything: every canvas both ways, its files, pictures and the app list. */
	private async pass() {
		this.files.forgetPlan();
		this.scheduler.begin();
		await this.transport.hello();
		this.scheduler.fullDue = false;
		const fresh = Date.now() - this.checkedAt >= RECHECK_MS;
		if (fresh) {
			this.penSeen.clear();
			this.transport.forgetRefusals();
		}
		this.scheduler.pull.clear();
		this.scheduler.dirtyPens.clear();
		this.scheduler.dirtyFiles.clear();
		this.scheduler.dirtyPictures.clear();
		await this.syncCanvases(fresh);
		await this.transport.tellInventory();
		if (fresh) {
			this.checkedAt = Date.now();
			this.store.hashes.prune();
		}
		this.store.save();
		// A change to a friend's canvas that came down in this pass is seen at once, not on the next full pass.
		this.watchFolders();
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
		for (const name of [...this.outbox.keys()]) {
			const s = this.store.state.canvases[name];
			const c = s && this.remote.get(s.id);
			if (!c) return this.pass();
			await this.pushEdits(name, c);
		}
		for (const name of new Set([...pens, ...files, ...pictures])) {
			const s = this.store.state.canvases[name];
			const c = s && this.remote.get(s.id);
			// A canvas Studio has not listed to this harness yet (new here, or just shared): a full pass takes it up.
			if (!c) return this.pass();
			if (pens.has(name)) await this.syncCanvas(name, c);
			if (files.has(name)) {
				this.files.plan([[name, c]]);
				const remote = await this.files.syncCanvasFiles(name, c, false);
				if (remote && c.role !== "view") await this.pictures.syncPictures(name, s.id, remote);
			} else if (pictures.has(name) && c.role !== "view") await this.pictures.syncPictures(name, s.id);
		}
		await this.pictures.syncCanvasPictures();
		this.store.save();
	}

	// ---- where things are ----

	/** A canvas's folder here, absolute. */
	private folder(name: string): string {
		return folderOf(this.o.deck, name);
	}

	/** This deck's own canvases: folders under canvases/ with a drawing. */
	private localCanvases(): string[] {
		const dir = join(this.o.deck, "canvases");
		return existsSync(dir) ? readdirSync(dir).filter((n) => safeCanvasFolder(n) && plainSegment(n) && existsSync(join(dir, n, "canvas.pen"))) : [];
	}

	/**
	 * The folder a friend's canvases land in: their Studio name, as a folder name, made unique once
	 * against another friend of the same name and remembered, so it never moves under them.
	 */
	private ownerFolder(c: SyncCanvas): string | undefined {
		const owners = (this.store.state.owners ??= {});
		if (owners[c.owner]) return owners[c.owner];
		const id = String(c.owner ?? "");
		if (!/^[A-Za-z0-9_-]+$/.test(id)) return undefined;
		const base = ownerFolderBase(c.ownerName ?? "");
		const taken = new Set(Object.values(owners));
		const name = taken.has(base) ? `${base}-${id.slice(0, 6)}` : base;
		owners[c.owner] = name;
		return name;
	}

	/** The name a Studio canvas has here, or undefined when its name could name somewhere else. */
	private nameFor(c: SyncCanvas): string | undefined {
		if (!safeCanvasName(c.name)) return undefined;
		if (c.owner === this.transport.user) return c.name;
		const owner = this.ownerFolder(c);
		return owner ? sharedName(owner, c.name) : undefined;
	}

		private forgetCanvas(name: string) {
		const s = this.store.state.canvases[name];
		if (s) {
			this.bases.forget(s.id);
			this.inbox.delete(s.id);
		}
		this.penSeen.delete(name);
		this.files.forget(name);
		delete this.store.state.canvases[name];
	}

	// ---- canvases ----

	private async syncCanvases(fresh: boolean) {
		let remote: SyncCanvas[] = (await this.transport.call("GET", "/sync/v1/canvases")).canvases;
		const known = new Set(Object.values(this.store.state.canvases).map((c) => c.id));
		/*
		 * Every folder this state does not know: one of Studio's canvases under another name (renamed, or the
		 * state lost) is adopted; a copy of one, or a canvas Studio has not seen, goes up; one whose name
		 * Studio already has is adopted too. Adopted means Studio's drawing is taken as the agreed one and
		 * what differs here goes up as edits, later in this pass (`syncCanvas`); nothing here is overwritten.
		 */
		for (const name of this.localCanvases()) {
			if (this.store.state.canvases[name]) continue;
			const claimed = this.studioIdOf(name);
			const mine = claimed ? remote.find((c) => c.id === claimed && c.owner === this.transport.user) : undefined;
			const elsewhere = mine && Object.entries(this.store.state.canvases).some(([other, c]) => c.id === mine.id && other !== name && existsSync(join(this.folder(other), "canvas.pen")));
			if (mine && !elsewhere) {
				const before = Object.keys(this.store.state.canvases).find((other) => this.store.state.canvases[other]!.id === mine.id);
				if (before) this.forgetCanvas(before);
				await this.adopt(name, mine.id, known, before ? `was ${before}, renamed` : "is one of yours already in Studio");
				continue;
			}
			const text = readFileSync(join(this.folder(name), "canvas.pen"), "utf8");
			let made: { canvas: SyncCanvas; existed?: boolean };
			try {
				made = await this.transport.call("POST", "/sync/v1/canvases", { name, title: this.titleOf(name), pen: parse(text) });
			} catch (error) {
				// Studio refuses this one (its name, its size): the rest of the deck still syncs, and the refusal is said once, not every pass.
				const status = (error as { status?: number }).status;
				if (status === undefined || status >= 500 || status === 401 || status === 429) throw error;
				if (!this.refused.has(name)) this.log(`did not upload canvas ${name}: ${(error as Error).message}`);
				this.refused.add(name);
				continue;
			}
			this.refused.delete(name);
			const { canvas, existed } = made;
			if (existed) {
				await this.adopt(name, canvas.id, known, "has the name of one of yours already in Studio");
				continue;
			}
			const full = await this.transport.call("GET", `/sync/v1/canvases/${canvas.id}`);
			this.store.state.canvases[name] = { id: canvas.id, rev: full.rev, files: {} };
			this.bases.keep(canvas.id, full.pen);
			this.writePen(name, this.bases.of(canvas.id)!.text, { text });
			this.writeMeta(name, { studio: canvas.id });
			known.add(canvas.id);
			this.pictures.want(name);
			this.log(`uploaded canvas ${name}${mine ? ` (a copy of ${mine.name}, now its own canvas)` : ""}`);
		}
		remote = (await this.transport.call("GET", "/sync/v1/canvases")).canvases;
		const byId = new Map(remote.map((c) => [c.id, c]));
		this.remote = byId;
		// Every Studio canvas this deck lacks comes down: yours to canvases/, a friend's to shared/canvases/.
		for (const c of remote) {
			if (known.has(c.id)) continue;
			const name = this.nameFor(c);
			if (!name) {
				this.log(`skipped Studio canvas ${JSON.stringify(c.name)}: its name is not a plain folder name`);
				continue;
			}
			if (this.store.state.canvases[name]) continue;
			const full = await this.transport.call("GET", `/sync/v1/canvases/${c.id}`);
			this.bases.keep(c.id, full.pen);
			this.writePen(name, this.bases.of(c.id)!.text);
			this.writeMeta(name, { title: c.title, studio: c.id, ...(isShared(name) ? { shared: { owner: c.owner, ownerName: c.ownerName ?? "", role: c.role } } : {}) }, true);
			this.store.state.canvases[name] = { id: c.id, rev: full.rev, files: {} };
			this.log(isShared(name) ? `${c.ownerName || "a friend"} shared ${c.title}: it is in ${canvasFolder(name)}` : `downloaded canvas ${name}`);
		}
		const synced: [string, SyncCanvas][] = [];
		for (const [name, s] of Object.entries(this.store.state.canvases)) {
			const c = byId.get(s.id);
			if (!safeCanvasFolder(name.split("/").at(-1)) || (name.includes("/") && !isShared(name))) {
				this.log(`forgot canvas ${JSON.stringify(name)}: its name is not a plain folder name`);
				this.forgetCanvas(name);
				continue;
			}
			// A friend's canvas kept where shared canvases came down before (canvases/shared-<id>-<name>): it comes down again to shared/.
			const misplaced = c && c.owner !== this.transport.user && !isShared(name);
			if (!c || misplaced) {
				this.moveAside(name, !c ? "is gone from Studio or no longer shared" : "is a friend's, and now lives in shared/canvases");
				this.forgetCanvas(name);
				continue;
			}
			if (isShared(name)) this.writeMeta(name, { title: c.title, shared: { owner: c.owner, ownerName: c.ownerName ?? "", role: c.role } });
			// One of yours that someone else may edit too: the harness runs no app inside it (`canvas/pens.ts`, `yoursAlone`).
			else this.writeMeta(name, { othersEdit: c.othersEdit === true });
			this.latest.set(c.id, Math.max(this.latest.get(c.id) ?? 0, c.rev));
			this.scheduler.say({ now: { canvas: name } });
			await this.syncCanvas(name, c);
			synced.push([name, c]);
		}
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

	/** The Studio id a folder's `canvas.json` carries, or undefined. */
	private studioIdOf(name: string): string | undefined {
		try {
			const id = (JSON.parse(readFileSync(join(this.folder(name), "canvas.json"), "utf8")) as { studio?: unknown }).studio;
			return typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id) ? id : undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * A folder here taken as one of Studio's canvases: Studio's drawing becomes the agreed one and the
	 * folder's own file is left as it is, so `syncCanvas` sends what differs as edits and the merge comes
	 * back; its files start with no agreed version, so one that differs is a conflict (`syncCanvasFiles`).
	 */
	private async adopt(name: string, id: string, known: Set<string>, why: string) {
		const full = await this.transport.call("GET", `/sync/v1/canvases/${id}`);
		this.store.state.canvases[name] = { id, rev: full.rev, files: {} };
		this.bases.keep(id, full.pen);
		this.writeMeta(name, { studio: id });
		known.add(id);
		this.adopted.add(name);
		this.pictures.want(name);
		this.log(`canvas ${name} ${why}: what is here and not there is merged into it`);
	}

	/**
	 * A canvas gone from Studio, or no longer shared, moved out of the way, never deleted: left where
	 * it is, a canvas of yours would read as a new one and go up again on the next pass.
	 */
	private moveAside(name: string, why: string) {
		const from = this.folder(name);
		const shared = sharedParts(name);
		if (existsSync(from)) {
			const to = shared ? join(this.o.deck, ".decks", "shared-removed", `${shared.owner}-${shared.canvas}-${Date.now()}`) : join(this.o.deck, ".decks", "studio-removed", `${name}-${Date.now()}`);
			mkdirSync(dirname(to), { recursive: true });
			renameSync(from, to);
			this.log(`canvas ${name} ${why}; its folder is moved to ${relative(this.o.deck, to).split(sep).join("/")}`);
		}
	}

	/**
	 * A canvas's drawing as it is here: read and parsed, or, when the file has not changed since this
	 * harness last read or wrote it, the last agreed drawing itself (`same`), with nothing read.
	 */
	private readLocal(name: string, base: { doc: PenDocument; text: string } | undefined): { text: string; doc: PenDocument; same: boolean; size: number; mtimeMs: number } | undefined {
		const path = join(this.folder(name), "canvas.pen");
		let st;
		try {
			st = statSync(path);
		} catch {
			return undefined;
		}
		const seen = this.penSeen.get(name);
		if (base && seen && seen.size === st.size && seen.mtimeMs === st.mtimeMs) return { ...base, same: true, size: st.size, mtimeMs: st.mtimeMs };
		cost.canvases++;
		const text = readFileSync(path, "utf8");
		try {
			const doc = parse(text);
			const same = base !== undefined && text === base.text;
			return { text, doc, same, size: st.size, mtimeMs: st.mtimeMs };
		} catch {
			return undefined; // Mid-write, or a hand edit that does not parse yet: next pass.
		}
	}

	/**
	 * One canvas's drawing both ways: this harness's edits since the last agreed drawing go up, and
	 * Studio's since its revision come down, from live messages, `changes?since=`, or whole.
	 */
	private async syncCanvas(name: string, remote: SyncCanvas) {
		const s = this.store.state.canvases[name];
		if (!s) return;
		// Comparing the file finds every edit made here, the queued ones among them.
		this.outbox.delete(name);
		let base = this.bases.of(s.id);
		const local = this.readLocal(name, base);
		if (!local) return;
		if (!base) {
			// No agreed drawing kept (deleted by hand): Studio's as it is now, and this deck's differences go up on it.
			const full = await this.transport.call("GET", `/sync/v1/canvases/${s.id}`);
			this.bases.keep(s.id, full.pen);
			s.rev = full.rev;
			base = this.bases.of(s.id)!;
		}
		let edits = local.same ? [] : diff(base.doc, local.doc);
		// A folder adopted this pass: its items and words go up, but nothing Studio has is removed, since this folder never saw it.
		if (this.adopted.delete(name)) edits = edits.filter((e) => e.op !== "remove");
		let next: { doc: PenDocument; rev: number } | undefined;
		if (edits.length && remote.role !== "view") {
			this.pictures.want(name);
			const r = await this.transport.postEdits(s.id, { base: s.rev, edits, client: this.transport.me });
			if (!r) return;
			if (r.dropped) this.log(`${name}: ${r.dropped} of your edits touched items someone else removed`);
			if (r.pen) next = { doc: r.pen, rev: r.rev }; // A Studio from before edits were answered with changes.
			else if (r.base === s.rev) next = { doc: loosely(base.doc, r.changes ?? []), rev: r.rev };
			else {
				this.latest.set(s.id, Math.max(this.latest.get(s.id) ?? 0, r.rev));
				next = await this.changesSince(s, base.doc);
			}
		} else if (edits.length || (this.latest.get(s.id) ?? s.rev) > s.rev || this.inbox.get(s.id)?.length) {
			next = await this.changesSince(s, base.doc);
			if (next) this.pictures.want(name);
		}
		if (!next) {
			// Nothing to do, and the file is what was agreed: not read again until it changes.
			if (local.same || !edits.length) this.penSeen.set(name, { size: local.size, mtimeMs: local.mtimeMs });
			return;
		}
		/*
		 * The file first, then the agreed drawing, then (at the end of the pass) the revision: stopped
		 * between any two, the next pass finds the edits already made, which change nothing again.
		 */
		const text = serialize(next.doc);
		this.writePen(name, text, local);
		this.bases.keep(s.id, next.doc, text);
		s.rev = next.rev;
		this.latest.set(s.id, Math.max(this.latest.get(s.id) ?? 0, s.rev));
	}

	/**
	 * Studio's drawing at its newest revision, from the last agreed one: the edits that came in live
	 * messages when they follow on, else `changes?since=`, else (the log no longer reaches back, or an
	 * older Studio) the whole drawing.
	 */
	private async changesSince(s: CanvasState, from: PenDocument): Promise<{ doc: PenDocument; rev: number }> {
		let doc = from;
		let rev = s.rev;
		const waiting = (this.inbox.get(s.id) ?? []).sort((a, b) => a.rev - b.rev);
		this.inbox.delete(s.id);
		try {
			for (const m of waiting) {
				if (m.rev <= rev) continue;
				if (m.base !== rev) break;
				doc = loosely(doc, m.changes);
				rev = m.rev;
			}
		} catch {
			doc = from;
			rev = s.rev;
		}
		if (rev >= (this.latest.get(s.id) ?? 0) && rev !== s.rev) return { doc, rev };
		if (this.changesRoute) {
			try {
				const got = await this.transport.call("GET", `/sync/v1/canvases/${s.id}/changes?since=${rev}`);
				if (!got.tooOld && Array.isArray(got.changes)) {
					for (const edits of got.changes as PenEdit[][]) doc = loosely(doc, edits);
					return { doc, rev: got.rev };
				}
			} catch (error) {
				if ((error as { status?: number }).status === 404 && !(await this.canvasThere(s.id))) throw error;
				if ((error as { status?: number }).status === 404) this.changesRoute = false;
			}
		}
		const full = await this.transport.call("GET", `/sync/v1/canvases/${s.id}`);
		return { doc: full.pen, rev: full.rev };
	}

	/** Whether a 404 was the canvas gone (a full pass deals with that) or Studio without the route. */
	private async canvasThere(id: string): Promise<boolean> {
		try {
			await this.transport.call("GET", `/sync/v1/canvases/${id}?since=${Number.MAX_SAFE_INTEGER}`);
			return true;
		} catch {
			this.scheduler.fullDue = true;
			return false;
		}
	}

	/**
	 * Written in place, never renamed over: the harness watches this file. `was` is the file as it
	 * was read before Studio was asked; when it changed since (an agent wrote it meanwhile), those
	 * changes are kept on top of Studio's and go up on the next pass.
	 */
	private writePen(name: string, text: string, was?: { text: string; size?: number; mtimeMs?: number }, by = "studio") {
		const path = join(this.folder(name), "canvas.pen");
		let current: string | undefined;
		let st;
		try {
			st = statSync(path);
		} catch {
			st = undefined;
		}
		if (st && was && was.size === st.size && was.mtimeMs === st.mtimeMs) current = was.text;
		else if (st) current = readFileSync(path, "utf8");
		let out = text;
		if (was && current !== undefined && current !== was.text) {
			try {
				const extra = diff(parse(was.text), parse(current));
				out = serialize(loosely(parse(text), extra));
				this.scheduler.dirtyPens.add(name);
				this.scheduler.soon(300);
			} catch {
				// What is there does not parse (mid-write): it is left for the next pass.
				return;
			}
		}
		if (current !== out) {
			cost.canvases++;
			// Through the canvas store when the harness gives one: the write is recorded as Studio's and reaches every frame at once.
			if (!this.o.remote?.write(name, out, by)) {
				mkdirSync(dirname(path), { recursive: true });
				writeFileSync(path, out);
			}
		}
		const after = statSync(path);
		if (out === text) this.penSeen.set(name, { size: after.size, mtimeMs: after.mtimeMs });
	}

	private titleOf(name: string): string {
		try {
			return JSON.parse(readFileSync(join(this.folder(name), "canvas.json"), "utf8")).title ?? name;
		} catch {
			return name;
		}
	}

	/**
	 * What `canvas.json` says about a synced canvas: the Studio canvas it is, and for a friend's, who
	 * shared it and as what (`CanvasPens.sharing`). `fresh` writes a title too, for one that came down.
	 */
	private writeMeta(name: string, set: { title?: string; studio?: string; shared?: { owner: string; ownerName: string; role: string }; othersEdit?: boolean }, fresh = false) {
		const file = join(this.folder(name), "canvas.json");
		let meta: Record<string, unknown> = {};
		try {
			meta = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		} catch {
			/* a first record */
		}
		const studio = set.studio ?? (typeof meta.studio === "string" ? meta.studio : undefined);
		const next: Record<string, unknown> = { ...meta, ...((fresh || !meta.title) && set.title ? { title: set.title } : {}), ...(studio ? { studio } : {}), ...(set.shared ? { shared: { ...set.shared, ...(studio ? { studio } : {}) } } : {}) };
		if (set.othersEdit === true) next.othersEdit = true;
		else if (set.othersEdit === false) delete next.othersEdit;
		next.boards ??= [];
		if (JSON.stringify(next) === JSON.stringify(meta)) return;
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, `${JSON.stringify(next, null, "\t")}\n`);
	}

	// ---- edits made here, sent as they are logged ----

	/**
	 * An edit made on this harness, as its canvas store logged it (`CanvasPens.wrote`): for a canvas on
	 * Studio, the edits go up at once, with Studio's revision as their base, instead of waiting for the
	 * file to be compared with the last agreed drawing (which stays as the repair for anything missed).
	 * One Studio made (author `studio`, written through `remote.write`) is Studio's already.
	 */
	edited(name: string, change: { edits: readonly PenEdit[]; by: { kind: string; id?: string } }): void {
		if (this.scheduler.stopped || change.by.kind === "studio" || !change.edits.length) return;
		if (!this.store.state.canvases[name]) return;
		const list = this.outbox.get(name) ?? [];
		list.push([...change.edits]);
		this.outbox.set(name, list);
		this.scheduler.soon(0);
	}

	/**
	 * The edits queued for one canvas, sent as one body against the revision agreed here, and Studio's
	 * answer taken as a pass takes it: the drawing as Studio now has it (ours merged, and whatever else
	 * came meanwhile) becomes the agreed one, and is written here only where it differs.
	 */
	private async pushEdits(name: string, remote: SyncCanvas) {
		const queued = this.outbox.get(name) ?? [];
		this.outbox.delete(name);
		const s = this.store.state.canvases[name];
		if (!s || !queued.length) return;
		// Nothing of ours goes onto a canvas shared with us to view: the next pass says so of the file.
		if (remote.role === "view") return;
		const base = this.bases.of(s.id);
		if (!base) {
			this.scheduler.dirtyPens.add(name);
			return;
		}
		const edits = queued.flat();
		this.pictures.want(name);
		const r = await this.transport.postEdits(s.id, { base: s.rev, edits, client: this.transport.me });
		// Held: the file holds them, and the pass after the wait compares it (`syncCanvas`).
		if (!r) return void this.scheduler.dirtyPens.add(name);
		if (r.dropped) this.log(`${name}: ${r.dropped} of your edits touched items someone else removed`);
		let next: { doc: PenDocument; rev: number };
		if (r.pen) next = { doc: r.pen, rev: r.rev };
		else if (r.base === s.rev) next = { doc: loosely(base.doc, r.changes ?? []), rev: r.rev };
		else {
			this.latest.set(s.id, Math.max(this.latest.get(s.id) ?? 0, r.rev));
			next = await this.changesSince(s, base.doc);
		}
		if (next.rev === s.rev && !r.adjusted && !r.dropped) return; // Set what was already there: no revision, nothing to write.
		const local = this.readLocal(name, base);
		const text = serialize(next.doc);
		this.writePen(name, text, local, "studio");
		this.bases.keep(s.id, next.doc, text);
		s.rev = next.rev;
		this.latest.set(s.id, Math.max(this.latest.get(s.id) ?? 0, s.rev));
		this.store.save();
	}

	/** Where someone on this harness is on a canvas kept on Studio, said to everyone else on it (`StudioTransport.presence`). */
	presence(name: string, message: PresenceMessage): void {
		this.transport.presence(name, message);
	}

	// ---- staying in step ----

	/** What a live message asks for: one canvas, its files, or (the list changed) a full pass. */
	private heard(e: LiveEvent) {
		if (e.type === "hello") {
			// Connected again: what was said while away is not known, so everything is looked at.
			this.scheduler.fullDue = true;
			return this.scheduler.soon(50);
		}
		if (e.type === "presence") {
			const name = Object.entries(this.store.state.canvases).find(([, s]) => s.id === e.canvas)?.[0];
			if (name) this.o.presence?.(name, e);
			return;
		}
		if ("by" in e && e.by && e.by === this.transport.me) return;
		switch (e.type) {
			case "canvas": {
				if (!e.id) return;
				if (typeof e.rev === "number") this.latest.set(e.id, Math.max(this.latest.get(e.id) ?? 0, e.rev));
				if (Array.isArray(e.changes) && typeof e.base === "number" && typeof e.rev === "number") {
					const list = this.inbox.get(e.id) ?? [];
					list.push({ base: e.base, rev: e.rev, changes: e.changes as unknown as PenEdit[] });
					// A canvas nobody here looks at for a while keeps at most its last 500 messages; the rest come by `changes?since=`.
					this.inbox.set(e.id, list.slice(-500));
				}
				this.scheduler.pull.add(e.id);
				// Applied the moment it arrives: the frames on this harness hear the change as the canvas store writes it.
				return this.scheduler.soon(0);
			}
			case "file": {
				const name = Object.entries(this.store.state.canvases).find(([, s]) => s.id === e.canvas)?.[0];
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

	/** What a change in a watched folder asks for: the canvas it is in, or the canvases that use a deck file. */
	private changed(top: string, filename: string | null) {
		if (!filename) {
			this.scheduler.fullDue = true;
			return this.scheduler.soon(300);
		}
		const parts = filename.split(sep).join("/").split("/");
		let name: string | undefined;
		let rest: string[] = [];
		if (top === "canvases") {
			name = parts[0];
			rest = parts.slice(1);
		} else if (top === SHARED_CANVASES) {
			if (parts.length < 2) return;
			name = sharedName(parts[0]!, parts[1]!);
			rest = parts.slice(2);
		} else if (top === THUMBS) {
			const owner = this.pictures.ownerOfThumb(parts[0]!.slice(0, 16));
			if (owner) {
				this.scheduler.dirtyPictures.add(owner);
				this.scheduler.soon(1000);
			}
			return;
		} else {
			// A deck file: the canvases whose bundles hold it or whose boards point at it.
			const path = `${top}/${parts.join("/")}`;
			for (const [n, s] of Object.entries(this.store.state.canvases)) if (s.files[path] || this.files.pointsAt(n, path)) this.scheduler.dirtyFiles.add(n);
			return this.scheduler.soon(300);
		}
		if (!name) return;
		if (!this.store.state.canvases[name]) {
			// A canvas made here, or a folder not synced yet: a full pass takes it up.
			if (rest[0] === "canvas.pen") this.scheduler.fullDue = true;
			else return;
		} else if (rest.length === 0) this.scheduler.fullDue = true;
		else if (rest.length === 1 && rest[0] === "canvas.pen") this.scheduler.dirtyPens.add(name);
		else if (rest.length === 1) return; // canvas.json and the like: nothing Studio keeps.
		else this.scheduler.dirtyFiles.add(name);
		this.scheduler.soon(300);
	}

	/** Sync now, then on every change on either side, and every 5 minutes besides. */
	async start(): Promise<void> {
		await this.sync();
		this.transport.listen((e) => this.heard(e));
		this.started = true;
		this.watchFolders();
		this.scheduler.every(FULL_PASS_MS, () => this.sync());
	}

	/** Which of the deck's synced folders are watched: one that comes later (a friend's first share, the first canvas) is watched from then on. */
	private watched = new Set<string>();
	private started = false;
	private watchFolders() {
		if (!this.started || this.scheduler.stopped) return;
		for (const top of ["canvases", SHARED_CANVASES, ...MIRRORED, THUMBS]) {
			const dir = join(this.o.deck, top);
			if (this.watched.has(top) || !existsSync(dir)) continue;
			this.watched.add(top);
			this.watchers.push(watch(dir, { recursive: top !== THUMBS }, (_event, filename) => this.changed(top, filename === null ? null : String(filename))));
		}
	}

	async stop() {
		this.scheduler.halt();
		for (const w of this.watchers) w.close();
		this.transport.close();
		await this.scheduler.idle();
	}

	/** How far the deck is in step with Studio, as last said. */
	progress(): SyncProgress {
		return this.scheduler.progress();
	}
}

/**
 * Edits applied as far as they fit: an insert of an item already there, or an edit to one gone, is
 * left out. Applying a revision twice (the harness stopped between writing the file and its state)
 * so changes nothing.
 */
function loosely(doc: PenDocument, edits: readonly PenEdit[]): PenDocument {
	const ids = new Set<string>();
	const visit = (list: readonly { id: string; children?: unknown }[]) => {
		for (const n of list) {
			ids.add(n.id);
			if (Array.isArray(n.children)) visit(n.children as never);
		}
	};
	if (edits.some((e) => e.op === "insert")) visit(doc.children ?? []);
	const fits = edits.filter((e) => e.op !== "insert" || !ids.has(e.id));
	try {
		return applyEdits(doc, fits);
	} catch {
		let out = doc;
		for (const edit of fits) {
			try {
				out = applyEdits(out, [edit]);
			} catch {
				/* an item gone in Studio's drawing */
			}
		}
		return out;
	}
}
