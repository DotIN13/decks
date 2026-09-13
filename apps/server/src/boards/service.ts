import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Board, BoardPatch, ServerMessage } from "@decks/protocol";
import { applyPatches, mintId, PatchRefused } from "./patch.ts";
import { Revisions } from "./snapshots.ts";
import {
	extensionFor,
	MIRROR_SIZE,
	renderFormat,
	renderMirror,
	renderTemplate,
	renderWebBoard,
	slugFor,
	WEB_BOARD_SIZE,
	type BoardFormat,
	type BoardTemplate,
} from "./templates.ts";
import type { Deck } from "../deck/loader.ts";

/**
 * What the shell has to do for the board service, and nothing else.
 *
 * The service owns files and revisions; who hears about a change is the shell's business.
 * Narrowed to an interface rather than handed the `Registry`, for the reason
 * `agents/backend.ts` narrows its account switcher: the boards layer should not know what
 * an agent is, only that something wants telling.
 */
export interface BoardHooks {
	/** To every browser. `board.changed` is the message this service exists to send. */
	send(message: ServerMessage): void;
	/** The user committed an edit — the agent holding that board is told (§6.5). */
	edited(path: string, summary: string): void;
	/** A board is gone: every agent must drop it, or a dead path empties the rail. */
	removed(path: string): void;
}

/**
 * The board files: writing them, revisioning them, editing them, and deleting them.
 *
 * This was 340 lines of `app.ts` sitting between the WebSocket router and the account
 * panel, and it is the only part of the server that writes a file a person did not name.
 * It is a service for three reasons that showed up separately:
 *
 * - **A board write and its revision are one act.** Every path that writes a board also
 *   records it — `newBoard`, `newMirror`, `newWebBoard`, `patch`, `undo` — and the one
 *   place that got it wrong (`boards.restore`, which wrote without recording) was the bug
 *   the split made visible.
 * - **The extent bookkeeping is a browser fact, not a deck fact.** What a frame measured is
 *   kept here so `stage.fit` can await it, and it is deliberately not in the deck record: a
 *   headless server has no readings, and the deck is what is on disk.
 * - **It is where a stale write is refused.** A patch carries the revision it was composed
 *   against, and that comparison is the guard that stops an agent's work being silently
 *   undone by a drag that started before it.
 *
 * The hooks are the only way out: this class does not broadcast anything itself, because
 * what a `board.changed` means is different for a browser and for an agent.
 */
export class BoardService {
	readonly revisions: Revisions;
	private readonly extents = new Map<string, { rev: number; w: number; h: number }>();
	/** `stage.fit` calls waiting for the frame to load and report. */
	private readonly extentWaiters = new Set<{ path: string; rev: number; resolve: (extent: { w: number; h: number } | undefined) => void }>();

	constructor(
		private deck: Deck,
		private readonly hooks: BoardHooks,
	) {
		this.revisions = new Revisions(deck);
	}

	/** Another data directory was opened, so the deck and its revision store move with it. */
	setDeck(deck: Deck): void {
		this.deck = deck;
		this.revisions.setDeck(deck);
		this.extents.clear();
	}

	/**
	 * A reading from a frame: keep it, and wake anything waiting for one.
	 *
	 * Last writer wins, including when the numbers are for an older revision — two frames
	 * showing the same board agree, and a stale reading is filtered where it is read
	 * rather than hoarded here.
	 */
	noteExtent(path: string, extent: { rev: number; w: number; h: number }): void {
		this.extents.set(path, extent);
		for (const waiter of [...this.extentWaiters]) {
			if (waiter.path !== path || waiter.rev !== extent.rev) continue;
			this.extentWaiters.delete(waiter);
			waiter.resolve({ w: extent.w, h: extent.h });
		}
	}

	/** The measurement for this board *at this revision*, or nothing. */
	extent(path: string, rev: number): { w: number; h: number } | undefined {
		const extent = this.extents.get(path);
		return extent && extent.rev === rev ? { w: extent.w, h: extent.h } : undefined;
	}

	/** Nobody is looking at that board any more, or it is gone. */
	forgetExtent(path: string): void {
		this.extents.delete(path);
	}

	/**
	 * Wait for a frame to report this revision, giving up quietly.
	 *
	 * `undefined` rather than a rejection: "nobody is looking at that board" is an answer,
	 * and the caller (`stage.fit`) turns it into a sentence that says what to do about it.
	 */
	awaitExtent(path: string, rev: number, ms: number): Promise<{ w: number; h: number } | undefined> {
		const ready = this.extent(path, rev);
		if (ready) return Promise.resolve(ready);
		return new Promise((resolve) => {
			const waiter = { path, rev, resolve };
			this.extentWaiters.add(waiter);
			const timer = setTimeout(() => {
				this.extentWaiters.delete(waiter);
				resolve(undefined);
			}, ms);
			timer.unref?.();
		});
	}

