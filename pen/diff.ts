import type { PenDocument, PenNode } from "./types.ts";

/**
 * What changed between two versions of a drawing, as small edits: what the server sends instead of
 * the whole file (`stage.pen.delta`), and what the stage's engines and the app's own copy apply.
 *
 * Worked out from the two documents, not from the ops that made the change, because a drawing also
 * changes by arrows rerouting after an edit, by undo putting back an older text, and by a person or
 * an agent writing the file by hand: every one of those is a new document, and a diff covers them all.
 *
 * Order among siblings is said as "after this sibling" (`after`, null for first), so each copy keeps
 * its own way of numbering places (the engine's are fractional keys) and no number is ever shared.
 */
export type PenEdit =
	/** A new item with its fields (no `children`; `list` says it has a `children` list, empty until its own inserts). */
	| { op: "insert"; id: string; parent: string | null; after: string | null; props: Record<string, unknown>; list: boolean }
	/** An item and everything under it. */
	| { op: "remove"; id: string }
	/** One field; no `value` deletes it. */
	| { op: "set"; id: string; key: string; value?: unknown }
	/** A new parent, or a new place among the siblings. */
	| { op: "place"; id: string; parent: string | null; after: string | null }
	/** One of the document's own fields (`variables`, `themes`, …); no `value` deletes it. */
	| { op: "meta"; key: string; value?: unknown };

interface Entry {
	node: PenNode;
	parent: string | null;
}

function index(doc: PenDocument): Map<string, Entry> {
	const map = new Map<string, Entry>();
	const visit = (list: readonly PenNode[], parent: string | null) => {
		for (const node of list) {
			map.set(node.id, { node, parent });
			if (Array.isArray(node.children)) visit(node.children, node.id);
		}
	};
	visit(doc.children ?? [], null);
	return map;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

function fieldsOf(node: PenNode): Record<string, unknown> {
	const { children: _children, ...rest } = node;
	return rest;
}

/** The edits that make `prev` into `next`, in an order that applies one after another. */
export function diff(prev: PenDocument, next: PenDocument): PenEdit[] {
	const edits: PenEdit[] = [];
	const emptied: PenEdit[] = [];
	// The document's own fields.
	for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
		if (key === "children") continue;
		if (!(key in next)) edits.push({ op: "meta", key });
		else if (!same(prev[key], next[key])) edits.push({ op: "meta", key, value: next[key] });
	}
	const before = index(prev);
	const after = index(next);
	// What each parent's list looks like once the removals and moves out of it are done.
	const current = new Map<string | null, string[]>();
	const listOf = (parent: string | null, doc: PenDocument, map: Map<string, Entry>): string[] => {
		const kids = parent === null ? doc.children : map.get(parent)?.node.children;
		return Array.isArray(kids) ? kids.map((k) => k.id) : [];
	};
	const working = (parent: string | null): string[] => {
		let list = current.get(parent);
		if (!list) {
			list = parent !== null && !before.has(parent) ? [] : listOf(parent, prev, before).filter((id) => after.has(id) && after.get(id)!.parent === parent);
			current.set(parent, list);
		}
		return list;
	};
	// New and moved, parents before children, each list put in order from its start.
	const visit = (list: readonly PenNode[], parent: string | null) => {
		const have = working(parent);
		let previous: string | null = null;
		for (const node of list) {
			const id = node.id;
			const was = before.get(id);
			if (!was) {
				edits.push({ op: "insert", id, parent, after: previous, props: fieldsOf(node), list: Array.isArray(node.children) });
				have.splice(previous === null ? 0 : have.indexOf(previous) + 1, 0, id);
				current.set(id, []);
			} else {
				const at = have.indexOf(id);
				const expected = previous === null ? 0 : have.indexOf(previous) + 1;
				if (was.parent !== parent || at !== expected) {
					edits.push({ op: "place", id, parent, after: previous });
					if (at >= 0) have.splice(at, 1);
					else {
						// It came from another list: take it out of that one too.
						const from = working(was.parent);
						const i = from.indexOf(id);
						if (i >= 0) from.splice(i, 1);
					}
					have.splice(previous === null ? 0 : have.indexOf(previous) + 1, 0, id);
				}
				const a = fieldsOf(was.node);
				const b = fieldsOf(node);
				for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
					if (!(key in b)) edits.push({ op: "set", id, key });
					else if (!same(a[key], b[key])) edits.push({ op: "set", id, key, value: b[key] });
				}
				// A children list appearing is a field of its own in the file; one going goes last, once
				// what was in it has moved out or gone.
				if (Array.isArray(node.children) && !Array.isArray(was.node.children)) edits.push({ op: "set", id, key: "children", value: [] });
				if (!Array.isArray(node.children) && Array.isArray(was.node.children)) emptied.push({ op: "set", id, key: "children" });
			}
			if (Array.isArray(node.children)) visit(node.children, id);
			previous = id;
		}
	};
	// Items moved out of a list are taken from it before anything is put in order there.
	for (const [id, { parent }] of after) {
		const was = before.get(id);
		if (was && was.parent !== parent) {
			const from = working(was.parent);
			const i = from.indexOf(id);
			if (i >= 0) from.splice(i, 1);
		}
	}
	visit(next.children ?? [], null);
	// Gone, last, once what stays has been moved out of them: only the topmost of what went, since
	// removing an item removes what is under it.
	for (const [id, { parent }] of before) {
		if (after.has(id)) continue;
		if (parent !== null && !after.has(parent) && before.has(parent)) continue;
		edits.push({ op: "remove", id });
	}
	edits.push(...emptied);
	return edits;
}

