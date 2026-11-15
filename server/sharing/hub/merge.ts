import { applyEdits, ids, type PenDocument, type PenEdit } from "@decks/pen";

// One copy's edits onto the drawing as it is now, item by item. Their removal
// wins over our edit; a missing sibling or parent sends an item to the end.

export type Merged = { doc: PenDocument; applied: number; adjusted: number; dropped: PenEdit[]; edits: PenEdit[] };

type Node = { id: string; children?: unknown };

/** Edits as merged; applied in order to `current`, they make `doc`. */
export function merge(current: PenDocument, edits: readonly PenEdit[]): Merged {
	const there = ids(current);
	if (!edits.some((e) => e.op === "insert" && there.has(e.id))) {
		try {
			return { doc: applyEdits(current, edits), applied: edits.length, adjusted: 0, dropped: [], edits: [...edits] };
		} catch {
			// One does not fit: edit by edit below.
		}
	}
	const out: Merged = { doc: current, applied: 0, adjusted: 0, dropped: [], edits: [] };
	for (const edit of edits) mergeOne(out, edit);
	return out;
}

function mergeOne(out: Merged, edit: PenEdit): void {
	if (edit.op === "insert" && has(out.doc, edit.id)) return void out.dropped.push(edit);
	if (tryApply(out, edit)) return void out.applied++;
	const fitted = fit(out.doc, edit);
	if (fitted && tryApply(out, fitted)) return void out.adjusted++;
	out.dropped.push(edit);
}

function tryApply(out: Merged, edit: PenEdit): boolean {
	try {
		out.doc = applyEdits(out.doc, [edit]);
		out.edits.push(edit);
		return true;
	} catch {
		return false;
	}
}

function fit(doc: PenDocument, edit: PenEdit): PenEdit | undefined {
	if (edit.op !== "insert" && edit.op !== "place") return undefined;
	if (edit.op === "place" && !has(doc, edit.id)) return undefined;
	const parent = edit.parent !== null && has(doc, edit.parent) ? edit.parent : null;
	const after = edit.after !== null && has(doc, edit.after) && parent === edit.parent ? edit.after : lastOf(doc, parent, edit.id);
	return { ...edit, parent, after };
}

function has(doc: PenDocument, id: string): boolean {
	const visit = (list: readonly Node[]): boolean => list.some((n) => n.id === id || (Array.isArray(n.children) && visit(n.children as Node[])));
	return visit((doc.children ?? []) as Node[]);
}

function childrenOf(list: readonly Node[], parent: string): readonly Node[] | undefined {
	for (const n of list) {
		const inner = Array.isArray(n.children) ? (n.children as Node[]) : [];
		if (n.id === parent) return inner;
		const got = childrenOf(inner, parent);
		if (got) return got;
	}
	return undefined;
}

function lastOf(doc: PenDocument, parent: string | null, self: string): string | null {
	const top = (doc.children ?? []) as Node[];
	const list = parent === null ? top : (childrenOf(top, parent) ?? []);
	const others = list.filter((n) => n.id !== self);
	return others.length ? others[others.length - 1]!.id : null;
}

/** Whether edits only set fields to what they already are: then nothing happened. */
export function changesNothing(doc: PenDocument, edits: readonly PenEdit[]): boolean {
	if (!edits.every((e) => e.op === "set" || e.op === "meta")) return false;
	const items = new Map<string, Record<string, unknown>>();
	const visit = (list: readonly Record<string, unknown>[]) => {
		for (const n of list) {
			items.set(String(n.id), n);
			if (Array.isArray(n.children)) visit(n.children as Record<string, unknown>[]);
		}
	};
	visit((doc.children ?? []) as unknown as Record<string, unknown>[]);
	const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
	return edits.every((e) => {
		if (e.op === "meta") return same((doc as unknown as Record<string, unknown>)[e.key], e.value);
		if (e.op !== "set" || e.key === "children") return false;
		const item = items.get(e.id);
		return item !== undefined && same(item[e.key], e.value);
	});
}
