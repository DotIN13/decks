/** A board file's vocabulary: its components, their rects, and the edits a user may commit. */
/**
 * Which component a patch addresses, re-exported from the vocabulary both sides share.
 *
 * The union is `@decks/board-kit`'s; it is repeated here — as a *derivation*, not a second
 * list — because `BoardPatch` is a wire type and this file is where the wire lives. Nothing
 * that only wants the vocabulary should import it from here.
 */
import type { ComponentKind } from "@decks/board-kit";

export type { ComponentKind };

export interface Rect {
	left: number;
	top: number;
	width?: number;
	height?: number;
}

/**
 * A user edit, declarative so the server can apply it to the file itself.
 *
 * The browser mutates the frame's DOM optimistically and sends one of these; the
 * file is the artifact, so the optimistic mutation is a preview of a write and a
 * refused write re-syncs it.
 */
export type BoardPatch =
	/** `attrs` carries whatever else the new component needs named — a dropped PDF's `data-pages`. */
	| { op: "insert"; kind: ComponentKind; id: string; at: Rect; text?: string; embed?: string; attrs?: Record<string, string> }
	/** `null` in `attrs` *removes* the attribute, which is how a tone goes back to the default. */
	| { op: "update"; id: string; style?: Partial<Rect>; class?: string; attrs?: Record<string, string | null> }
	/**
	 * Replace a **flow or slides** board's whole file.
	 *
	 * The other ops here address components inside a document, because that is what a
	 * component board is. A markdown file has no components: it is one run of text, and the
	 * editable unit is the file. So this op carries the file.
	 *
	 * Exact by construction, which is the point — there is no serialiser to reorder bytes
	 * nobody touched. That matters more here than anywhere else in this list, because these
	 * files are read back by agents: a board that rewrites itself on every human edit is a
	 * board the agent stops recognising. Refused for a component board, where the
	 * byte-range splicing above is the whole design.
	 */
	| { op: "source"; text: string }
	/**
	 * Retype a run of text, addressed by where it *is* rather than by a name.
	 *
	 * `id` is the component and `path` is the element-child indices walked into from it —
	 * `[]` is the component itself, `[0]` its first element child. One address, not two:
	 * the path is meaningless without the component, so the pair cannot disagree with
	 * itself the way an id plus an independent name could.
	 *
	 * `before` is the text the browser was showing, and it is what makes a *derived*
	 * address safe to use. A path is only correct against the file the DOM was built from,
	 * and the two can come apart: the agent rewrites a board while a frame is pinned to the
	 * revision it loaded (§7), and the same indices then point at an element the user never
	 * saw. The server compares and refuses.
	 *
	 * It is the third guard, not the first — which is why it almost never fires. A patch
	 * carries the revision it was composed against and a stale one is refused outright, and
	 * a board the agent rewrote reloads the frame, which abandons the edit in progress. What
	 * is left is the window between those two: a rev this client legitimately holds, against
	 * a DOM that has not caught up yet. Nothing but the content check can see that, and what
	 * it prevents is the only genuinely unacceptable outcome here — the user's words written
	 * silently into a component they were not looking at.
	 *
	 * **It replaces `data-edit`**, a name the author wrote on every editable run, which
	 * was the address for a while and is gone. A name is a fine address and a poor
	 * *gate*: nothing was editable unless an agent had thought to name it, so a board
	 * written without the convention had no retypeable text at all and the app could only
	 * say "ask the agent for a data-edit on it". It also had to be unique per board, which
	 * `duplicate` paid for by minting fresh names for every run inside a copy.
	 *
	 * The reason the name won the first time no longer holds. A path was rejected because
	 * it addressed nothing inside a `[data-md]` panel, whose DOM `board.js` draws and the
	 * file does not contain — and rendered panels are now edited as their whole *source*,
	 * addressed as one component. So a path is only ever resolved where the file's tree
	 * really is the DOM's, which is the condition it always needed.
	 */
	| { op: "text"; id: string; path: number[]; before: string; text: string }
	/**
	 * Retype a run of words that has marks in it, addressed the same way.
	 *
	 * The same address as `text` and a different payload: `html` is the element's new
	 * *inner HTML*, because a run like `See <a href="…">the doc</a>, then <b>ship it</b>` has
	 * no plain-text form. `text` would flatten it and throw the link and the bold away,
	 * which is why an element with markup in it used to be refused outright.
	 *
	 * So the browser makes the element `contenteditable` and the user treats the marks like
	 * text: select across a `<b>`, delete it, type through it. What comes back is whatever
	 * the engine produced, and `boards/inline-html.ts` decides what a board file may hold —
	 * a phrasing-content allowlist, attributes filtered, split marks merged, empty ones
	 * dropped, non-breaking spaces returned to spaces, everything else unwrapped to its
	 * words. That runs on the *server*: the rule about what a file may contain belongs with
	 * the file, so there is one implementation of it and a client that is buggy or is not
	 * this app cannot write markup a board should not hold.
	 *
	 * `before` is the element's text as the browser had it, not its HTML — the same race
	 * guard as `text` uses, and compared as text on both sides because two serialisations of
	 * one document differ in ways that mean nothing (`<br>` against `<br />`) and agree
	 * about words.
	 */
	| { op: "html"; id: string; path: number[]; before: string; html: string }
	| { op: "remove"; id: string }
	/**
	 * A copy of a component, offset, with a name derived from the original's.
	 *
	 * Its own op rather than an `insert` composed by the browser, because a card is a
	 * heading and a paragraph and a list: the only copy that keeps that is a copy of
	 * the source bytes, and only the server has those. The one op here that is not
	 * idempotent — applying it twice means two copies, which is what it says.
	 */
	| { op: "duplicate"; id: string; offset?: { x: number; y: number } }
	/**
	 * Rename a component.
	 *
	 * Its own op rather than `attrs: { "data-id": … }`, because a name is not an
	 * attribute like the others: it has to be a name a board can use, it has to be one
	 * nothing else has, and the op has to answer with it. An id is how an agent refers
	 * to a component, so the new name is in the summary it is told and in the ids the
	 * patch reports (§6.5) — an agent holding the old one hears that it changed.
	 */
	| { op: "rename"; id: string; to: string }
	| { op: "order"; id: string; to: "front" | "back" };

/**
 * The tags a run of words may be made of, shared because both sides ask about them.
 *
 * HTML's phrasing content, minus everything interactive, embedded, or capable of running
 * something. Two questions are answered from this one list, and they have to agree:
 *
 * - **The browser** decides what to make `contenteditable`, and draws the underline that
 *   says so, from "does this element contain anything that is not on this list".
 * - **The server** decides what a `html` patch may write into a board file, from the same
 *   question asked of the parse tree, and unwraps anything else to its words
 *   (`boards/inline-html.ts`).
 *
 * A tag on one list and not the other would be an affordance that promises a refusal, or a
 * refusal for something the app just offered — which is exactly the failure the old
 * `data-edit` underline was designed around. So there is one list, here, next to the other
 * piece of board vocabulary both sides share.
 */
export const INLINE_TAGS = [
	"a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em", "i", "kbd",
	"mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
] as const;

/** What the agent is told the user changed, and what `stage.edits()` returns. */
export interface UserEdit {
	path: string;
	at: number;
	summary: string;
	ids: string[];
}