/** Apply edits to a copy of a document: the app's own copy follows the server's this way. */
export function applyEdits(doc: PenDocument, edits: readonly PenEdit[]): PenDocument {
	const out = JSON.parse(JSON.stringify(doc)) as PenDocument;
	const where = new Map<string, { node: PenNode; list: PenNode[] }>();
	const visit = (list: PenNode[]) => {
		for (const node of list) {
			where.set(node.id, { node, list });
			if (Array.isArray(node.children)) visit(node.children);
		}
	};
	visit(out.children);
	const listOf = (parent: string | null): PenNode[] => {
		if (parent === null) return out.children;
		const p = where.get(parent)?.node;
		if (!p) throw new Error(`no item "${parent}"`);
		if (!Array.isArray(p.children)) p.children = [];
		return p.children;
	};
	const put = (list: PenNode[], node: PenNode, after: string | null) => {
		const at = after === null ? 0 : list.findIndex((n) => n.id === after) + 1;
		if (after !== null && at === 0) throw new Error(`no sibling "${after}"`);
		list.splice(at, 0, node);
		where.set(node.id, { node, list });
	};
	const forget = (node: PenNode) => {
		where.delete(node.id);
		if (Array.isArray(node.children)) for (const child of node.children) forget(child);
	};
	for (const edit of edits) {
		switch (edit.op) {
			case "meta":
				if (edit.value === undefined) delete out[edit.key];
				else out[edit.key] = edit.value;
				break;
			case "insert": {
				const node = { ...edit.props, id: edit.id } as PenNode;
				if (edit.list) node.children = [];
				put(listOf(edit.parent), node, edit.after);
				break;
			}
			case "remove": {
				const found = where.get(edit.id);
				if (!found) throw new Error(`no item "${edit.id}"`);
				found.list.splice(found.list.indexOf(found.node), 1);
				forget(found.node);
				break;
			}
			case "place": {
				const found = where.get(edit.id);
				if (!found) throw new Error(`no item "${edit.id}"`);
				found.list.splice(found.list.indexOf(found.node), 1);
				put(listOf(edit.parent), found.node, edit.after);
				break;
			}
			case "set": {
				const found = where.get(edit.id);
				if (!found) throw new Error(`no item "${edit.id}"`);
				if (edit.key === "children") {
					if (edit.value === undefined) delete found.node.children;
					else if (!Array.isArray(found.node.children)) found.node.children = [];
				} else if (edit.value === undefined) delete found.node[edit.key];
				else found.node[edit.key] = edit.value;
				break;
			}
		}
	}
	return out;
}

