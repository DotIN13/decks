import type { BoardPatch } from "@decks/protocol";

/**
 * A GrapesJS edit, turned into the patch operations that already exist.
 *
 * This is the whole of the design on `boards/editing-a-flow-document-properly-not-as-source`:
 * the editor is a surface a person types on, and `patch.ts` stays the thing that writes. The
 * document is never serialised back out — an untouched byte cannot be reached by a splice —
 * which is what keeps line breaks, HTML comments and an agent's line numbers intact. Compare
 * the whole-document route, where the first save on the IRB draft turned 383 lines into 225
 * and moved every line number in the file.
 *
 * ### Why it is a separate, pure module
 *
 * The two bugs the design's first run produced — an index shift read as a move, and inline
 * churn emitted as ops of its own — were both in this arithmetic, not in GrapesJS. Split out
 * of the editor, that arithmetic is testable without a browser, which is the only reason
 * either bug can be pinned down in a test rather than in a person's memory.
 *
 * ### The three things that have to agree with the server
 *
 * 1. **The address.** `path` is element-child indices walked in from the component, exactly
 *    as `boards/patch.ts`'s `elementAt` reads them — `[i]` is the component's *i*-th element
 *    child. Only element children count, on both sides: whitespace text nodes are not
 *    children here and are not children there.
 * 2. **The payload is the *inner* HTML.** `op: "html"` replaces the range between the
 *    addressed element's own tags, so a block's `<p>` wrapper must not be sent with it —
 *    sending it would nest a paragraph inside a paragraph. The design's draft sent
 *    `component.toHTML()` here, which is the outer HTML and would have done exactly that.
 * 3. **`before` is *words*, not markup.** The server compares it as text, against the text of
 *    the file's range (`collapse(textOfInline(...))`), so a `before` carrying tags can never
 *    match and every edit would be refused as a race. Hence `text` beside `html`.
 *
 * ### The order, which is the part that is easy to get wrong
 *
 * The server applies a batch in sequence, each op against the file as it is by then. That
 * fixes the only sensible order, and each step is valid at the moment it runs:
 *
 * 1. **Content** first, because its `path` is an index into the file *as the frame loaded*,
 *    and nothing has changed the structure yet.
 * 2. **Removals** next, **bottom-up**, so that removing a block never shifts the index of a
 *    block still to be removed.
 * 3. **Insertions** last, **top-down**, with `path` as an index into the *after* structure —
 *    which the file now has, because the removals took out exactly the blocks missing from
 *    `after` and a reorder is refused rather than applied.
 */

/**
 * One top-level block of a document, as the editor sees it.
 *
 * A block is one element child of the editable root — the whole design treats it as an
 * atomic run of HTML, one level deep, which is what makes the diff small and the indices
 * stable. Editing a word inside a block is a change to that block; nothing below it is ever
 * addressed here, so the editor's inline churn cannot reach the file as ops of its own.
 */
export interface EditBlock {
	/**
	 * The editor's identity for this block, stable across an edit.
	 *
	 * GrapesJS's `cid`, not its `id` attribute: the id in the canvas DOM is minted per
	 * component and is not in the file, so it can neither be written nor relied on across a
	 * re-parse.
	 */
	id: string;
	/** The block's inner HTML — the payload a content op carries. */
	html: string;
	/** The words in it — what the server compares against the file. See (3) above. */
	text: string;
}

/** What a commit amounts to: the ops to apply, and anything that made it unmappable. */
export interface BlockEdits {
	patches: BoardPatch[];
	/**
	 * Empty when the edit maps. **A caller must refuse the whole commit if this is not
	 * empty** — the ops beside it are not a partial edit to apply, they are the part the
	 * mapper could describe before it found something it could not. The design's answer is to
	 * offer the source editor in the same breath.
	 */
	refusals: string[];
}

/**
 * Diff two snapshots of a document's blocks into ops.
 *
 * `before` is the document as the editor loaded it, `after` what the person left behind, and
 * `rootId` the `data-id` of the component both snapshots came from — the element the indices
 * are walked from, which the server needs to resolve them.
 */
export function diffBlocks(before: readonly EditBlock[], after: readonly EditBlock[], rootId: string): BlockEdits {
	const beforeIds = before.map((block) => block.id);
	const afterIds = after.map((block) => block.id);

	/*
	 * **An index shift is not a move.** The design's first draft compared absolute indices,
	 * so deleting one paragraph emitted a move for every block below it — noise of exactly
	 * the kind this whole approach exists to avoid. What matters is the relative order of the
	 * blocks that survive: a deletion above changes everyone's index and changes nobody's
	 * order.
	 */
	const survivors = beforeIds.filter((id) => afterIds.includes(id));
	const stillInOrder = afterIds.filter((id) => beforeIds.includes(id));
	const reordered = survivors.join("\u0000") !== stillInOrder.join("\u0000");

	const content: BoardPatch[] = [];
	const removals: BoardPatch[] = [];
	const insertions: BoardPatch[] = [];

	before.forEach((block, index) => {
		const now = after.find((candidate) => candidate.id === block.id);
		if (!now) {
			// The block's own HTML, whole, because removing one takes its tags with it.
			removals.push({ op: "remove-child", id: rootId, path: [index], before: block.html });
			return;
		}
		/*
		 * Compared as markup, not as words: adding a `<b>` around a word leaves the text
		 * alone and is still an edit. Two serialisations that mean the same thing differing
		 * by a byte would cost one repeated op, which the server's own normaliser then writes
		 * back unchanged — cheap, and far better than a changed mark going unnoticed.
		 */
		if (now.html !== block.html) {
			content.push({ op: "html", id: rootId, path: [index], before: block.text, html: now.html });
		}
	});

	after.forEach((block, index) => {
		if (beforeIds.includes(block.id)) return;
		insertions.push({ op: "insert-child", id: rootId, path: [index], html: block.html });
	});

	// Bottom-up and top-down, for the reason given at the top of the file.
	removals.reverse();

	return {
		patches: [...content, ...removals, ...insertions],
		refusals: reordered ? ["blocks were reordered — offer the source editor"] : [],
	};
}
