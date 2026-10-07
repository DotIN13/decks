/**
 * `@decks/docs`: a real `.md`, `.tex` or `.docx` file opened as a page, typed into, and kept in
 * step with whoever else writes it — another page, an agent with its own tools, any program.
 *
 * Four entry points, so each side takes only what it runs:
 *
 *     @decks/docs          the types, the messages, and the one splice rule both ends share
 *     @decks/docs/merge    landing a late batch, diffing two texts, inverting splices
 *     @decks/docs/server   the Node service that owns the files (needs `node:fs`)
 *     @decks/docs/client   one page's copy, kept in step over any transport
 *
 * Nothing here knows about Decks: the server is given how to find a file and where to keep
 * versions, and both ends are given a function that sends a message.
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
 * `a` as it reads after `b`, when both were made on the same text: zero, one or two splices.
 *
 * The one rule both ends land splices by, which is why it lives here: the server moving a
 * page's batch past an agent's write, and the page moving that write past its own unconfirmed
 * typing, must agree to the character or the two texts drift apart.
 *
 * **Overlaps merge rather than collide.** Whichever splice starts first (`aFirst` breaks a tie)
 * puts its new text first. Each removes only the old characters the other did not, and neither
 * removes the other's new text, so a key typed inside a word an agent just rewrote lands just
 * after the agent's word instead of being lost. A splice whose old characters straddle the
 * other's comes back as two: the part before, which carries its new text, and the part after.
 */
export function transformSplice(a: Splice, b: Splice, aFirst: boolean): Splice[] {
	const aEnd = a.at + a.before.length;
	const bEnd = b.at + b.before.length;
	const first = a.at < b.at || (a.at === b.at && aFirst);
	/** Where a position at or after the end of `b` sits once `b` is applied. */
	const past = (at: number) => b.at + b.text.length + (at - bEnd);
	const out: Splice[] = [];
	if (first) {
		// Before b: a's own start, its new text, and the old characters left of b.
		const leftEnd = Math.min(aEnd, b.at);
		out.push({ at: a.at, before: a.before.slice(0, leftEnd - a.at), text: a.text });
		// After b: the old characters of a that b did not touch, if a reaches past it.
		const rightStart = Math.max(a.at, bEnd);
		if (aEnd > rightStart) {
			const left = out[0]!;
			out.push({ at: past(rightStart) + left.text.length - left.before.length, before: a.before.slice(rightStart - a.at), text: "" });
		}
	} else {
		// After b's new text, with whatever of a's old characters lie beyond b.
		const start = Math.max(a.at, bEnd);
		out.push({ at: past(start), before: aEnd > start ? a.before.slice(start - a.at) : "", text: a.text });
	}
	return out.filter((splice) => splice.before.length > 0 || splice.text.length > 0);
}

/**
 * Two sequences of splices made on the same text, each moved past the other: `a` as it reads
 * after all of `b`, and `b` after all of `a`. Applying `a` then the moved `b`, or `b` then the
 * moved `a`, gives the same text.
 */
export function transformSplices(a: readonly Splice[], b: readonly Splice[], aFirst: boolean): { a: Splice[]; b: Splice[] } {
	if (a.length === 0 || b.length === 0) return { a: [...a], b: [...b] };
	if (a.length === 1 && b.length === 1) return { a: transformSplice(a[0]!, b[0]!, aFirst), b: transformSplice(b[0]!, a[0]!, !aFirst) };
	if (a.length > 1) {
		const head = transformSplices(a.slice(0, 1), b, aFirst);
		const rest = transformSplices(a.slice(1), head.b, aFirst);
		return { a: [...head.a, ...rest.a], b: rest.b };
	}
	const head = transformSplices(a, b.slice(0, 1), aFirst);
	const rest = transformSplices(head.a, b.slice(1), aFirst);
	return { a: rest.a, b: [...head.b, ...rest.b] };
}

/**
 * A write that did not come from a page: an agent's own Edit, Write or script, or any other
 * program. Kept until a person accepts or rejects it, and drawn on the page as a tracked change.
 *
 * `from` and `to` are the versions either side of it (the service's `VersionStore`), and `splices` turn
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

/**
 * What a page sends. `client` names the page, so it can tell its own splices from everyone
 * else's when `doc.changed` comes back to every page.
 */
export type DocClientMessage =
	| { type: "doc.open"; path: string; client: string }
	| { type: "doc.close"; path: string; client: string }
	/** Splices made on revision `rev`, at most one batch every 50 ms; `batch` is echoed in the answer. */
	| { type: "doc.patch"; path: string; client: string; rev: number; batch: string; splices: Splice[] }
	/** Keep a change made from outside (`accept`), or undo it with the reverse splices. */
	| { type: "doc.review"; path: string; client: string; change: string; accept: boolean }
	| { type: "doc.versions"; path: string }
	/** Put the text back as it was in one kept version, as one edit like any other. */
	| { type: "doc.restore"; path: string; client: string; sha: string };

/** What the service sends: to the page that asked, or to every page. */
export type DocServerMessage =
	/** A document as it is now, for the page that opened it; `changes` are those still to review. */
	| { type: "doc.state"; path: string; rev: number; format: DocFormat; text: string; changes: DocChange[]; error?: string }
	/**
	 * To the page that sent `batch`: the revision it made, and which of its splices did not land.
	 * When any did not, `text` is the whole document at `rev`, so the page resyncs without asking.
	 */
	| { type: "doc.patched"; path: string; batch: string; rev: number; refused: number[]; text?: string }
	/**
	 * To every page: revision `base` became `rev` by these splices, in the server's text. A page
	 * on `base` applies them; a page on anything else opens the document again. `client` is the page
	 * that typed them, with the `batch` they came in, absent for a write from outside, which carries
	 * the `change` to review instead. A page that no longer holds that batch (it opened the document
	 * again while the batch was on its way) applies it like anyone else's.
	 */
	| { type: "doc.changed"; path: string; base: number; rev: number; splices: Splice[]; by: DocAuthor; client?: string; batch?: string; change?: DocChange; settled?: string }
	| { type: "doc.versions"; path: string; versions: DocVersion[] }
	/** Something a person should be told, in a sentence. */
	| { type: "notice"; level: "info" | "warn" | "error"; text: string };
