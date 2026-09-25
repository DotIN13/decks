import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relink } from "../deck/stage-boards.ts";
import { dirname, join } from "node:path";
import type { Board, DeckState, ServerMessage, AnyBoardPatch } from "@decks/protocol";
import { applyPatches, mintId, PatchRefused } from "./patch.ts";
import { Revisions } from "./snapshots.ts";
import { Authors, Seen } from "./authors.ts";
import {
	extensionFor,
	MIRROR_SIZE,
	renderBlank,
	renderSlides,
	renderMirror,
	renderWebBoard,
	slugFor,
	WEB_BOARD_SIZE,
	type BoardFormat,
} from "./templates.ts";
import type { Deck } from "../deck/loader.ts";
import { withBoardSize } from "../deck/meta.ts";

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
	/**
	 * The deck as the focused stage sees it — where every board on it sits for the conversation being
	 * looked at.
	 *
	 * The service holds the boards; it does not know what a stage is, and the loader's copy of a board
	 * has carried no place of its own since positions became per stage. So a broadcast asks for the
	 * arrangement rather than sending the board it happens to be holding — see `placed`.
	 */
	state(): DeckState;
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
	private readonly authors: Authors;
	private readonly seenAt: Seen;
	private readonly extents = new Map<string, { rev: number; w: number; h: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number }>();
	/** `stage.fit` calls waiting for the frame to load and report. */
	private readonly extentWaiters = new Set<{ path: string; rev: number; resolve: (extent: { w: number; h: number; page?: number } | undefined) => void }>();

	constructor(
		private deck: Deck,
		private readonly hooks: BoardHooks,
	) {
		this.revisions = new Revisions(deck);
		this.authors = new Authors(deck.path);
		this.seenAt = new Seen(deck.path);
		this.restamp();
	}

	/** Another data directory was opened, so the deck and its revision store move with it. */
	setDeck(deck: Deck): void {
		this.deck = deck;
		this.revisions.setDeck(deck);
		this.authors.setDeck(deck.path);
		this.seenAt.setDeck(deck.path);
		this.restamp();
		this.extents.clear();
	}

	/**
	 * Say who named a board, and when, and tell every browser if that is news.
	 *
	 * **Authorship is said, never detected.** A file event has no author, so nothing here reads
	 * one off the disk: an agent that fits, shows or reports a board through the stage tool is
	 * its writer (`stage/tool.ts`), and the canvas editor's patch is the person's. `who` is an
	 * agent id or `"you"`. Kept in `.decks/authors.json`, so the byline outlives a restart.
	 *
	 * The time is the act's own clock rather than the file's. `seen()` takes the later of the two
	 * because a read must never leave a mark behind; here the opposite is wanted, because an
	 * agent's `show` or `report` touches no file and the file's time would be somebody else's.
	 */
	wrote(path: string, who: string, now = Date.now()): void {
		const board = this.deck.board(path);
		if (!board) return;
		const changed = this.authors.say(path, who, now);
		if (board.lastWrittenBy === who && board.namedAt === now && !changed) return;
		board.lastWrittenBy = who;
		board.namedAt = now;
		const placed = this.hooks.state().boards.find((one) => one.path === path) ?? board;
		this.hooks.send({ type: "board.changed", path, rev: board.rev, board: { ...placed, lastWrittenBy: who, namedAt: now } });
	}

	/**
	 * The person looked at a board: read it on the canvas, or in the focus view.
	 *
	 * Stamped with the later of now and the board's own last time, so a clock that disagrees with
	 * the disk cannot leave a board marked that has just been read. Nothing is sent when the board
	 * was already read since it last changed, which is every press after the first.
	 *
	 * "Last changed" is the later of the file's time and the naming act (`wrote`), because that is
	 * what `isNews` reads. An agent that writes a board and then fits it names it *after* the
	 * file moved; a read that only looked at the file's time would refuse to stamp, and the board
	 * would stay news for ever.
	 */
	seen(path: string, now = Date.now()): void {
		const board = this.deck.board(path);
		if (!board) return;
		const last = Math.max(board.modifiedAt ?? 0, board.namedAt ?? 0);
		if ((board.seenAt ?? 0) >= last) return;
		const at = Math.max(now, last);
		this.seenAt.set(path, at);
		board.seenAt = at;
		const placed = this.hooks.state().boards.find((one) => one.path === path) ?? board;
		this.hooks.send({ type: "board.changed", path, rev: board.rev, board: { ...placed, seenAt: at } });
	}

	/** Put the stored bylines back on the deck's records: the loader re-describes boards from disk and knows no authors. */
	restamp(): void {
		for (const [path, author] of this.authors.entries()) {
			const board = this.deck.board(path);
			if (!board) continue;
			board.lastWrittenBy = author.who;
			if (author.at > 0) board.namedAt = author.at;
		}
		for (const [path, at] of this.seenAt.entries()) {
			const board = this.deck.board(path);
			if (board) board.seenAt = at;
		}
	}

	/**
	 * One board as the focused stage sees it.
	 *
	 * Every broadcast that carries a board goes through this, because the loader's board is a *file* — a
	 * revision, a size, a title — and has not carried a place of its own since positions became per
	 * stage. Sending it raw is a board at the origin, on every write, for everyone; the failure looks
	 * like "the drag did not stick" on one surface only, which is what makes it worth one function.
	 */
	private placed(board: Board): Board {
		return this.hooks.state().boards.find((one) => one.path === board.path) ?? board;
	}

	/**
	 * A reading from a frame: keep it, and wake anything waiting for one.
	 *
	 * Last writer wins, including when the numbers are for an older revision — two frames
	 * showing the same board agree, and a stale reading is filtered where it is read
	 * rather than hoarded here.
	 */
	noteExtent(path: string, extent: { rev: number; w: number; h: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number }): void {
		this.extents.set(path, extent);
		for (const waiter of [...this.extentWaiters]) {
			if (waiter.path !== path || waiter.rev !== extent.rev) continue;
			this.extentWaiters.delete(waiter);
			waiter.resolve({ w: extent.w, h: extent.h, ...(extent.page === undefined ? {} : { page: extent.page }) });
		}
	}

	/**
	 * The measurement for this board *at this revision*, or nothing.
	 *
	 * `h` is the room the content needs — the furthest edge of the root-level blocks, or the
	 * document's own height, whichever is greater — and `page` is that second number alone, so a
	 * caller can tell a board that ends in a placed box from one that ends in its own padding.
	 */
	extent(path: string, rev: number): { w: number; h: number; page?: number } | undefined {
		const extent = this.extents.get(path);
		return extent && extent.rev === rev ? { w: extent.w, h: extent.h, ...(extent.page === undefined ? {} : { page: extent.page }) } : undefined;
	}

	/** How many words the browser counted on this board at this revision, and its smallest type. */
	reading(path: string, rev: number): { words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number } {
		const extent = this.extents.get(path);
		return extent && extent.rev === rev ? { ...(extent.words === undefined ? {} : { words: extent.words }), ...(extent.minFont === undefined ? {} : { minFont: extent.minFont }), ...(extent.overflowX === undefined ? {} : { overflowX: extent.overflowX }), ...(extent.cut === undefined ? {} : { cut: extent.cut }), ...(extent.overlaps === undefined ? {} : { overlaps: extent.overlaps }) } : {};
	}

	/** Nobody is looking at that board any more, or it is gone. */
	/** A board left the deck by the disk rather than by the button: drop its reading and its byline. */
	forgetBoard(path: string): void {
		this.forgetExtent(path);
		this.authors.forget(path);
		this.seenAt.forget(path);
	}

	forgetExtent(path: string): void {
		this.extents.delete(path);
	}

	/**
	 * Wait for a frame to report this revision, giving up quietly.
	 *
	 * `undefined` rather than a rejection: "nobody is looking at that board" is an answer,
	 * and the caller (`stage.fit`) turns it into a sentence that says what to do about it.
	 */
	awaitExtent(path: string, rev: number, ms: number): Promise<{ w: number; h: number; page?: number } | undefined> {
		const ready = this.extent(path, rev);
		if (ready) return Promise.resolve(ready);
		return new Promise((resolve) => {
			const waiter = { path, rev, resolve };
			this.extentWaiters.add(waiter);
			//
			// **Not `unref`'d.** It was, to keep a pending measurement from holding the process
			// open — and that made "give up after `ms`" mean "give up after `ms`, or as soon as
			// nothing else is happening, whichever comes first". Nothing in the server noticed:
			// a request is an open socket, and an open socket already holds the loop. Two tests
			// in `app.test.ts` noticed on CI, where the file's other handles had gone by the time
			// they ran — the loop drained, Node exited, and both were reported `cancelledByParent`
			// / "Promise resolution is still pending" while passing here, where a stray handle
			// from another file kept the loop alive. A wait that ends early because nothing else
			// is happening is not the wait the caller asked for.
			const timer = setTimeout(() => {
				this.extentWaiters.delete(waiter);
				resolve(undefined);
			}, ms);
			timer.ref?.();
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
	/**
	 * Set a board's size by editing the one number in its own file.
	 *
	 * The same write `stage.resize` makes, here rather than in the stage service because this
	 * is the object that owns writing a board and recording a revision — a resize that skipped
	 * the record would be the one edit the time machine did not have.
	 *
	 * The format rules are the caller's, not this one's: a flow document's height is its
	 * content, and a deck's follows from its aspect, so those callers send one dimension.
	 */
	resize(path: string, size: { w?: number; h?: number }): Board {
		const board = this.deck.board(path);
		if (!board) throw new Error(`No such board: ${path}`);
		if (size.w === undefined && size.h === undefined) throw new Error("A resize needs a width, a height, or both");
		const html = readFileSync(this.deck.fileOf(path), "utf8");
		return this.writeBoard(path, withBoardSize(path, html, size));
	}

	writeBoard(path: string, html: string): Board {
		const file = this.deck.fileOf(path);
		writeFileSync(file, html);
		this.revisions.record(path, html);
		const board = this.deck.refresh(path);
		if (!board) throw new Error(`No such board: ${path}`);
		this.hooks.send({ type: "board.changed", path, rev: board.rev, board: this.placed(board) });
		return board;
	}

	/**
	 * Write a new board, blank, and return its deck-relative path (§2).
	 *
	 * The name is minted from the title and made unique by suffixing, so an agent answering
	 * three questions about the same thing gets `-2` and `-3` rather than an error.
	 */
	newBoard(options: { title: string; format?: BoardFormat; size?: { w?: number; h?: number }; folder?: string }): string {
		/*
		 * The extension comes from the format and from nowhere else.
		 *
		 * `deck/kinds.ts` reads a board's format back out of its name, so these two cannot be
		 * allowed to disagree: a file asked for as slides and written as `.html` would simply
		 * *be* a board, correctly, with nothing anywhere to say why. The board itself is
		 * always blank when it is created — there are no templates any more; the examples a
		 * board can be modelled on live in `examples/` beside the deck, refreshed on restart.
		 */
		const format = options.format ?? "board";
		const extension = extensionFor(format);
		const base = slugFor(options.title);
		// `boards/`, or a stage's own board folder for an isolated agent (`deck/stage-boards.ts`).
		const folder = options.folder ?? "boards";
		let path = `${folder}/${base}${extension}`;
		for (let suffix = 2; existsSync(join(this.deck.path, path)); suffix++) {
			path = `${folder}/${base}-${suffix}${extension}`;
			if (suffix > 200) throw new Error(`Too many boards called ${base}`);
		}

		const file = this.deck.fileOf(path);
		// Written for `boards/`, so re-pointed when it is made deeper.
		const html = relink(format === "slides" ? renderSlides(options.title, options.size) : renderBlank(options.title, options.size), "boards", folder);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, html);
		this.revisions.record(path, html);

		// The watcher would find it in 80ms; refreshing now means the caller can attach
		// and show it in the same turn without a race.
		const board = this.deck.refresh(path);
		if (board) this.hooks.send({ type: "board.changed", path, rev: board.rev, board: this.placed(board) });
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
		const path = `boards/mirrors/${slugFor(options.name || options.agentId, "mirror")}.html`;
		const file = this.deck.fileOf(path);
		// The same agent behind the same name: hand back the window that is already open.
		if (existsSync(file) && readFileSync(file, "utf8").includes(`data-agent="${options.agentId}"`)) return path;

		const html = renderMirror(options.name || "Conversation", options.agentId, options.size ?? MIRROR_SIZE);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, html);
		this.revisions.record(path, html);
		const board = this.deck.refresh(path);
		if (board) this.hooks.send({ type: "board.changed", path, rev: board.rev, board: this.placed(board) });
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
		if (board) this.hooks.send({ type: "board.changed", path, rev: board.rev, board: this.placed(board) });
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
		this.authors.forget(path);
		this.seenAt.forget(path);
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
	patch(path: string, rev: number, patches: AnyBoardPatch[], reply: (message: ServerMessage) => void): void {
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
		 * A board edited as its own source: the file's bytes, written whole.
		 *
		 * Handled before `applyPatches` rather than inside it, because that function is
		 * parse5 over an HTML document and this may be a markdown file: there is nothing to
		 * parse, address or splice. The write is the whole of the edit.
		 *
		 * It used to be refused for a board of placed boxes, on the grounds that replacing
		 * such a document from a textarea would work once and destroy it. That was the
		 * format talking: a board is a file, the source editor is opened deliberately (with
		 * ⌥, `canvas/Stage.tsx`), and every write here is recorded as a revision that undo
		 * can walk back. What is still refused is a source op *batched* with others, which
		 * could only mean two writers disagreeing about the same bytes.
		 */
		const source = patches.find((patch) => patch.op === "source");
		if (source) {
			if (patches.length > 1) {
				reply({
					type: "board.patched",
					path,
					rev: board.rev,
					refused: "A source edit replaces the whole file, so it cannot be batched with other changes.",
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
				this.hooks.send({ type: "deck.state", deck: this.hooks.state() });
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
				// The person's own act, named and timed like an agent's, so the canvas knows it is
				// not news to them rather than reading it off the file they just moved.
				this.wrote(path, "you");
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
			if (updated) this.hooks.send({ type: "board.changed", path, rev: updated.rev, board: this.placed(updated) });
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
