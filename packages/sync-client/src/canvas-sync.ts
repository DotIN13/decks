import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { applyEdits, diff, parse, serialize, type PenDocument, type PenEdit } from "@decks/pen";
import { canvasFolder, ownerFolderBase, plainSegment, sharedName, sharedParts } from "@decks/hub/layout";
import { safeCanvasFolder, safeCanvasName, type LiveEvent, type SyncCanvas } from "@decks/sync-protocol";
import type { Bases } from "./bases.ts";
import type { FileSync } from "./file-sync.ts";
import type { PictureSync } from "./picture-sync.ts";
import type { SyncScheduler } from "./scheduler.ts";
import { cost, folderOf, isShared, readFileSync, writeFileSync, type CanvasState, type SyncOptions, type SyncStore } from "./state.ts";
import type { StudioTransport } from "./transport.ts";

/**
 * Each canvas's drawing, kept in step with Studio's as edits: what changed here since the last agreed
 * drawing (`Bases`) goes up as `diff`, merged item by item in Studio, and what changed there comes down
 * from live messages, `changes?since=`, or whole. Also which canvases there are on each side: new
 * folders go up or are adopted, Studio's new canvases (a friend's under shared/canvases/) come down,
 * and gone ones are moved aside, never deleted.
 */
export class CanvasSync {
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
	/** Whether Studio answers `changes?since=` (one from before 2026-10-21 does not: the whole drawing then). */
	private changesRoute = true;
	/** Canvases Studio refused to take up, so each refusal is logged once. */
	private refused = new Set<string>();

	constructor(
		private readonly o: SyncOptions,
		private readonly log: (line: string) => void,
		private readonly store: SyncStore,
		private readonly bases: Bases,
		private readonly transport: StudioTransport,
		private readonly scheduler: SyncScheduler,
		private readonly files: FileSync,
		private readonly pictures: PictureSync,
	) {}

	/** The full recheck: every drawing is read again, whatever its size and time say. */
	forgetSeen() {
		this.penSeen.clear();
	}

	/** Studio's listing of a canvas, by its id, as the last full pass found it; undefined for one Studio has not listed to this harness. */
	listed(id: string): SyncCanvas | undefined {
		return this.remote.get(id);
	}

	/** The canvases (by name) with edits made here not sent yet. */
	queued(): string[] {
		return [...this.outbox.keys()];
	}

	/** A live message that a canvas changed: its revision noted, and its edits kept until the canvas is synced. */
	heard(e: Extract<LiveEvent, { type: "canvas" }>) {
		if (!e.id) return;
		if (typeof e.rev === "number") this.latest.set(e.id, Math.max(this.latest.get(e.id) ?? 0, e.rev));
		if (Array.isArray(e.changes) && typeof e.base === "number" && typeof e.rev === "number") {
			const list = this.inbox.get(e.id) ?? [];
			list.push({ base: e.base, rev: e.rev, changes: e.changes as unknown as PenEdit[] });
			// A canvas nobody here looks at for a while keeps at most its last 500 messages; the rest come by `changes?since=`.
			this.inbox.set(e.id, list.slice(-500));
		}
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

	/** A canvas no longer synced here: its agreed drawing, waiting edits and remembered state go. */
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

	/**
	 * Every canvas's drawing, both ways: folders here Studio does not know go up or are adopted, Studio's
	 * canvases this deck lacks come down, ones gone from Studio are moved aside, and every other drawing
	 * is synced. Answers the canvases synced, with Studio's listing of each, for their files to follow.
	 */
	async syncCanvases(): Promise<[string, SyncCanvas][]> {
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
		return synced;
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
	async syncCanvas(name: string, remote: SyncCanvas) {
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
		next.cards ??= [];
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
	async pushEdits(name: string, remote: SyncCanvas) {
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
