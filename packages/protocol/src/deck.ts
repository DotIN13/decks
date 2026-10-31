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
/**
 * What the person has set for the whole deck, kept by the server rather than by a browser.
 *
 * `timezone` is an IANA name such as "America/Los_Angeles". The server adopts it as its own
 * clock, agents are told it, and the
 * app draws every time in it. Absent means nobody has chosen: the machine's zone is in force.
 */
export interface DeckSettings {
	timezone?: string;
	/** The model the server's speech recogniser uses (`stt.ts`); its default when unset. */
	sttModel?: string;
}

/** The server's speech recognisers to choose from in Settings, cheapest first. */
export const STT_MODELS: ReadonlyArray<{ id: string; label: string; note: string }> = [
	{ id: "gpt-4o-mini-transcribe", label: "GPT-4o mini Transcribe", note: "$0.003 a minute; mixes languages well." },
	{ id: "gpt-transcribe", label: "GPT Transcribe", note: "$0.0045 a minute; the newest." },
	{ id: "gpt-4o-transcribe", label: "GPT-4o Transcribe", note: "$0.006 a minute; the most accurate." },
	{ id: "whisper-1", label: "Whisper", note: "$0.006 a minute; the older model." },
];

/**
 * A card on a canvas, or an old board a canvas still holds (a friend's, drawn as its picture): its file, its
 * place and size, and what the canvas marks on it. `Board` is its old name.
 */
export interface Page {
	/** Deck-relative, forward slashes on every platform: "boards/plan.html". */
	path: string;
	title: string;
	/**
	 * How the frame has to be *given* this board, when the file is not a document already.
	 *
	 * Absent for a board this app wrote: it is a complete document already. Present for a
	 * file that has to be rendered *into* one — `content`, which is a `.md` — and for `foreign`,
	 * an HTML page from somewhere else, which gets a document too and is put in a sandboxed
	 * frame inside it because it may carry scripts.
	 *
	 * On the wire because the browser sizes on it: a sandboxed page cannot be measured from
	 * outside, so that one board keeps the height in its file where every other board
	 * reports its own.
	 */
	shell?: "content" | "foreign";
	/**
	 * What this board is a live view of, when it is one: `web` for the
	 * shared-Chrome card, `agents` for an orchestration board.
	 *
	 * Read off the file's own `data-live` attribute — a cheap source scan — because the board
	 * that draws itself from `postMessage` has no content of its own to look at. On the wire because two decisions depend on it and both are the
	 * app's: a live board has nothing to open in a tab (there is no app in a bare tab to feed
	 * it), and nothing to fill a window with.
	 */
	live?: string;
	/**
	 * The board is one box filling it, a document or a single file, so it can be laid out at any size.
	 *
	 * The focus view reads it: a board like this takes the whole work area at its own scale and its own
	 * bar becomes the view's header, where any other board is a designed page that is scaled to the width.
	 */
	fills?: true;
	/**
	 * A card: a piece of HTML in a canvas's `cards/`, drawn in a shadow root of the stage's own page
	 * instead of a frame (`card.ts`). Every other rule of a board holds for it.
	 */
	card?: true;
	/**
	 * An item of the drawing with no file of its own, drawn in a board's place: a document (`decks.document`,
	 * the file it edits in `file`) or an app (`decks.app`, its name in `app`). Its `path` is its item's.
	 */
	item?: "document" | "app";
	/** A document item's file, as the deck names it. */
	file?: string;
	/** An app item's app, by name. */
	app?: string;
	x: number;
	y: number;
	w: number;
	h: number;
	/**
	 * Bumped whenever the file changes, so the frame's cache is busted and a
	 * page showing an older revision reloads.
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
	 * Half of what the canvas's "changed" mark reads (`board-news.ts`). Optional because
	 * every fixture and every older record predates it — the server always sends it, and a
	 * reader treats its absence as "unknown" (`?? 0`).
	 */
	modifiedAt?: number;
	/**
	 * When a writer last *named* this board: an agent fitting, showing or reporting it through the
	 * stage tool, or the person's own edit in the canvas.
	 *
	 * The "changed" mark is about the act, not the file. `modifiedAt` moves for any write at all,
	 * which cannot tell an agent's work from the person's own drag, and `decks.canvas.insert` and `decks.agent.claim` write no
	 * file at all — so the most common act of all left no trace to mark. This is the trace: said by
	 * the writer, never read off the disk, and kept beside the byline in `.decks/authors.json`.
	 */
	namedAt?: number;
	/**
	 * When the person last looked at this board: on the canvas, or in the focus view.
	 *
	 * The canvas's "changed" mark is for news, and a board somebody has read is not news until
	 * it is written again: a card is marked only while the newest act is newer than this. Kept by
	 * the server (`.decks/seen.json`), so a board read on the laptop is read on the phone too.
	 */
	seenAt?: number;
}

/** @deprecated `Page`, its old name, kept until 2026-11-30. */
export type Board = Page;

/** A `.pen` file kept with the boards: in `boards/` or `frames/`, placed on a stage by a ref to its path. */
export interface DeckPen {
	/** Deck-relative, with `.pen`: `frames/ui/button.pen`. */
	path: string;
	/** What places it: `{ type: "ref", ref }`, the path without `.pen`. */
	ref: string;
	/** The file's first item's name, or the file's own. */
	title: string;
	modifiedAt: number;
}

export interface DeckState {
	/** Absolute path of the open deck. */
	path: string;
	name: string;
	boards: Page[];
	roots: Root[];
	/** The `.pen` files in `boards/` and `frames/`, sorted by path. */
	pens?: DeckPen[];
}
