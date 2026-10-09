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
 * Who made a `doc.changed`: `"person"` for typing on a page (and a restore, which a person
 * pressed), an agent's name when the server can tell, and `"outside"` otherwise.
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
 * program. It is already in the file, highlighted on the page, until a person accepts it (it
 * stays) or rejects it (its reverse splices land, like anyone's typing).
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

export interface CompileError {
	message: string;
	/** The line of the document, counting from 1. */
	line?: number;
}

/** What typesetting a document gave: the PDF, when there is one, and LaTeX's errors. */
export interface CompileResult {
	ok: boolean;
	/** Absolute path of the PDF written. */
	pdf?: string;
	errors: CompileError[];
	/** Why nothing ran at all (no engine installed, say), in a sentence. */
	error?: string;
}

/** The git repository a document sits in, as `git status` has it, without asking the remote. */
export interface GitStatus {
	/** The branch checked out, or a short commit when none is. */
	branch: string;
	/** The branch it pulls from and pushes to (`origin/master`), when it has one. */
	upstream?: string;
	/** Where that is, with any token or password taken out of the address. */
	remote?: string;
	/** What to call the remote: "Overleaf" for an Overleaf project, else its host. */
	label?: string;
	/** Commits here the remote does not have, and the other way round, as of the last fetch. */
	ahead: number;
	behind: number;
	/** Files with edits not yet committed. */
	changed: number;
}

/** What a pull or a push did, in a sentence, and the repository as it stands after. */
export interface GitResult {
	ok: boolean;
	message: string;
	status?: GitStatus;
}

/** A document whose words live somewhere else, kept in step by the server: a Google Doc. */
export interface DocRemote {
	kind: "google";
	title: string;
	/** Where to open it in its own editor. */
	url: string;
}

/** How the server's link to a remote document stands. */
export interface DocRemoteStatus {
	state: "synced" | "syncing" | "signin" | "error";
	/** When the page's text and the Doc last agreed. */
	at?: number;
	message?: string;
	/** Who this server is signed in to Google as. */
	email?: string;
	/** "fake" when the server talks to its stand-in for Google. */
	mode?: "google" | "fake";
	/** The sign-in needs the address the browser landed on pasted back. */
	paste?: boolean;
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
	/** Keep a change from outside (`accept`), or take it back. `change` `"*"` is every change waiting. */
	| { type: "doc.review"; path: string; client: string; change: string; accept: boolean }
	| { type: "doc.versions"; path: string }
	/** One kept version's text, to look at. */
	| { type: "doc.version"; path: string; sha: string }
	/** Typeset the document (LaTeX) as it stands, and say where the PDF is. */
	| { type: "doc.compile"; path: string; client: string }
	/** Put the text back as it was in one kept version, as one edit like any other. */
	| { type: "doc.restore"; path: string; client: string; sha: string }
	/**
	 * The git repository the document is in: `status` reads it; `pull` commits the edits made here
	 * and merges the remote's; `push` does that and sends the commits. Answered by `doc.repo`.
	 */
	| { type: "doc.git"; path: string; client: string; action: "status" | "pull" | "push" }
	/** Styles for a Google Doc, as Docs requests at the page's indices, sent once the typing before them is in. */
	/** Docs requests for a Google Doc, made when the page read `text`: the server brings the Doc to that text first, so typing after them lands after them. */
	| { type: "doc.gstyle"; path: string; client: string; requests: unknown[]; text?: string }
	/** A comment on a Google Doc: a new one on the quoted words, a reply, or resolving one. */
	| { type: "doc.gcomment"; path: string; client: string; action: "create" | "reply" | "resolve"; comment?: string; content?: string; quote?: string };

/** What the service sends: to the page that asked, or to every page. */
export type DocServerMessage =
	/**
	 * A document as it is now, for the page that opened it; `changes` are the writes from outside still waiting to be accepted or rejected.
	 * `path` is what to call it from now on, which differs from `asked`, the path the page sent, for
	 * another spelling of the file or a copy from before documents were edited in place.
	 */
	| { type: "doc.state"; path: string; asked: string; client?: string; rev: number; format: DocFormat; text: string; changes: DocChange[]; error?: string; remote?: DocRemote }
	/**
	 * To the page that sent `batch`: the revision it made, and which of its splices did not land.
	 * When any did not, `text` is the whole document at `rev`, so the page resyncs without asking.
	 */
	| { type: "doc.patched"; path: string; batch: string; rev: number; refused: number[]; text?: string }
	/**
	 * To every page: revision `base` became `rev` by these splices, in the server's text. A page
	 * on `base` applies them; a page on anything else opens the document again. `client` is the page
	 * that typed them, with the `batch` they came in, absent for a write from outside, which carries
	 * the `change` to review instead. `settled` names changes accepted or rejected, whose highlights go. A page that no longer holds that batch (it opened the document
	 * again while the batch was on its way) applies it like anyone else's.
	 */
	| { type: "doc.changed"; path: string; base: number; rev: number; splices: Splice[]; by: DocAuthor; client?: string; batch?: string; change?: DocChange; settled?: string[] }
	| { type: "doc.versions"; path: string; versions: DocVersion[] }
	| { type: "doc.version"; path: string; sha: string; at?: number; text?: string; error?: string }
	/**
	 * A typesetting finished: `pdf` is the path to fetch it by, when one was made; `errors` are
	 * LaTeX's own, each with the line of the document it stopped at when it said one.
	 */
	| { type: "doc.compiled"; path: string; ok: boolean; pdf?: string; errors: CompileError[]; at: number; ms: number; error?: string }
	/**
	 * What `doc.git` found or did. `status` absent means the document is in no repository. What a
	 * pull changed in the document arrives as a `doc.changed` like any write from outside.
	 */
	| { type: "doc.repo"; path: string; action: "status" | "pull" | "push"; ok: boolean; status?: GitStatus; message?: string }
	/**
	 * To the pages on a Google Doc's mirror: the Doc as Google returned it, for drawing, and the
	 * index-aligned text it reads as (`gdoc/units.ts`), so a page whose text is ahead can lay its
	 * own typing over it.
	 */
	| { type: "doc.gdoc"; path: string; document: unknown; text: string }
	/** To the pages on a Google Doc: its open comments, or why they cannot be shown. */
	| { type: "doc.gcomments"; path: string; comments: unknown[]; error?: string }
	/** To every page: how a remote document's link stands, sent when it changes. */
	| { type: "doc.remote"; path: string; status: DocRemoteStatus }
	/** Something a person should be told, in a sentence. */
	| { type: "notice"; level: "info" | "warn" | "error"; text: string };
