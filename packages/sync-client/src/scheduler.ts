import { appendFileSync } from "node:fs";
import type { SyncProgress } from "@decks/sync-protocol";
import type { HashCache } from "./hash-cache.ts";
import { cost } from "./state.ts";

/** What the scheduler is handed by the sync it runs: where to log and report, and the two kinds of pass. */
export interface SchedulerHooks {
	log: (line: string) => void;
	progress?: (progress: SyncProgress) => void;
	/** The hash cache, whose own counts join each pass's cost line. */
	hashes: HashCache;
	/** The files left out, by `<canvas>:<path>`: said when a pass ends. */
	skipped: Set<string>;
	/** A pass over everything: what runs when Studio's wait is over. */
	resume: () => void;
	/** A pass over only what changed: what runs soon after a change on either side. */
	targeted: () => Promise<void>;
}

/**
 * When sync works and how far it has got: passes queue so two never overlap, what a targeted pass
 * has to do is collected here between passes, Studio's asks to wait (a 429) hold a kind of work
 * until they are over, and the progress said to Settings and Studio is counted here, file by file.
 */
export class SyncScheduler {
	stopped = false;

	// ---- what a targeted pass has to do ----
	/** Canvases (by id) Studio says changed; canvases (by name) whose drawing, files or card pictures changed here. */
	readonly pull = new Set<string>();
	readonly dirtyPens = new Set<string>();
	readonly dirtyFiles = new Set<string>();
	readonly dirtyPictures = new Set<string>();
	/** Something only a full pass covers: a new canvas, a share, a lost connection. */
	fullDue = false;

	private running = Promise.resolve();
	private pending?: NodeJS.Timeout;
	private timer?: NodeJS.Timeout;
	/**
	 * Until when Studio asked this harness to send no more of a kind (a 429's Retry-After): files (a
	 * canvas's files and pictures, which share Studio's files-a-minute and bytes-an-hour limits) or
	 * edits. What is held is sent by the pass that runs when the wait is over (`hold`), and the rest of
	 * a pass goes on meanwhile: a backlog of pictures never stops a drawing's edits.
	 */
	private held: Record<"files" | "edits", number> = { files: 0, edits: 0 };
	private resume?: NodeJS.Timeout;

	/** How far the deck is in step, said through `progress` (`SyncProgress`). */
	private said: SyncProgress = { state: "connecting", canvases: { done: 0, total: 0 }, files: { done: 0, total: 0 }, bytes: { done: 0, total: 0 }, sent: 0, received: 0, skipped: 0, at: Date.now() };
	/** The files this pass found due, by `<canvas>:<path>`, with their size: each counted done once, when it is dealt with. */
	private due = new Map<string, number>();
	private telling?: NodeJS.Timeout;
	private toldAt = 0;

	constructor(private readonly h: SchedulerHooks) {}

	// ---- passes ----

	queue(work: () => Promise<void>): Promise<void> {
		this.running = this.running
			.then(() => this.measured(work))
			.then(() => this.settled())
			.catch((error) => {
				this.h.log(`pass failed: ${(error as Error).message}`);
				this.say({ state: "offline", error: offlineWhy(error as Error), now: undefined }, true);
			});
		return this.running;
	}

