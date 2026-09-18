/** The open deck: the boards, where they sit, and the roots an embed may reach. */

import type { AgentKind } from "./chat.ts";

/** A directory the deck declares readable, so an embed can reach outside it. */
export interface Root {
	path: string;
	writable: boolean;
	/** Resolved and checked at load; a root that is not there is listed, not dropped. */
	exists: boolean;
}

/**
 * One board, as the browser needs it.
 *
 * `x`/`y` come from `deck.json` — where a board sits is a property of the
 * arrangement. `w`/`h` come from the board's own `<meta name="board">`, or from
 * measuring the document when it says nothing: how big a page is, is a property
 * of the page.
 */
/**
 * What the person has set for the whole deck, kept by the server rather than by a browser.
 *
 * `timezone` is an IANA name such as "America/Los_Angeles". The server adopts it as its own
 * clock, schedules with no zone of their own are read in it, agents are told it, and the
 * app draws every time in it. Absent means nobody has chosen: the machine's zone is in force.
 */
export interface DeckSettings {
	timezone?: string;
	/**
	 * The runtime the dashboard's dispatcher is, chosen in the dashboard's bar. Absent means
	 * the server's default. A runtime is fixed when an agent is made, so choosing another one
	 * here means a different dispatcher answers the bar, with its own models.
	 */
	dispatcherKind?: AgentKind;
}

export interface Board {
	/** Deck-relative, forward slashes on every platform: "boards/plan.html". */
	path: string;
	title: string;
	/**
	 * What this board is, as a file — `component`, `flow` or `slides` (`deck/kinds.ts`).
	 *
	 * On the wire because the browser needs it before the frame has loaded: which editor a
	 * board admits, whether its height is measured or fixed, and whether ← → mean anything
	 * are all decided from this, and asking the frame would mean deciding them a beat late.
	 */
	format: "component" | "flow" | "slides";
	/**
	 * How the frame has to be *given* this board, when the file is not a document already.
	 *
	 * Absent for a component board and for a flow board: both are complete documents this
	 * app wrote. Present for a file that has to be rendered *into* one — `content`, which is
	 * a `.md` or a deck in either dialect — and for `foreign`, an HTML page from somewhere
	 * else, which gets a document too and is put in a sandboxed frame inside it because it
	 * may carry scripts.
	 *
	 * On the wire because the browser sizes on it: a sandboxed page cannot be measured from
	 * outside, so that one board keeps a stored height where every other flow board reports
	 * its own.
	 */
	shell?: "content" | "foreign";
	/**
	 * What this board is a live view of, when it is one: `chat` for a mirror, `web` for the
	 * shared-Chrome card, `agents` for an orchestration board.
	 *
	 * Read off the file's own `data-live` attribute — the same cheap source scan `format`
	 * comes from — because the board that draws itself from `postMessage` has no content of
	 * its own to look at. On the wire because two decisions depend on it and both are the
	 * app's: a live board has nothing to open in a tab (there is no app in a bare tab to feed
	 * it), and nothing to fill a window with.
	 */
	live?: string;
	x: number;
	y: number;
	w: number;
	h: number;
	/**
	 * Bumped whenever the file changes. Two jobs: it busts the frame's cache, and
	 * a patch carries the rev it was composed against so a stale write is refused
	 * rather than applied (§6.5).
	 */
	rev: number;
	/** `<meta name="poster">`, deck-relative. A cheap rail image for a heavy board. */
	poster?: string;
	/**
	 * How much room the board's components actually take, as the canvas last measured it.
	 *
	 * Present only when a browser has looked at *this* revision, because a measurement of
	 * an older document is worse than none: it is a number, and a number gets believed.
	 * The pair with it is `clipped` — content past the edge of the board, which renders
	 * without complaint and is invisible until somebody notices the missing paragraph.
	 */
	content?: { w: number; h: number };
	/** Content reaching past `w`/`h`. Derived from `content`, and absent when that is. */
	clipped?: boolean;
	/** Agent ids holding this board in context. */
	inContext: string[];
	/** Agent id, or "you". Drawn as a fading tint on the board's edge. */
	lastWrittenBy?: string;
	/**
	 * The file's last modification, as `mtimeMs`.
	 *
	 * The one field the dashboard's first half sorts by: "the latest boards a
	 * workspace generated" has nothing to order on without it. The loader reads it on
	 * every scan (the same `stat` that builds the change signature) but kept it
	 * private; this publishes it. Optional because every fixture and every older
	 * record predates it — the server always sends it, and a reader treats its
	 * absence as "unknown" rather than "zero" (`?? 0` in `workspace-panel.ts`).
	 */
	modifiedAt?: number;
	/**
	 * When the person last looked at this board: its preview on the dashboard, or the focus view.
	 *
	 * The dashboard's "changed" mark is for news, and a board somebody has read is not news until
	 * it is written again: a card is marked only while `modifiedAt` is newer than this. Kept by the
	 * server (`.decks/seen.json`), so a board read on the laptop is read on the phone too.
	 */
	seenAt?: number;
}

export interface DeckState {
	/** Absolute path of the open deck. */
	path: string;
	name: string;
	boards: Board[];
	roots: Root[];
}
