import { applyEdits, type PenDocument, type PenEdit } from "@decks/pen";
import type { Changes, LiveEvent } from "@decks/sync-protocol";

/**
 * The page's side of a shared canvas (browser-safe: no Node), for any site on the hub.
 *
 * How an open canvas keeps in step with Studio without downloading the drawing: Studio says what
 * each revision changed, in the live message or as `changes?since=`, and the page applies it to the
 * drawing it already has. The whole drawing comes only when Studio's log no longer reaches back.
 *
 * The page's own edits are shown at once and sent in order. Studio answers each with its revision
 * and the one it went onto (`base`): when that is the page's own, nothing else happened meanwhile and
 * the drawing is already right. The page's own revisions are known by its `client` name, in the
 * answer and in the live message, so they are never applied twice. Someone else's edit that arrives
 * while one of the page's is on its way is shown under it: Studio applies the page's after, so a
 * field both set keeps the page's value, here as there.
 */
export interface FollowerHost {
	/** The drawing as the page has it now. */
	doc(): PenDocument;
	/** A newer drawing, and the revisions' edits that made it (empty when it came whole). */
	show(doc: PenDocument, came: PenEdit[][]): void;
	changes(since: number): Promise<Changes>;
	whole(): Promise<{ rev: number; pen: PenDocument }>;
}

type CanvasEvent = Extract<LiveEvent, { type: "canvas" }>;
type Answer = { rev: number; base?: number; changes?: unknown[]; adjusted: number; dropped: number };

export class CanvasFollower {
	/** The revision the page's drawing is at, besides its own edits still on their way. */
	rev: number;
	/** The page's own edits sent and not yet answered, oldest first. */
	private unanswered: PenEdit[][] = [];
	/** Revisions that are the page's own: already in its drawing. */
	private own = new Set<number>();
	private catching: Promise<void> | undefined;
	private again = false;
	private wantWhole = false;
	/** What it fetched, for the bench and the tests. */
	readonly fetched = { changes: 0, whole: 0 };

	constructor(
		private readonly host: FollowerHost,
		rev: number,
		readonly client: string,
	) {
		this.rev = rev;
	}

	/** The page's own edits, about to go: the body to send. */
	sending(edits: PenEdit[]): { base: number; edits: PenEdit[]; client: string } {
		this.unanswered.push(edits);
		return { base: this.rev, edits, client: this.client };
	}

	/** Studio's answer to the oldest edits sent. */
	answered(r: Answer) {
		this.unanswered.shift();
		if (r.changes?.length) this.own.add(r.rev);
		// Studio changed them to fit (an item gone, a sibling moved): its drawing is not the page's, so it comes whole.
		if (r.adjusted || r.dropped) return void this.catchUp(true);
		if (r.rev <= this.rev) return;
		if (r.base === this.rev) this.rev = r.rev;
		else void this.catchUp();
	}

	/** The oldest edits sent were not taken: the page shows them, Studio does not have them. */
	failed() {
		this.unanswered.shift();
		void this.catchUp(true);
	}

	/** A live message about this canvas. */
	heard(e: CanvasEvent) {
		if (e.client !== undefined && e.client === this.client) {
			this.own.add(e.rev);
			if (e.rev > this.rev) {
				if (e.base === this.rev) this.rev = e.rev;
				else void this.catchUp();
			}
			return;
		}
		if (e.rev <= this.rev) return;
		if (!this.catching && e.changes && e.base === this.rev) {
			this.apply([e.changes as unknown as PenEdit[]]);
			this.rev = e.rev;
			return;
		}
		void this.catchUp();
	}

	/** A whole drawing that arrived another way (the canvas fetched again): taken when it is newer. */
	adopt(rev: number, pen: PenDocument): boolean {
		if (rev <= this.rev) return false;
		this.showWhole(rev, pen);
		return true;
	}

	/** When what is being fetched has come. */
	settled(): Promise<void> {
		return this.catching ?? Promise.resolve();
	}

	/** Fetch what the page has missed: the changes since its revision, or the whole drawing. */
	catchUp(whole = false): Promise<void> {
		this.wantWhole ||= whole;
		if (this.catching) {
			this.again = true;
			return this.catching;
		}
		this.catching = (async () => {
			do {
				this.again = false;
				const asWhole = this.wantWhole;
				this.wantWhole = false;
				try {
					const got = asWhole ? undefined : await this.host.changes(this.rev);
					this.fetched.changes += asWhole ? 0 : 1;
					if (got && "changes" in got) {
						const since = this.rev;
						const lists = (got.changes as unknown as PenEdit[][]).filter((_, i) => !this.own.has(since + 1 + i));
						if (lists.length) this.apply(lists);
						this.rev = Math.max(this.rev, got.rev);
					} else {
						const w = await this.host.whole();
						this.fetched.whole++;
						this.showWhole(w.rev, w.pen, true);
					}
				} catch {
					// Offline for a moment: the next message or reconnection asks again.
				}
			} while (this.again);
			this.catching = undefined;
			for (const r of this.own) if (r <= this.rev - 1000) this.own.delete(r);
		})();
		return this.catching;
	}

	private showWhole(rev: number, pen: PenDocument, force = false) {
		if (!force && rev <= this.rev) return;
		// The page's own edits on their way are not in Studio's drawing yet: kept on top of it.
		const mine = this.unanswered.flat();
		this.host.show(mine.length ? loosely(pen, mine) : pen, []);
		this.rev = rev;
	}

	private apply(lists: PenEdit[][]) {
		let doc = this.host.doc();
		for (const edits of lists) doc = loosely(doc, edits);
		// Studio applies the page's edits on their way after these: a field both set keeps the page's.
		const touched = new Set(lists.flat().map(fieldOf));
		const mine = this.unanswered.flat().filter((e) => (e.op === "set" || e.op === "meta" || e.op === "place") && touched.has(fieldOf(e)));
		if (mine.length) doc = loosely(doc, mine);
		this.host.show(doc, lists);
	}
}

const fieldOf = (e: PenEdit): string => (e.op === "meta" ? `meta:${e.key}` : e.op === "set" ? `${e.id}:${e.key}` : e.op === "place" ? `${e.id}:place` : `${e.id}:`);

/** Edits applied as far as they fit: an insert of an item already there, or an edit to one gone, is left out. */
export function loosely(doc: PenDocument, edits: readonly PenEdit[]): PenDocument {
	const ids = new Set<string>();
	const visit = (list: readonly { id: string; children?: unknown }[]) => {
		for (const n of list) {
			ids.add(n.id);
			if (Array.isArray(n.children)) visit(n.children as never);
		}
	};
	visit(doc.children ?? []);
	const fits = edits.filter((e) => e.op !== "insert" || !ids.has(e.id));
	try {
		return applyEdits(doc, fits);
	} catch {
		let out = doc;
		for (const edit of fits) {
			try {
				out = applyEdits(out, [edit]);
			} catch {
				/* an item gone */
			}
		}
		return out;
	}
}