	/** A pass, and what it cost, as one line in `DECKS_STUDIO_STATS` when that names a file. */
	private async measured(work: () => Promise<void>) {
		const started = performance.now();
		const hashes = this.h.hashes;
		const was = { ...cost, cacheHashed: hashes.cost.hashed, cacheFiles: hashes.cost.files };
		await work();
		const file = process.env.DECKS_STUDIO_STATS;
		if (file) {
			const spent = Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, Math.round(v - was[k as keyof typeof cost])]));
			const hashed = hashes.cost.hashed - was.cacheHashed;
			spent.hashed! += hashed;
			spent.read! += hashed;
			spent.files! += hashes.cost.files - was.cacheFiles;
			appendFileSync(file, `${JSON.stringify({ at: Date.now(), ms: Math.round((performance.now() - started) * 10) / 10, ...spent })}\n`);
		}
	}

	/** A targeted pass soon: each change on either side pushes it back, so a burst of them is one pass. */
	soon(ms: number) {
		clearTimeout(this.pending);
		this.pending = setTimeout(() => {
			if (!this.stopped) void this.queue(() => this.h.targeted());
		}, ms);
	}

	/** The backstop: `pass` this often, besides the targeted ones. */
	every(ms: number, pass: () => void) {
		this.timer = setInterval(pass, ms);
	}

	/** Nothing more starts; what is running goes on to its end (`idle`). */
	halt() {
		this.stopped = true;
		clearTimeout(this.pending);
		clearInterval(this.timer);
		clearTimeout(this.resume);
		clearTimeout(this.telling);
	}

	/** When the passes queued so far are over. */
	idle(): Promise<void> {
		return this.running;
	}

	// ---- Studio's waits ----

	/** Whether Studio asked for no more of this kind for now. */
	holding(kind: "files" | "edits"): boolean {
		return Date.now() < this.held[kind];
	}

	/** Studio asked for a wait (429): none of this kind until then, and a pass when it is over, which sends what waited. */
	hold(kind: "files" | "edits", seconds = 60) {
		const ms = Math.min(Math.max(seconds, 1), 3600) * 1000;
		if (!this.holding(kind)) this.h.log(`Studio asked for no more ${kind} for ${Math.round(ms / 1000)} s: the rest go up then`);
		this.held[kind] = Math.max(this.held[kind], Date.now() + ms);
		this.say({ state: "held", heldUntil: Math.max(this.held.files, this.held.edits) }, true);
		const at = Math.max(this.held.files, this.held.edits) - Date.now();
		clearTimeout(this.resume);
		this.resume = setTimeout(() => {
			if (!this.stopped) void this.h.resume();
		}, at + 500);
	}

	// ---- how far it is ----

	/** How far the deck is in step with Studio, as last said. */
	progress(): SyncProgress {
		return { ...this.said, canvases: { ...this.said.canvases }, files: { ...this.said.files }, bytes: { ...this.said.bytes } };
	}

	/** What was last said, to count on from (bytes sent and received, canvases done). */
	get told(): Readonly<SyncProgress> {
		return this.said;
	}

	/**
	 * A pass starts: the counts start again from nothing. A pass held by Studio stays held until the
	 * wait is over; one after a failure says syncing again at once.
	 */
	begin() {
		this.due.clear();
		const held = this.holding("files") || this.holding("edits");
		const told = this.said;
		// The deck not yet in step (a wait, a failure): what was done counts on, so the bar goes on from where it was rather than from nothing.
		const on = told.state === "held" || told.state === "offline" || told.state === "syncing";
		const files = on ? { done: told.files.done, total: told.files.done } : { done: 0, total: 0 };
		const bytes = on ? { done: told.bytes.done, total: told.bytes.done } : { done: 0, total: 0 };
		this.say({ state: held ? "held" : "syncing", canvases: { done: 0, total: 0 }, files, bytes, ...(on ? {} : { sent: 0, received: 0 }), now: undefined, error: undefined, ...(held ? {} : { heldUntil: undefined }) }, true);
	}

	/** The files left out, `<canvas>/<path>`, the first hundred. */
	private leftOut(): string[] {
		return [...this.h.skipped].slice(0, 100).map((key) => key.replace(":", "/"));
	}

	/** Say how many files are left out, and which. */
	tellSkipped() {
		this.say({ skipped: this.h.skipped.size, leftOut: this.leftOut() });
	}

	/** A file joins the work due. */
	owe(key: string, size: number) {
		if (this.due.has(key)) return;
		this.due.set(key, size);
		this.say({ files: { done: this.said.files.done, total: this.said.files.total + 1 }, bytes: { done: this.said.bytes.done, total: this.said.bytes.total + size } });
	}

	/** A file due is dealt with: sent, taken, found the same, or left out. */
	paid(key: string) {
		const size = this.due.get(key);
		if (size === undefined) return;
		this.due.delete(key);
		this.say({ files: { done: this.said.files.done + 1, total: this.said.files.total }, bytes: { done: this.said.bytes.done + size, total: this.said.bytes.total } });
	}

	/** A pass ended without failing: in step, unless Studio asked for a wait and something waits for it. */
	private settled() {
		if (this.holding("files") || this.holding("edits")) return this.say({ state: "held", now: undefined, heldUntil: Math.max(this.held.files, this.held.edits) }, true);
		this.say({ state: "synced", now: undefined, heldUntil: undefined, error: undefined, syncedAt: Date.now(), skipped: this.h.skipped.size, leftOut: this.leftOut() }, true);
	}

	/** Change what is said; told through `progress` at once when the state changes, else at most every 250 ms. */
	say(change: Partial<SyncProgress>, now = false) {
		const before = this.said.state;
		const next = { ...this.said, ...change, at: Date.now() };
		for (const key of Object.keys(change) as (keyof SyncProgress)[]) if (change[key] === undefined) delete next[key];
		this.said = next;
		if (!this.h.progress || this.stopped) return;
		const tell = () => {
			clearTimeout(this.telling);
			this.telling = undefined;
			this.toldAt = Date.now();
			this.h.progress?.(this.progress());
		};
		if (now || next.state !== before || Date.now() - this.toldAt >= 250) return tell();
		this.telling ??= setTimeout(tell, 250 - (Date.now() - this.toldAt));
	}
}

/** Why a pass failed, in words for Settings and Studio: Studio not reached, the key refused, or what Studio said. */
function offlineWhy(error: Error & { status?: number }): string {
	if (error.status === 401) return "Studio refused this harness's key: sign in again.";
	if (error.status === undefined) return "Studio could not be reached.";
	return `Studio answered ${error.status}.`.slice(0, 500);
}