	/**
	 * Write a board's file and tell everyone — the path a *changed* board takes, as
	 * `newBoard` is the path a new one takes.
	 *
	 * Deliberately not left to the watcher. The watcher would get there in 80ms and the
	 * caller would have to wait to see its own write; refreshing here means a `resize`
	 * returns the board as it now is, and the browser is told once rather than twice
	 * (the watcher's event finds the same bytes and the same revision, and says nothing).
	 */
	writeBoard(path: string, html: string): Board {
		const file = this.deck.fileOf(path);
		writeFileSync(file, html);
		this.revisions.record(path, html);
		const board = this.deck.refresh(path);
		if (!board) throw new Error(`No such board: ${path}`);
		this.hooks.send({ type: "board.changed", path, rev: board.rev, board });
		return board;
	}

	/**
	 * Write a new board from a template, and return its deck-relative path (§2).
	 *
	 * The name is minted from the title and made unique by suffixing, so an agent answering
	 * three questions about the same thing gets `-2` and `-3` rather than an error.
	 */
	newBoard(options: { title: string; template: BoardTemplate; format?: BoardFormat; size?: { w?: number; h?: number } }): string {
		/*
		 * The extension comes from the format and from nowhere else.
		 *
		 * `deck/kinds.ts` reads a board's format back out of its name, so these two cannot be
		 * allowed to disagree: a file asked for as slides and written as `.md` would simply
		 * *be* a flow board, correctly, with nothing anywhere to say why.
		 */
		const format = options.format ?? "component";
		const extension = extensionFor(format);
		const base = slugFor(options.title, options.template);
		let path = `boards/${base}${extension}`;
		for (let suffix = 2; existsSync(join(this.deck.path, path)); suffix++) {
			path = `boards/${base}-${suffix}${extension}`;
			if (suffix > 200) throw new Error(`Too many boards called ${base}`);
		}

		const file = this.deck.fileOf(path);
		/*
		 * The shape only applies to a component board. A slide deck and a markdown document
		 * are already the shape they are — there is no `report`-flavoured deck — so the
		 * template argument is ignored for them rather than being refused, which keeps
		 * `newBoard({ format: "slides" })` from needing a second argument nobody would set.
		 */
		const html = format === "component" ? renderTemplate(options.template, options.title, options.size) : renderFormat(format, options.title, options.size);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, html);
		this.revisions.record(path, html);

