import { applyEdits, ids, type PenDocument, type PenEdit } from "@decks/pen";

export interface MergeResult {
	doc: PenDocument;
	/** Edits that applied as they were. */
	applied: number;
	/** Edits that were adjusted to fit: a sibling or parent that is gone. */
	adjusted: number;
	/** Edits that could not apply: they touch an item someone else removed. */
	dropped: PenEdit[];
	/**
	 * The edits as they were applied, adjusted ones as adjusted, dropped ones left out: applied in
	 * order to the same document, they make `doc`, so they are what happened.
	 */
	edits: PenEdit[];
}

const idsOf = ids;

const has = (doc: PenDocument, id: string): boolean => {
	const visit = (list: readonly { id: string; children?: unknown }[]): boolean =>
		list.some((n) => n.id === id || (Array.isArray(n.children) && visit(n.children as never)));
	return visit(doc.children ?? []);
};

/**
 * Apply one copy's edits onto the current document, item by item.
 *
 * The edits were worked out against an older document (`diff`), so some may no longer fit: the item
 * was removed by someone else (the edit is dropped: their removal wins), or its sibling or parent is
 * gone (the item goes to the end of the list, or to the top level). A field set by both sides takes
 * the value applied last, which is this push: last writer wins, per field.
 */
export function merge(current: PenDocument, edits: readonly PenEdit[]): MergeResult {
	// Most often every edit fits as it is: one copy of the document for all of them.
	const inserts = edits.filter((e) => e.op === "insert");
	const there = inserts.length ? idsOf(current) : undefined;
	if (!inserts.some((e) => there!.has(e.id))) {
		try {
			return { doc: applyEdits(current, edits), applied: edits.length, adjusted: 0, dropped: [], edits: [...edits] };
		} catch {
			// One does not fit: edit by edit, below.
		}
	}
	let doc = current;
	let applied = 0;
	let adjusted = 0;
	const dropped: PenEdit[] = [];
	const happened: PenEdit[] = [];
	for (const edit of edits) {
		// An item that is there already is not put there twice (a copy that sent its edits again).
		if (edit.op === "insert" && has(doc, edit.id)) {
			dropped.push(edit);
			continue;
		}
		try {
			doc = applyEdits(doc, [edit]);
			applied++;
			happened.push(edit);
			continue;
		} catch {
			// Try a version of the edit that fits the document as it is now.
		}
		const fitted = fit(doc, edit);
		if (fitted) {
			try {
				doc = applyEdits(doc, [fitted]);
				adjusted++;
				happened.push(fitted);
				continue;
			} catch {
				// Fall through to dropping it.
			}
		}
		dropped.push(edit);
	}
	return { doc, applied, adjusted, dropped, edits: happened };
}

function fit(doc: PenDocument, edit: PenEdit): PenEdit | undefined {
	switch (edit.op) {
		case "insert":
		case "place": {
			if (edit.op === "insert" && has(doc, edit.id)) return undefined;
			if (edit.op === "place" && !has(doc, edit.id)) return undefined;
			const parent = edit.parent !== null && has(doc, edit.parent) ? edit.parent : null;
			const after = edit.after !== null && has(doc, edit.after) && parent === edit.parent ? edit.after : lastOf(doc, parent, edit.id);
			return { ...edit, parent, after };
		}
		default:
			return undefined;
	}
}

function lastOf(doc: PenDocument, parent: string | null, self: string): string | null {
	const find = (list: readonly { id: string; children?: unknown }[]): readonly { id: string }[] | undefined => {
		for (const n of list) {
			if (n.id === parent) return (Array.isArray(n.children) ? n.children : []) as never;
			if (Array.isArray(n.children)) {
				const got = find(n.children as never);
				if (got) return got;
			}
		}
		return undefined;
	};
	const list = parent === null ? (doc.children ?? []) : (find(doc.children ?? []) ?? []);
	const others = list.filter((n) => n.id !== self);
	return others.length ? others[others.length - 1]!.id : null;
}
