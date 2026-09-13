/** The open deck: the boards, where they sit, and the roots an embed may reach. */
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
}

export interface DeckState {
	/** Absolute path of the open deck. */
	path: string;
	name: string;
	boards: Board[];
	roots: Root[];
}
