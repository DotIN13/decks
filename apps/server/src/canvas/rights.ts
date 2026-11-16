import { readFileSync } from "node:fs";
import { CANVAS_META } from "./canvas-files.ts";
import { join } from "node:path";
import { parse, PenError, read } from "@decks/pen";
import { isSharedCanvas, sharedParts, viewOnlySentence } from "@decks/hub/layout";
import type { StagePens } from "./pens.ts";

/**
 * Whose a canvas is, and what you may do to it.
 *
 * A canvas of your own is yours to change. One you shared through Decks Studio is still yours, with
 * others on it. A friend's, shared with you, lives under `shared/canvases/<owner>/<canvas>/` and
 * says in its `canvas.json` whether you may edit it or only view it: a canvas shared to view follows
 * its owner's copy, and every write to it is refused with a sentence that says how to make a copy.
 */

export class CanvasRights {
	constructor(private readonly of: StagePens) {}

	/** The Studio canvas a canvas of this deck is synced with, when it is (`studio/sync.ts` writes it in `canvas.json`). */
	studioId(name: string): string | undefined {
		try {
			const meta = JSON.parse(readFileSync(join(this.of.folderOf(name), CANVAS_META), "utf8")) as { studio?: unknown };
			return typeof meta.studio === "string" ? meta.studio : undefined;
		} catch {
			return undefined;
		}
	}

	/** Refused, with a sentence, for a friend's canvas shared with you to view: its drawing follows theirs. */
	mayWrite(name: string): void {
		const shared = this.sharing(name);
		if (shared && shared.role !== "edit") throw new PenError(viewOnlySentence(this.of.titleOf(name), shared.ownerName ?? shared.owner, name));
	}

	/** Whether a canvas is a friend's, shared with this deck: read here, written back only when they let you edit it. */
	isShared(name: string): boolean {
		return isSharedCanvas(name);
	}

	/**
	 * Who shared a friend's canvas, and as what (`canvas.json`, written by the sync when it came down,
	 * `studio/sync.ts`); undefined for one of this deck's own.
	 */
	/**
	 * Whether a canvas is yours alone, so what is on it may act as you: not a friend's (`shared/…`), and
	 * not one of yours that Studio says someone else may edit (`othersEdit` in its `canvas.json`, written by
	 * the sync). An app placed on it runs inside the canvas frame only then (`auth/passes.ts`).
	 */
	yoursAlone(name: string): boolean {
		if (sharedParts(name)) return false;
		try {
			const meta = JSON.parse(readFileSync(join(this.of.folderOf(name), CANVAS_META), "utf8")) as { othersEdit?: unknown };
			return meta.othersEdit !== true;
		} catch {
			return true;
		}
	}

	sharing(name: string): { owner: string; ownerName?: string; role: "edit" | "view"; studio?: string } | undefined {
		const parts = sharedParts(name);
		if (!parts) return undefined;
		let meta: { shared?: { ownerName?: unknown; role?: unknown; studio?: unknown } } = {};
		try {
			meta = JSON.parse(readFileSync(join(this.of.folderOf(name), CANVAS_META), "utf8")) as typeof meta;
		} catch {
			/* no record: read only */
		}
		const role = meta.shared?.role === "edit" ? "edit" : "view";
		return { owner: parts.owner, ...(typeof meta.shared?.ownerName === "string" ? { ownerName: meta.shared.ownerName } : {}), role, ...(typeof meta.shared?.studio === "string" ? { studio: meta.shared.studio } : {}) };
	}
}
