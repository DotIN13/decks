import { existsSync, watch, type FSWatcher } from "node:fs";
import { join, sep } from "node:path";
import { SHARED_CANVASES, sharedName } from "@decks/hub/layout";
import { MIRRORED_PARTS } from "@decks/sync-protocol";
import type { FileSync } from "./file-sync.ts";
import { THUMBS, type PictureSync } from "./picture-sync.ts";
import type { SyncScheduler } from "./scheduler.ts";
import type { SyncStore } from "./state.ts";

/**
 * The deck's synced folders, watched from inside the harness: a change in one marks what a targeted
 * pass has to do (`SyncScheduler`), the canvas whose drawing, files or card pictures changed, or a
 * full pass when the change could be a new canvas.
 */
export class FolderWatch {
	private watchers: FSWatcher[] = [];
	/** Which of the deck's synced folders are watched: one that comes later (a friend's first share, the first canvas) is watched from then on. */
	private watched = new Set<string>();
	private started = false;

	constructor(
		private readonly deck: string,
		private readonly store: SyncStore,
		private readonly scheduler: SyncScheduler,
		private readonly files: FileSync,
		private readonly pictures: PictureSync,
	) {}

	/** Watching begins, once the first pass is over. */
	start() {
		this.started = true;
		this.refresh();
	}

	/** Every synced folder there is now is watched: called after each pass, which may have made one. */
	refresh() {
		if (!this.started || this.scheduler.stopped) return;
		for (const top of ["canvases", SHARED_CANVASES, ...MIRRORED_PARTS, THUMBS]) {
			const dir = join(this.deck, top);
			if (this.watched.has(top) || !existsSync(dir)) continue;
			this.watched.add(top);
			this.watchers.push(watch(dir, { recursive: top !== THUMBS }, (_event, filename) => this.changed(top, filename === null ? null : String(filename))));
		}
	}

	close() {
		for (const w of this.watchers) w.close();
	}

	/** What a change in a watched folder asks for: the canvas it is in, or the canvases that use a deck file. */
	private changed(top: string, filename: string | null) {
		const scheduler = this.scheduler;
		if (!filename) {
			scheduler.fullDue = true;
			return scheduler.soon(300);
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
				scheduler.dirtyPictures.add(owner);
				scheduler.soon(1000);
			}
			return;
		} else {
			// A deck file: the canvases whose bundles hold it or whose cards point at it.
			const path = `${top}/${parts.join("/")}`;
			for (const [n, s] of Object.entries(this.store.state.canvases)) if (s.files[path] || this.files.pointsAt(n, path)) scheduler.dirtyFiles.add(n);
			return scheduler.soon(300);
		}
		if (!name) return;
		if (!this.store.state.canvases[name]) {
			// A canvas made here, or a folder not synced yet: a full pass takes it up.
			if (rest[0] === "canvas.pen") scheduler.fullDue = true;
			else return;
		} else if (rest.length === 0) scheduler.fullDue = true;
		else if (rest.length === 1 && rest[0] === "canvas.pen") scheduler.dirtyPens.add(name);
		else if (rest.length === 1) return; // canvas.json and the like: nothing Studio keeps.
		else scheduler.dirtyFiles.add(name);
		scheduler.soon(300);
	}
}
