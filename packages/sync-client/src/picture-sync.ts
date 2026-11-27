import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { canvasFolder } from "@decks/hub/layout";
import { PICTURES, type SyncFile } from "@decks/sync-protocol";
import type { FileSync } from "./file-sync.ts";
import { sha256 as hashOf } from "./hash-cache.ts";
import type { SyncScheduler } from "./scheduler.ts";
import { cost, readFileSync, type SyncOptions, type SyncStore } from "./state.ts";
import type { StudioTransport } from "./transport.ts";

/** Card pictures the harness keeps, watched so a new one goes up with its canvas. */
export const THUMBS = ".decks/thumbs";

/**
 * The pictures Studio shows of what is here: one of each canvas, for its card in Studio's list, and
 * each card's newest, so Studio can draw a card that is not live. They go up as files of the canvas
 * (`.pictures/…`), after its drawing and its own files, since they can always be taken again.
 */
export class PictureSync {
	/** Canvases whose drawing changed since their picture was last taken, and when each was taken. */
	private due = new Set<string>();
	private takenAt = new Map<string, number>();
	/** Which canvas a card picture in `.decks/thumbs` belongs to, by its file name's prefix. */
	private thumbOwner = new Map<string, string>();

	constructor(
		private readonly o: SyncOptions,
		private readonly log: (line: string) => void,
		private readonly store: SyncStore,
		private readonly transport: StudioTransport,
		private readonly scheduler: SyncScheduler,
		private readonly files: FileSync,
	) {}

	/** A canvas's drawing changed, or Studio has no picture of it: one is taken (at most one a minute). */
	want(name: string) {
		this.due.add(name);
	}

	/** The canvas a card picture in `.decks/thumbs` belongs to, by the first 16 letters of its file name. */
	ownerOfThumb(prefix: string): string | undefined {
		return this.thumbOwner.get(prefix);
	}

	/**
	 * A picture of each canvas whose drawing changed, taken by this harness's own `canvas.screenshot`
	 * (native, a few milliseconds), for its card in Studio. At most one a minute per canvas; a canvas
	 * Studio has no picture of yet is taken first.
	 */
	async syncCanvasPictures() {
		const started = performance.now();
		try {
			await this.takeCanvasPictures();
		} finally {
			cost.pictureMs += performance.now() - started;
		}
	}

	private async takeCanvasPictures() {
		if (!this.o.harness) return;
		for (const name of [...this.due]) {
			// Studio asked for a wait: the pictures stay due, taken when it is over.
			if (this.scheduler.holding("files")) return;
			const s = this.store.state.canvases[name];
			if (!s || Date.now() - (this.takenAt.get(name) ?? 0) < 60_000) continue;
			this.due.delete(name);
			this.takenAt.set(name, Date.now());
			try {
				const res = await fetch(new URL("/api/v1/canvas.screenshot", this.o.harness), {
					method: "POST",
					headers: { "Content-Type": "application/json", ...(this.o.harnessToken ? { Authorization: `Bearer ${this.o.harnessToken()}` } : {}) },
					body: JSON.stringify({ args: [{ canvas: name, format: "jpeg", scheme: "light" }] }),
				});
				const shot = (await res.json()) as { ok?: boolean; value?: { file?: string } };
				if (!shot.ok || !shot.value?.file) continue;
				const file = shot.value.file.startsWith("/") ? shot.value.file : join(this.o.deck, shot.value.file);
				const bytes = readFileSync(file);
				const sent = await this.transport.upload(name, s.id, `${PICTURES}/canvas.light.jpg`, bytes, hashOf(bytes));
				if (!sent && this.scheduler.holding("files")) {
					this.due.add(name);
					this.takenAt.delete(name);
				}
			} catch (error) {
				this.log(`no picture of canvas ${name}: ${(error as Error).message}`);
			}
		}
	}

	/**
	 * Each card's newest picture, so Studio can draw it when the card is not live: the whole one when
	 * the harness has taken it, else its widest rung (800, then 480, which every card on a canvas has).
	 */
	async syncPictures(name: string, id: string, remote?: Map<string, SyncFile>) {
		const there = remote ?? new Map<string, SyncFile>(((await this.transport.call("GET", `/sync/v1/canvases/${id}/files`)).files as SyncFile[]).map((f) => [f.path, f]));
		if (!there.has(`${PICTURES}/canvas.light.jpg`)) this.due.add(name);
		const dir = join(this.o.deck, ".decks", "thumbs");
		if (!existsSync(dir)) return;
		const thumbs = readdirSync(dir);
		const folder = canvasFolder(name);
		for (const path of this.files.bundle(name).keys()) {
			if (!/^cards\/[^/]+\/index\.html$/.test(path) && !/^boards\/.+\.html$/.test(path)) continue;
			const prefix = createHash("sha1").update(`${folder}/${path}`).digest("hex").slice(0, 16);
			this.thumbOwner.set(prefix, name);
			for (const scheme of ["light", "dark"]) {
				const re = new RegExp(`^${prefix}-(\\d+)-${scheme}-\\d+-whole(?:-w(800|480))?-l\\d+\\.webp$`);
				const found = thumbs.flatMap((t) => {
					const m = re.exec(t);
					return m ? [{ t, rev: m[1]!, width: m[2] ? Number(m[2]) : Number.POSITIVE_INFINITY, at: statSync(join(dir, t)).mtimeMs }] : [];
				});
				if (found.length === 0) continue;
				// The newest revision's, its widest.
				const rev = found.reduce((a, b) => (b.at > a.at ? b : a)).rev;
				const newest = found.filter((one) => one.rev === rev).sort((a, b) => b.width - a.width)[0]!;
				const target = `${PICTURES}/${path}.${scheme}.webp`;
				const full = join(dir, newest.t);
				const got = this.store.hashes.hash(full);
				if (!got || there.get(target)?.hash === got.hash) continue;
				await this.transport.upload(name, id, target, got.bytes ?? readFileSync(full), got.hash);
				if (this.scheduler.holding("files")) return;
			}
		}
	}
}
