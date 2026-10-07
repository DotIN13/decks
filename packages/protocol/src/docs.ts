/**
 * Documents: a real `.md`, `.tex` or `.docx` file opened as a page, typed into, and kept in step
 * with whoever else writes it.
 *
 * **The file is the truth, and an edit is a splice of its source.** The page knows where each
 * block's words sit in the source text, so a keystroke is sent as "at this offset, these old
 * characters become these new ones" rather than as a document. The server applies a splice only
 * where its old characters still stand, which is what lets a person type while an agent edits
 * another part of the same file: nothing is refused for being late, only for colliding.
 *
 * For a `.docx` the source text is the zip's `word/document.xml`; the server rewrites the zip.
 */

/**
 * One change to a source text: at `at`, the characters `before` become `text`.
 *
 * `at` counts UTF-16 code units, as a JavaScript string does. Within a batch the splices are
 * sequential: each one's `at` is in the text the earlier ones left.
 */
export interface Splice {
	at: number;
	before: string;
	text: string;
}

export type DocFormat = "text" | "docx";

/**
 * Who made a `doc.changed`: `"person"` for typing on a page (and an accept, reject or restore,
 * which a person pressed), an agent's name when the server can tell, and `"outside"` otherwise.
 */
export type DocAuthor = "person" | "outside" | (string & {});

/** Apply one splice whose `before` is known to stand at `at`. */
export function applySplice(text: string, splice: Splice): string {
	return text.slice(0, splice.at) + splice.text + text.slice(splice.at + splice.before.length);
}

/**
 * `a` as it reads after `b`, when both were made on the same text, or `undefined` when they touch
 * the same characters. The one rule both ends land splices by, which is why it lives here: the
 * server moving a page's batch past an agent's write, and the page moving that write past its own
 * unconfirmed typing, must agree to the character or the two texts drift apart.
 *
 * Two insertions at one point are ordered by `aFirst`; an insertion at the start of a replaced
 * range goes before it, and at its end after it.
 */
export function transformSplice(a: Splice, b: Splice, aFirst: boolean): Splice | undefined {
	const aEnd = a.at + a.before.length;
	const bEnd = b.at + b.before.length;
	const shifted = { ...a, at: a.at + b.text.length - b.before.length };
	const aInserts = a.before.length === 0;
	const bInserts = b.before.length === 0;
	if (aInserts && bInserts) return a.at < b.at || (a.at === b.at && aFirst) ? a : shifted;
	if (aInserts) return a.at <= b.at ? a : a.at >= bEnd ? shifted : undefined;
	if (bInserts) return b.at <= a.at ? shifted : b.at >= aEnd ? a : undefined;
	return aEnd <= b.at ? a : a.at >= bEnd ? shifted : undefined;
}

/**
 * A write that did not come from a page: an agent's own Edit, Write or script, or any other
 * program. Kept until a person accepts or rejects it, and drawn on the page as a tracked change.
 *
 * `from` and `to` are the versions either side of it (`.decks/revisions`), and `splices` turn
 * `from` into `to`. `by` is who the server believes wrote it, which is `"outside"` when it cannot say.
 */
export interface DocChange {
	id: string;
	by: DocAuthor;
	at: number;
	from: string;
	to: string;
	splices: Splice[];
}

/** One kept version of a document, oldest first in a list. */
export interface DocVersion {
	sha: string;
	at: number;
}