		// The watcher would find it in 80ms; refreshing now means the caller can attach
		// and show it in the same turn without a race.
		const board = this.deck.refresh(path);
		if (board) this.hooks.send({ type: "board.changed", path, rev: board.rev, board });
		return path;
	}

	/**
	 * Write a mirror: a board that is a live view of one agent's conversation.
	 *
	 * Beside `newBoard` rather than inside it, because a mirror is not a shape of document
	 * but a *kind* of board — the file is a stub and its content never comes from disk
	 * (`boards/templates.ts`, `lib/live-chat.js`). Kept in `boards/mirrors/` so a deck full
	 * of them still reads as a deck: they are views, and views belong together.
	 *
	 * One per agent, deliberately. Asking for a mirror of somebody already mirrored hands
	 * back the board that exists rather than a second window onto the same conversation —
	 * which is also what makes the menu item safe to press twice.
	 */
	newMirror(options: { agentId: string; name: string; size?: { w?: number; h?: number } }): string {
		const path = `boards/mirrors/${slugFor(options.name || options.agentId, "blank")}.html`;
		const file = this.deck.fileOf(path);
		// The same agent behind the same name: hand back the window that is already open.
		if (existsSync(file) && readFileSync(file, "utf8").includes(`data-agent="${options.agentId}"`)) return path;

		const html = renderMirror(options.name || "Conversation", options.agentId, options.size ?? MIRROR_SIZE);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, html);
		this.revisions.record(path, html);
		const board = this.deck.refresh(path);
		if (board) this.hooks.send({ type: "board.changed", path, rev: board.rev, board });
		return path;
	}

	/**
	 * The status board for the shared Chrome: one per deck, made when first asked for.
	 *
	 * A stub like a mirror — `data-live="web"` and nothing else — fed from the `web.status`
	 * the browser already holds. Asking again hands back the board that exists.
	 */
	newWebBoard(): string {
		const path = "boards/your-chrome.html";
		const file = this.deck.fileOf(path);
		if (existsSync(file) && readFileSync(file, "utf8").includes('data-live="web"')) return path;
		const html = renderWebBoard(WEB_BOARD_SIZE);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, html);
		this.revisions.record(path, html);
		const board = this.deck.refresh(path);
		if (board) this.hooks.send({ type: "board.changed", path, rev: board.rev, board });
		return path;
	}

	/**
	 * Delete a board: keep a copy of what it said, unlink it, and tell everyone.
	 *
	 * The order is the whole of it. **A last revision first**, because the point of
	 * `.decks/revisions` is that a version the server has seen is on disk under its sha —
	 * and the version that matters most is the one somebody just deleted. If the file has
	 * been edited outside the app since the last record, that edit is otherwise the one
	 * version never kept.
	 *
	 * Then `Deck.remove`, which owns both the file and the map it is in, and which refuses a
	 * path that climbs out of the deck. Then the agents, because a dead path left in a
	 * context silently empties the rail and the canvas — the watcher would do this ~80ms later
	 * off the filesystem event, and doing it here means the row is gone under the cursor that
	 * pressed it rather than after a visible beat. The message it sends is the same message
	 * the watcher would, so the duplicate that follows is a no-op.
	 *
	 * A refusal is a notice to the browser that asked, not a throw: this arrives from a
	 * button, and the two ways it fails — a path with no board, and a file the OS will not
	 * unlink — are both things the person pressing it should read rather than a stack trace
	 * in a log they do not have.
	 */
	deleteBoard(path: string, reply: (message: ServerMessage) => void): void {
		if (!this.deck.board(path)) {
			reply({ type: "notice", level: "warn", text: `There is no board at ${path} to delete.` });
			return;
		}
		this.recordRevision(path);
		try {
			this.deck.remove(path);
		} catch (error) {
			reply({ type: "notice", level: "error", text: `Could not delete ${path}: ${(error as Error).message}` });
			return;
		}
		this.hooks.removed(path);
		this.forgetExtent(path);
		this.hooks.send({ type: "board.changed", path, rev: 0, removed: true });
	}

	/** Store a board's current bytes as a revision; used right after an agent writes. */
	recordRevision(path: string): string | undefined {
		try {
			return this.revisions.record(path, readFileSync(this.deck.fileOf(path), "utf8"));
		} catch {
			return undefined;
		}
	}

	/**
	 * An absolute (or relative) file an agent wrote -> the board it is, if it is one.
	 *
	 * Agents write with absolute paths as often as not, and only paths inside
	 * `boards/` are boards — an agent editing `lib/board.css` has not produced a new
	 * revision of anything.
	 */
	boardPathOf(file: string): string | undefined {
		const relative = file.startsWith(this.deck.path)
			? file.slice(this.deck.path.length).replace(/^\/+/, "")
			: file.replace(/^\.\//, "");
		const normalized = relative.split("\\").join("/");
		return this.deck.board(normalized) ? normalized : undefined;
	}

	/**
	 * Apply a user's edit to a board file (§6.5).
	 *
	 * The `rev` the browser composed against is a precondition, not decoration: if
	 * the agent wrote the file mid-drag, applying anyway would silently undo its work
	 * — the bug that looks like a haunting. A refusal carries the current rev so the
	 * browser can re-read the frame and decide whether the gesture still means
	 * anything.
	 */
	patch(path: string, rev: number, patches: BoardPatch[], reply: (message: ServerMessage) => void): void {
		const board = this.deck.board(path);
		if (!board) {
			reply({ type: "board.patched", path, rev: 0, refused: `No such board: ${path}` });
			return;
		}
		if (board.rev !== rev) {
			reply({
				type: "board.patched",
				path,
				rev: board.rev,
				refused: "That board changed while you were editing it, so it is being re-read.",
			});
			return;
		}

		const file = this.deck.fileOf(path);

		/*
		 * A flow or slides board is edited as its own source.
		 *
		 * Handled before `applyPatches` rather than inside it, because that function is
		 * parse5 over an HTML document and this is a markdown file: there is nothing to
		 * parse, address or splice. The write is the whole of the edit.
		 *
		 * A `source` op against a component board is refused rather than obeyed. Writing a
		 * textarea's contents over a board of positioned components would work exactly once
		 * and destroy the document — and the refusal is the sort a person can act on,
		 * because it says which editor the board actually has.
		 */
		const source = patches.find((patch) => patch.op === "source");
		if (source) {
			if (patches.length > 1 || board.format === "component") {
				reply({
					type: "board.patched",
					path,
					rev: board.rev,
					refused:
						board.format === "component"
							? "That board is made of components; drag and retype them instead of replacing the file."
							: "A source edit replaces the whole file, so it cannot be batched with other changes.",
				});
				return;
			}
			try {
				const before = readFileSync(file, "utf8");
				if (source.text === before) {
					reply({ type: "board.patched", path, rev: board.rev });
					return;
				}
				writeFileSync(file, source.text);
				this.revisions.record(path, source.text);
				this.deck.resync();
				reply({ type: "board.patched", path, rev: this.deck.board(path)?.rev ?? board.rev });
				this.hooks.send({ type: "deck.state", deck: this.deck.state() });
			} catch (error) {
				reply({ type: "board.patched", path, rev: board.rev, refused: (error as Error).message });
			}
			return;
		}

		try {
			const before = readFileSync(file, "utf8");
			/*
			 * Ids are minted here, not in the browser.
			 *
			 * A name has to be unique against the file as it is now, and only the server
			 * has that — two tabs inserting at once would otherwise both pick
			 * `sticky-3`, and the second insert would be refused for a reason that reads
			 * like a bug. Handed to `applyPatches` as a function rather than applied to
			 * the batch first, so each insert is named against the file the one before it
			 * produced: dropping two files on a board is one batch of two inserts.
			 */
			const { html, summary } = applyPatches(before, patches, mintId);
			if (html === before) {
				reply({ type: "board.patched", path, rev: board.rev });
				return;
			}
			writeFileSync(file, html);
			this.revisions.record(path, html);
			const updated = this.deck.refresh(path);
			// `board.changed` will also arrive from the watcher; this one is immediate,
			// so the browser's optimistic edit is confirmed without waiting on the disk.
			this.hooks.send({ type: "board.patched", path, rev: updated?.rev ?? board.rev });
			if (updated) {
				updated.lastWrittenBy = "you";
				this.hooks.send({ type: "board.changed", path, rev: updated.rev, board: updated });
			}
			this.hooks.edited(path, summary.join(", "));
		} catch (error) {
			const text = error instanceof PatchRefused ? error.message : `Could not apply that edit: ${(error as Error).message}`;
			reply({ type: "board.patched", path, rev: board.rev, refused: text });
		}
	}

	/**
	 * Undo the last change to a board, whoever made it.
	 *
	 * One mechanism for both authors, because the store holds both (§6.7). Undoing
	 * writes the previous revision back rather than reversing the edit: there is no
	 * inverse of "the agent rewrote this file", but there is a copy of what it said
	 * before.
	 */
	undo(path: string, reply: (message: ServerMessage) => void): void {
		const previous = this.revisions.previous(path);
		if (!previous) {
			reply({ type: "notice", level: "info", text: "Nothing further to undo on this board." });
			return;
		}
		try {
			const content = this.revisions.read(previous);
			writeFileSync(this.deck.fileOf(path), content);
			this.revisions.pop(path);
			const updated = this.deck.refresh(path);
			if (updated) this.hooks.send({ type: "board.changed", path, rev: updated.rev, board: updated });
			this.hooks.send({ type: "board.patched", path, rev: updated?.rev ?? 0 });
		} catch (error) {
			reply({ type: "error", text: `Could not undo: ${(error as Error).message}` });
		}
	}

	/**
	 * Which revision each board was at, at a point in a conversation.
	 *
	 * The session's `board-rev` entries answer this for boards the conversation has
	 * touched. For the rest, the store answers by time: the newest version that
	 * already existed when that message was sent. A board created later resolves to
	 * its first version rather than "did not exist" — a real past state, and closer to
	 * the truth than showing today's file.
	 *
	 * One implementation, because the preview and the restore have to agree. They did
	 * not, when this lived in two places: hovering showed the past and restoring said
	 * there was nothing to do.
	 */
	boardsAt(
		agent: { revisionsAt(entryId: string): Record<string, string>; timeline(): Array<{ id: string; at?: number }> },
		entryId: string,
	): Record<string, string> {
		const recorded = agent.revisionsAt(entryId);
		const when = agent.timeline().find((entry) => entry.id === entryId)?.at ?? Date.now();
		const at: Record<string, string> = {};
		for (const board of this.deck.boards) {
			const sha = recorded[board.path] ?? this.revisions.at(board.path, when);
			if (sha) at[board.path] = sha;
		}
		return at;
	}
}
