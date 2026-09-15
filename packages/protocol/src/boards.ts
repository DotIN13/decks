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
 * **Eight ops, one addressing mode.** Every one of them is addressed by a **path counted from the
 * body** — `[]` is the body itself — and none of them knows whether it is looking at a component
 * board, a flow document or a deck: those were two vocabularies, one by name and one by path, and a
 * single addressing mode makes them one.
 *
 *     set        path, attrs?, style?        update · rename · order
 *     text       path, before, html          text · html
 *     insert     path (last index = where), html
 *     remove     path, before                remove · remove-child
 *     move       path, to (where it lands)   move-child · order
 *     replace    path, before, html          the escape hatch that closes the set
 *     duplicate  path, offset?               the server's own bytes
 *     source     text                        the whole file, for markdown
 *
 * `data-id` stays in a file as a **name** — for a person, for an agent, for a patch summary — and is
 * no longer a way to point at anything. `data-node`, which the editor stamps on what it renders, never
 * appears here at all: it is the editor's own bookkeeping and stops at the editor's edge.
 *
 * The twelve ops this replaces are still accepted and translated on receipt (`apps/server/src/boards/
 * patch.ts`, `legacyOp`), so nothing had to move in step with this.
 */
export type EditorOp =
	/** Attributes and styles, on any element. A `null` **removes** the attribute. */
	| { op: "set"; path: number[]; attrs?: Record<string, string | null>; style?: Record<string, string | null> }
	/**
	 * A run of words, replaced by markup.
	 *
	 * `html` is the element's new **inner** markup — the tags around it are not part of this, which is
	 * what lets a retype leave an element's start tag exactly as the file has it. Plain text is escaped
	 * markup, and what a file may hold is decided on the server (`boards/inline-html.ts`): a phrasing
	 * allowlist, attributes filtered, split marks merged, everything else unwrapped.
	 *
	 * `before` is the words the editor was showing — the guard. A path is only correct against the
	 * document the editor loaded, and a board an agent rewrote underneath it must be refused rather than
	 * edited in the wrong place. Compared as words, with whitespace removed from both sides, because one
	 * side is markup and the other is text.
	 */
	| { op: "text"; path: number[]; before: string; html: string }
	/**
	 * A node in, at the position's own address: **the last index is where among the children it goes**,
	 * and the rest is the parent it goes into. `path: [3, 1]` inserts as the second child of the body's
	 * fourth element child.
	 *
	 * There is no `kind` and no rect: a component is not a special case, and the markup a new one is
	 * made of is composed by whoever knows the catalogue (`@decks/board-kit`).
	 */
	| { op: "insert"; path: number[]; html: string }
	| { op: "remove"; path: number[]; before: string }
	/** `to` is the index the node **ends up at**, counted after the move — not a neighbour to sit beside. */
	| { op: "move"; path: number[]; to: number }
	/**
	 * The element itself, tags and all — what `text` deliberately is not.
	 *
	 * This is the op that makes the set complete: anything the other seven cannot express is written as
	 * one region of the file, and the bytes around it are copied verbatim.
	 */
	| { op: "replace"; path: number[]; before: string; html: string }
	/**
	 * A copy, made by the server from the file's own bytes.
	 *
	 * Its own op rather than an `insert` the browser composes, because a client's DOM is a *rendering*:
	 * a card copied from it comes back re-spelled, while the file's own bytes keep the heading, the
	 * paragraph and the list exactly as the author wrote them. `offset` moves a placed copy beside its
	 * original.
	 */
	| { op: "duplicate"; path: number[]; offset?: { x: number; y: number } }
	/**
	 * Replace a **flow or slides** board's whole file.
	 *
	 * A markdown file has no components: it is one run of text, and the editable unit is the file. Exact
	 * by construction, which is the point — there is no serialiser to reorder bytes nobody touched.
	 */
	| { op: "source"; text: string };

/**
 * The twelve ops, **deprecated**, still accepted by the server — and still what the app sends.
 *
 * They are two families — six addressed by a name, six by a path walked from a component — and they
 * are kept for exactly one reason: so that the editor's replacement can land without the app being
 * upgraded in step with it. The server translates one of these into the eight above on receipt
 * (`apps/server/src/boards/patch.ts`), which is the migration the design asked for rather than a
 * second write path.
 *
 * When the app's own frame editor is replaced by `@decks/editor`, this union is deleted and with it
 * the translation. Nothing new should be written against it.
 */
export type BoardPatch =
	| { op: "insert"; kind: ComponentKind; id: string; at: Rect; text?: string; embed?: string; attrs?: Record<string, string> }
	| { op: "update"; id: string; style?: Partial<Rect>; class?: string; attrs?: Record<string, string | null> }
	| { op: "source"; text: string }
	| { op: "text"; id: string; path: number[]; before: string; text: string }
	| { op: "html"; id: string; path: number[]; before: string; html: string }
	| { op: "insert-child"; id: string; path: number[]; html: string }
	| { op: "remove-child"; id: string; path: number[]; before: string }
	| { op: "move-child"; id: string; path: number[]; to: number }
	| { op: "remove"; id: string }
	| { op: "duplicate"; id: string; offset?: { x: number; y: number } }
	| { op: "rename"; id: string; to: string }
	| { op: "order"; id: string; to: "front" | "back" };

/** What the server accepts today: the eight, or one of the twelve being retired. */
export type AnyBoardPatch = BoardPatch | EditorOp;

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
/**
 * The tags that are **steps in an address and never targets**.
 *
 * A parser can put an element into a document that the file never wrote — the one that happens on this
 * deck is `<tbody>`, which every parser inserts around a table's rows: measured, 328 of 89,313 elements
 * across 553 boards, every one of them a `<tbody>`. An element with no bytes has no start tag to splice
 * and no range to write into, so an edit aimed at it can only be refused.
 *
 * Two facts follow, and they pull in opposite directions:
 *
 * - **the path must count it**, because both parsers have it and a client counting only what the file
 *   *spells* would address the wrong element — silently;
 * - **it cannot be edited**, so offering it as a target promises something that cannot happen.
 *
 * This list resolves that: these tags take a step in a path, and never get a handle. The rule is the
 * same shape as `INLINE_TAGS` — one list, written down, read by everything that has to agree:
 *
 * - **the editor** does not stamp a handle on one, so a press can never resolve to it (the same
 *   mechanism that keeps a script's own elements out of reach, rather than a rule declaring it off
 *   limits);
 * - **the server** refuses an address that names one, with a sentence rather than *“cannot locate the
 *   tag”*.
 *
 * `html`, `head` and `body` are here for the same reason from the other side: they exist in every
 * document and are nobody's component — a path is counted *from* the body, and a press on the frame
 * around a board means “not that one”. `colgroup` is the fourth element a parser will invent, for a
 * `<col>` written straight into a table.
 */
export const STRUCTURAL_TAGS = ["html", "head", "body", "tbody", "colgroup"] as const;

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
