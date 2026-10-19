import { diff, walk, type PenDocument, type PenNode } from "@decks/pen";
import { boardOf } from "./pens.ts";

/**
 * Who is watching which canvas (`decks.canvas.watch`), and the events each watcher has not read yet.
 *
 * A watch is one per agent and canvas. Every change to a watched canvas's file, by anyone, is
 * turned into events by comparing the file with the version last seen (`@decks/pen`'s `diff`), so
 * a hand edit of the file is news as much as a call is; a change to the content of a board that is
 * on the canvas is news too. Each event lands in the inbox of every agent watching that canvas,
 * except the one who made the change, and is read once with `decks.agent.inbox()`.
 *
 * Kept in memory: a restart forgets the watches, and an agent watches again when it needs to.
 * Events do not start a turn; an agent reads them when it asks. Both are the cautious choice: a
 * canvas busy with three agents would otherwise wake each of them on every stroke.
 */

export interface CanvasEvent {
	kind: "board.added" | "board.removed" | "board.moved" | "board.changed" | "drawing.changed";
	canvas: string;
	item?: string;
	/** Who made the change: an agent's name, "person", or "file" for a hand edit nobody claimed. */
	from: string;
	at: number;
}

/** How many unread events an inbox keeps; older ones fall off. */
const INBOX_LIMIT = 200;
/** How many events one change can make before the rest are said as one. */
const PER_CHANGE = 20;
/** How long a caller's claim to the next change of a canvas holds. */
const WRITER_MS = 3000;

export class Watches {
	/** agent id -> canvas -> when the watch began. */
	private readonly subs = new Map<string, Map<string, number>>();
	private readonly inboxes = new Map<string, CanvasEvent[]>();
	/** The last version of each watched canvas seen, to compare the next with. */
	private readonly seen = new Map<string, PenDocument>();
	/** Who said they are about to change a canvas. */
	private readonly writers = new Map<string, { by: string; until: number }>();
	/** The last revision of each board's file heard, so a move is not taken for an edit. */
	private readonly revs = new Map<string, number>();

	constructor(
		private readonly hooks: {
			/** An agent's name, to tell its own changes from others'. */
			nameOf(agentId: string): string | undefined;
			/** The canvases a board is on. */
			canvasesOf(path: string): string[];
			now?(): number;
		},
	) {}

	private now(): number {
		return this.hooks.now?.() ?? Date.now();
	}

	watch(agentId: string, canvas: string, doc: PenDocument, revs: Record<string, number> = {}): { canvas: string; watching: true; since: number } {
		for (const [path, rev] of Object.entries(revs)) if (!this.revs.has(path)) this.revs.set(path, rev);
		let mine = this.subs.get(agentId);
		if (!mine) this.subs.set(agentId, (mine = new Map()));
		const since = mine.get(canvas) ?? this.now();
		mine.set(canvas, since);
		if (!this.seen.has(canvas)) this.seen.set(canvas, structuredClone(doc));
		return { canvas, watching: true, since };
	}

	unwatch(agentId: string, canvas: string): { canvas: string; watching: false; since: number } {
		const since = this.subs.get(agentId)?.get(canvas) ?? this.now();
		this.subs.get(agentId)?.delete(canvas);
		if (![...this.subs.values()].some((one) => one.has(canvas))) this.seen.delete(canvas);
		return { canvas, watching: false, since };
	}

	/** The canvases an agent watches. */
	watching(agentId: string): string[] {
		return [...(this.subs.get(agentId)?.keys() ?? [])];
	}

	/** The next change to this canvas is `by`'s, for a few seconds. */
	writing(canvas: string, by: string): void {
		this.writers.set(canvas, { by, until: this.now() + WRITER_MS });
	}

	private writerOf(canvas: string): string {
		const claim = this.writers.get(canvas);
		if (claim && claim.until >= this.now()) return claim.by;
		return "file";
	}

	/** Unread events, oldest first; reading them empties the inbox. */
	take(agentId: string): CanvasEvent[] {
		const out = this.inboxes.get(agentId) ?? [];
		this.inboxes.delete(agentId);
		return out;
	}

	/** Events waiting, without reading them. */
	peek(agentId: string): readonly CanvasEvent[] {
		return this.inboxes.get(agentId) ?? [];
	}

	private deliver(canvas: string, events: CanvasEvent[]): void {
		if (events.length === 0) return;
		for (const [agentId, canvases] of this.subs) {
			if (!canvases.has(canvas)) continue;
			const name = this.hooks.nameOf(agentId);
			const theirs = events.filter((event) => event.from !== name && event.from !== agentId);
			if (theirs.length === 0) continue;
			const inbox = this.inboxes.get(agentId) ?? [];
			inbox.push(...theirs);
			if (inbox.length > INBOX_LIMIT) inbox.splice(0, inbox.length - INBOX_LIMIT);
			this.inboxes.set(agentId, inbox);
		}
	}

	/** A canvas's file changed, by anyone: what changed, as events for its watchers. */
	canvasChanged(canvas: string, doc: PenDocument): void {
		const before = this.seen.get(canvas);
		if (!before) return;
		this.seen.set(canvas, structuredClone(doc));
		const from = this.writerOf(canvas);
		this.writers.delete(canvas);
		const at = this.now();
		const boards = new Map<string, string>();
		const index = (list: readonly PenNode[]) => {
			for (const node of walk(list)) {
				const path = boardOf(node);
				if (path) boards.set(node.id, path);
			}
		};
		index(before.children);
		index(doc.children);
		const events: CanvasEvent[] = [];
		const said = new Set<string>();
		for (const edit of diff(before, doc)) {
			const id = "id" in edit ? edit.id : undefined;
			const path = id ? boards.get(id) : undefined;
			let event: CanvasEvent;
			if (path) {
				const kind = edit.op === "insert" ? "board.added" : edit.op === "remove" ? "board.removed" : "board.moved";
				event = { kind, canvas, item: path, from, at };
			} else event = { kind: "drawing.changed", canvas, ...(id ? { item: id } : {}), from, at };
			const key = `${event.kind}\u0000${event.item ?? ""}`;
			if (said.has(key)) continue;
			said.add(key);
			events.push(event);
		}
		if (events.length > PER_CHANGE) {
			const kept = events.slice(0, PER_CHANGE - 1);
			kept.push({ kind: "drawing.changed", canvas, item: `${events.length - kept.length} more items`, from, at });
			this.deliver(canvas, kept);
		} else this.deliver(canvas, events);
	}

	/** A board's file was written: news on every watched canvas it is on. */
	boardChanged(path: string, rev: number, by: string | undefined): void {
		const last = this.revs.get(path);
		this.revs.set(path, rev);
		// A board.changed that carries the revision already heard is a move or a resize, not an edit.
		if (last === rev || last === undefined) return;
		if (this.subs.size === 0) return;
		const from = (by && this.hooks.nameOf(by)) ?? (by === "you" ? "person" : by) ?? "file";
		const at = this.now();
		for (const canvas of this.hooks.canvasesOf(path)) this.deliver(canvas, [{ kind: "board.changed", canvas, item: path, from, at }]);
	}
}
