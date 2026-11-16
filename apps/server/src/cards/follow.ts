import type { DeckState, Page, ServerMessage } from "@decks/protocol";
import type { Deck } from "../deck/loader.ts";
import { watchDeck } from "../deck/watcher.ts";
import type { CardService } from "./service.ts";

/**
 * Following the deck's files: what changed on disk becomes what the pages are told.
 *
 * A card is a file, written by an agent's own tools, by an editor, by a shell redirect: nobody
 * tells the harness. So the deck's folder is watched, and each change is recorded as a revision
 * and announced; and because a watcher is a promise the operating system does not quite make,
 * the disk is also read slowly under it.
 */

/**
 * How often the deck re-reads its boards from disk regardless of what the watcher said.
 *
 * Slow enough that it is free (a walk and a `stat` per board), fast enough that a missed
 * event is a beat rather than a session.
 */
const RESYNC_MS = 4000;

/** What following the deck needs of the harness. */
export interface FollowHost {
	/** The deck open now: asked each time, since another can be opened. */
	deck(): Deck;
	boards: CardService;
	send(message: ServerMessage): void;
	/** The deck as the conversation on screen sees it, and one card so. */
	state(): DeckState;
	placed(card: Page): Page;
	/** A card's file was written: whoever was holding it with a write or edit tool is done. */
	landed(path: string): void;
	/** A card's file is gone: it leaves every agent's hold with it, or a dead path silently empties their lists. */
	gone(path: string): void;
}

/** Follow the deck's files until the answer is called. */
export function followDeck(of: FollowHost): () => void {
	/**
	 * Re-read the boards directory and tell everyone what moved.
	 *
	 * The same two messages the watcher's own branch sends, from the same place, so a
	 * board that arrives this way is indistinguishable from one the watcher caught.
	 */
	const resync = (): void => {
		const { changed, removed } = of.deck().resync();
		for (const board of changed) {
			of.boards.recordRevision(board.path);
			of.send({ type: "card.changed", path: board.path, rev: board.rev, card: of.placed(board) });
		}
		for (const path of removed) {
			// A dead path left in a context silently empties the rail and the canvas.
			of.gone(path);
			of.boards.forgetBoard(path);
			of.send({ type: "card.changed", path, rev: 0, removed: true });
		}
	};

	const unwatch = watchDeck(of.deck().path, (change) => {
			if (change.kind === "rescan") {
				// A rename went past, or the watcher was replaced. Either way what we
				// were told is no longer trustworthy, so ask the disk.
				resync();
				return;
			}
			if (change.kind === "deck") {
				/*
				 * A hand edit, always: **the app never writes `deck.json`** any more, so there is no echo of
				 * its own to tell apart from somebody's. A place belongs to a stage and a size belongs to the
				 * board's file, so the only things left in here — the name, the roots, and an older build's
				 * arrangement — are the user's to change.
				 */
				of.deck().reload();
				of.boards.restamp();
				of.send({ type: "deck.changed", deck: of.state() });
				return;
			}
			if (change.kind === "board") {
				const board = of.deck().refresh(change.path);
				// Whoever wrote it — the agent, an editor, a shell redirect — this is the
				// moment the new version exists, so this is where it is recorded.
				if (board) {
					try {
						of.boards.recordRevision(change.path);
						// Whoever was holding this board with a write or edit tool is done, and the diff says what changed.
						of.landed(change.path);
					} catch {
						/* the file went away between the event and the read */
					}
				}
				// A board that is gone must leave every agent's context with it, or the
				// dead path silently empties the rail and the canvas (DeckAgent.forget).
				if (!board) {
					of.gone(change.path);
					of.boards.forgetBoard(change.path);
				}
				of.send(
					board
						? { type: "card.changed", path: change.path, rev: board.rev, card: of.placed(board) }
						: { type: "card.changed", path: change.path, rev: 0, removed: true },
				);
				return;
			}
			// An asset under the deck moved. A board may be showing it, and the frame
			// has no way to know, so every board reloads — cheap, and rare.
			of.send({ type: "deck.changed", deck: of.state() });
		});

		/*
		 * And a slow reading of the disk under all of it.
		 *
		 * The watcher is a promise the operating system does not quite make: events are
		 * dropped under load, a recursive arm can end up pointed at a replaced inode, and
		 * a deck on a network filesystem may produce nothing at all. None of that is
		 * recoverable from the inside, and the failure is silent — the canvas simply stops
		 * agreeing with the files.
		 *
		 * So every few seconds the deck stats its boards and reports what actually moved.
		 * It costs a directory walk and one `stat` per board, it reads nothing that has
		 * not changed, and it says nothing when nothing has. `unref` so it never holds a
		 * process open, which matters for the tests and for a headless run.
		 */
	const timer = setInterval(() => resync(), RESYNC_MS);
	timer.unref?.();
	return () => {
		unwatch();
		clearInterval(timer);
	};
}