/**
 * Apply edits as `applyEdits` does, but share what they do not reach: the answer is a new document
 * whose untouched items are the very objects of `doc`, and only the items edited, the lists they sit
 * in and the items above them are copies. `doc` is not changed. For a reader that treats documents
 * as values and is handed one per change (the stage): a copy through JSON of a 2,000-item drawing
 * was most of the time from an agent's edit to its frame.
 *
 * The answer shares items with `doc`, so neither may be changed in place afterwards.
 */
export function editDocument(doc: PenDocument, edits: readonly PenEdit[]): PenDocument {
	const out: PenDocument = { ...doc, children: [...(doc.children ?? [])] };
	/** Where each item is now: the object in `out` (or still `doc`'s) and its parent's id. */
	const where = new Map<string, { node: PenNode; parent: string | null }>();
	const visit = (list: readonly PenNode[], parent: string | null) => {
		for (const node of list) {
			where.set(node.id, { node, parent });
			if (Array.isArray(node.children)) visit(node.children, node.id);
		}
	};
	visit(out.children, null);
	/** The items and children lists that are this answer's own, safe to change. */
	const own = new Set<object>([out.children]);
	const ownList = (parent: string | null): PenNode[] => {
		if (parent === null) return out.children;
		const node = ownNode(parent);
		if (!Array.isArray(node.children)) node.children = [];
		if (!own.has(node.children)) {
			node.children = [...node.children];
			own.add(node.children);
		}
		return node.children;
	};
	const ownNode = (id: string): PenNode => {
		const at = where.get(id);
		if (!at) throw new Error(`no item "${id}"`);
		if (own.has(at.node)) return at.node;
		const list = ownList(at.parent);
		const copy = { ...at.node };
		list[list.indexOf(at.node)] = copy;
		own.add(copy);
		where.set(id, { node: copy, parent: at.parent });
		return copy;
	};
	const put = (list: PenNode[], node: PenNode, after: string | null) => {
		const at = after === null ? 0 : list.findIndex((n) => n.id === after) + 1;
		if (after !== null && at === 0) throw new Error(`no sibling "${after}"`);
		list.splice(at, 0, node);
	};
	const forget = (node: PenNode) => {
		where.delete(node.id);
		if (Array.isArray(node.children)) for (const child of node.children) forget(child);
	};
	const take = (id: string) => {
		const at = where.get(id);
		if (!at) throw new Error(`no item "${id}"`);
		const list = ownList(at.parent);
		list.splice(list.indexOf(at.node), 1);
		return at.node;
	};
	for (const edit of edits) {
		switch (edit.op) {
			case "meta":
				if (edit.value === undefined) delete out[edit.key];
				else out[edit.key] = edit.value;
				break;
			case "insert": {
				const node = { ...edit.props, id: edit.id } as PenNode;
				if (edit.list) own.add((node.children = []));
				own.add(node);
				put(ownList(edit.parent), node, edit.after);
				where.set(node.id, { node, parent: edit.parent });
				break;
			}
			case "remove":
				forget(take(edit.id));
				break;
			case "place": {
				const node = take(edit.id);
				put(ownList(edit.parent), node, edit.after);
				where.set(edit.id, { node, parent: edit.parent });
				break;
			}
			case "set": {
				const node = ownNode(edit.id);
				if (edit.key === "children") {
					if (edit.value === undefined) delete node.children;
					else if (!Array.isArray(node.children)) own.add((node.children = []));
				} else if (edit.value === undefined) delete node[edit.key];
				else node[edit.key] = edit.value;
				break;
			}
		}
	}
	return out;
}
