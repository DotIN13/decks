import type { BoardPatch } from "@decks/protocol";

/**
 * What a burst of edits becomes before it goes down the socket.
 *
 * A patch carries the revision it was composed against and the server refuses a
 * stale one (DESIGN §6.5) — which is exactly right for "the agent wrote this file
 * while you were dragging" and exactly wrong for "you clicked three inspector
 * buttons in a second". The second patch of a burst is composed against a rev the
 * first one has already replaced, so it is refused, and a refusal unpins the frame
 * and reloads it: three clicks produced two warnings and a flash.
 *
 * So the client holds a patch back while one is in flight and sends the queue as a
 * single batch when the acknowledgement comes back with the new rev. `coalesce` is
 * what keeps that batch from growing a step per click: consecutive edits to the
 * same component are one edit, because the file only ever sees the last one anyway.
 *
 * The file-drop path found the same problem first and solved it by hand — the whole
 * batch of inserts is one patch (§6.9). This is that fix made general, and it also
 * covers the case that was quietly broken before there was an inspector at all: an
 * arrow key held down sends a patch per repeat.
 */
export function coalesce(patches: BoardPatch[]): BoardPatch[] {
	const out: BoardPatch[] = [];
	for (const patch of patches) {
		const last = out[out.length - 1];
		if (!last) {
			out.push(patch);
			continue;
		}

		/*
		 * Only the *last* patch is a merge candidate, deliberately. Merging across an
		 * intervening op would reorder edits — a remove between two updates, an insert
		 * between two texts — and the server applies a batch in order for a reason.
		 */
		if (patch.op === "update" && last.op === "update" && last.id === patch.id) {
			out[out.length - 1] = {
				op: "update",
				id: patch.id,
				...(last.style || patch.style ? { style: { ...last.style, ...patch.style } } : {}),
				...(patch.class !== undefined ? { class: patch.class } : last.class !== undefined ? { class: last.class } : {}),
				...(last.attrs || patch.attrs ? { attrs: { ...last.attrs, ...patch.attrs } } : {}),
			};
			continue;
		}

		// Two retypings of the same run of text: the first never existed as far as the
		// file is concerned. Compared by `edit` alone, which is the whole address now — a
		// card's heading and its body are two names, not one name and two indices.
		if (patch.op === "text" && last.op === "text" && last.edit === patch.edit) {
			out[out.length - 1] = patch;
			continue;
		}

		out.push(patch);
	}
	return out;
}

/**
 * Whether a patch produces something that exists only in the file.
 *
 * The frame is pinned to the revision it loaded so a user's own edit does not reload
 * the document they are editing (§7) — which holds only while the editor has already
 * made the change on screen. An insert and a duplicate have not: the server mints the
 * name and writes the markup, so there is nothing in the DOM to pin. Those two unpin
 * and take the reload.
 */
export function needsReload(patches: BoardPatch[]): boolean {
	return patches.some((patch) => patch.op === "insert" || patch.op === "duplicate");
}
