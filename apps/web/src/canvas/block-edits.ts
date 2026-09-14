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
 * 3. **Moves** after them, against the list the removals left — the surviving blocks, still
 *    in the order they were written. Each is read against that list *as the moves before it
 *    left it*, which is why the pass that emits them walks the target order from the left:
 *    every index to its left is already final by the time it reads one.
 * 4. **Insertions** last, **top-down**, with `path` as an index into the *after* structure —
 *    which the file now has, because the removals took out exactly the blocks missing from
 *    `after` and the moves put the survivors in the order `after` holds them.
 *
 * ### And a drag is one op
 *
 * A reorder used to be refused outright ("blocks were reordered — offer the source editor"),
 * which made the editor a surface you could type on but not rearrange. It is expressible:
 * `move-child` was built and tested on the server all along. The only question is which
 * blocks to move, and the answer is the one the person made — see `arrange`.
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
	 * A block has to be nameable to be addressed, and `indexOf` would keep finding the first
	 * of a pair. GrapesJS mints one `cid` per component and does not reuse them, so this is
	 * not a case the editor can produce — and refusing is what stops the arithmetic below
	 * from quietly rearranging the wrong block if it ever is.
	 */
	if (new Set(beforeIds).size !== beforeIds.length || new Set(afterIds).size !== afterIds.length) {
		return { patches: [], refusals: ["two blocks claim the same identity — offer the source editor"] };
	}

	const content: BoardPatch[] = [];
	const removals: BoardPatch[] = [];

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

	// Bottom-up, for the reason given at the top of the file.
	removals.reverse();

	/*
	 * What the file holds once content and removals have run: the blocks that survive, still in
	 * the order they were written. A reorder is a rearrangement of exactly this, and the two
	 * lists are all the arithmetic needs — the removals already took out what is missing, so
	 * the rest is `current` becoming `wanted`.
	 */
	const current = beforeIds.filter((id) => afterIds.includes(id));
	const wanted = afterIds.filter((id) => beforeIds.includes(id));

	const insertions: BoardPatch[] = [];
	after.forEach((block, index) => {
		if (beforeIds.includes(block.id)) return;
		insertions.push({ op: "insert-child", id: rootId, path: [index], html: block.html });
	});

	return { patches: [...content, ...removals, ...arrange(current, wanted, rootId), ...insertions], refusals: [] };
}

/**
 * The moves that put `current` into `wanted`'s order, each one valid when it runs.
 *
 * **A drag is one move, and this is built so it stays one.** Every block that nobody touched
 * keeps its relative order, so the ones that did move are exactly the blocks outside a longest
 * increasing run of the wanted positions — and one drag leaves exactly one block outside it.
 * Asking that first is what makes "I dragged the paragraph to the top" read back as
 * `moved child 3 of #body to 0` rather than as a shuffle of the paragraphs it passed, which is
 * the same file and a different sentence.
 *
 * Two drags committed together put more than one block outside that run, and there the pass
 * falls back to walking the target order from the left and pulling each block into place. It
 * can take more moves than the minimum; it cannot be wrong, because every index to the left of
 * the one being read is already final and the block wanted there is therefore at or to the
 * right of it.
 */
function arrange(current: readonly string[], wanted: readonly string[], rootId: string): BoardPatch[] {
	const order = [...current];
	const moves: BoardPatch[] = [];
	const moved = [...current].filter((id) => !stationary(current, wanted).has(id));

	if (moved.length === 1) {
		const id = moved[0]!;
		const from = order.indexOf(id);
		const to = wanted.indexOf(id);
		if (from !== to) {
			moves.push({ op: "move-child", id: rootId, path: [from], to });
			order.splice(from, 1);
			order.splice(to, 0, id);
		}
		return moves;
	}

	wanted.forEach((id, index) => {
		if (order[index] === id) return;
		const from = order.indexOf(id);
		moves.push({ op: "move-child", id: rootId, path: [from], to: index });
		order.splice(from, 1);
		order.splice(index, 0, id);
	});
	return moves;
}

/**
 * The blocks already in `wanted`'s relative order, in `current` — a longest increasing run.
 *
 * `current` and `wanted` hold the same identities, so each block's wanted index is a number
 * and its position in `current` a sequence of them. A run that increases is a run that comes
 * out in the same order in both, which is the set nobody has to move.
 */
function stationary(current: readonly string[], wanted: readonly string[]): Set<string> {
	const at = new Map(wanted.map((id, index) => [id, index]));
	const positions = current.map((id) => at.get(id) ?? 0);
	const lengths = positions.map(() => 1);
	const before = positions.map(() => -1);
	let longest = -1;

	positions.forEach((value, index) => {
		for (let earlier = 0; earlier < index; earlier++) {
			if (positions[earlier]! < value && lengths[earlier]! + 1 > lengths[index]!) {
				lengths[index] = lengths[earlier]! + 1;
				before[index] = earlier;
			}
		}
		if (longest === -1 || lengths[index]! > lengths[longest]!) longest = index;
	});

	const keep = new Set<string>();
	for (let index = longest; index !== -1; index = before[index]!) keep.add(current[index]!);
	return keep;
}
