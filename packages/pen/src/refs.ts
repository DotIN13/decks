import { clone, indexOf, walk } from "./doc.ts";
import type { PenDocument, PenNode } from "./types.ts";

/**
 * Instances, expanded: a `ref` becomes a copy of the reusable item it names.
 *
 * pen's rules, as pen.dev applies them:
 *
 * - the copy is the reusable item with `reusable` dropped, and every field the ref sets itself
 *   (`x`, `y`, `width`, `fill`, …) laid over the copy's root;
 * - `descendants` changes items inside the copy, keyed by **id path** from the copy's root:
 *   `"label"` is a child, `"ok-button/label"` is the label inside the nested instance `ok-button`.
 *   An override with a `type` replaces that item whole; one without merges its fields;
 * - an item inside the copy is known by the ref's id and its path, `"card-1/label"`. Those are the
 *   ids an agent edits it through, and never ids in the file.
 *
 * A ref to something that does not exist, is not in this file, or refers back to itself is drawn as
 * a `missing` placeholder of the ref's own size rather than dropped, so the problem stays visible.
 */

export const MISSING = "missing";

/** The document with every ref replaced by its copy. The document itself is not changed. */
export function expand(doc: PenDocument): PenNode[] {
	const index = indexOf(doc);
	const source = (id: string) => index.get(id)?.node;

	/** A copy with its inner ids still relative to its own root; the caller prefixes them. */
	const instanceRaw = (ref: PenNode, stack: readonly string[]): PenNode => {
		const target = typeof ref.ref === "string" ? source(ref.ref) : undefined;
		if (!target || stack.includes(ref.ref as string)) {
			const { ref: _r, descendants: _d, ...rest } = ref;
			return { ...rest, type: MISSING, why: target ? `${String(ref.ref)} refers back to itself` : `no item "${String(ref.ref)}" in this file` } as PenNode;
		}
		const inner = [...stack, ref.ref as string];
		let copy: PenNode;
		if (target.type === "ref") {
			// A ref to a ref: the inner instance, with this one laid over it.
			copy = instanceRaw(target, inner);
		} else {
			copy = clone(target);
			delete copy.reusable;
			// Nested instances first, so an override can reach into them by path.
			if (Array.isArray(copy.children)) copy.children = copy.children.map((child) => expandIn(child, inner));
		}
		for (const [key, value] of Object.entries(ref)) {
			if (key === "type" || key === "id" || key === "ref" || key === "descendants" || key === "reusable") continue;
			copy[key] = clone(value);
		}
		copy.id = ref.id;
		return applyOverrides(copy, ref.descendants);
	};

	const instance = (ref: PenNode, stack: readonly string[]): PenNode => prefix(instanceRaw(ref, stack), ref.id);

	/** Expand refs anywhere under an item that is itself part of a component. */
	const expandIn = (node: PenNode, stack: readonly string[]): PenNode => {
		if (node.type === "ref") return instance(node, stack);
		if (!Array.isArray(node.children)) return node;
		return { ...node, children: node.children.map((child) => expandIn(child, stack)) };
	};

	return doc.children.map((node) => expandTop(node));

	function expandTop(node: PenNode): PenNode {
		if (node.type === "ref") return instance(node, []);
		if (!Array.isArray(node.children)) return { ...node };
		return { ...node, children: node.children.map(expandTop) };
	}
}

/** Apply `descendants` to a copy whose inner ids are still relative paths. */
function applyOverrides(root: PenNode, overrides: PenNode["descendants"]): PenNode {
	if (!overrides || typeof overrides !== "object") return root;
	for (const [path, override] of Object.entries(overrides)) {
		if (!override || typeof override !== "object") continue;
		const found = findRelative(root, path);
		if (!found) continue;
		const { parent, index } = found;
		if ("type" in override && typeof override.type === "string") {
			const replacement = clone(override) as PenNode;
			replacement.id = path;
			parent.children![index] = replacement;
		} else {
			Object.assign(parent.children![index]!, clone(override));
		}
	}
	return root;
}

function findRelative(root: PenNode, path: string): { parent: PenNode; index: number } | undefined {
	const visit = (node: PenNode): { parent: PenNode; index: number } | undefined => {
		const list = node.children ?? [];
		for (let i = 0; i < list.length; i++) {
			const child = list[i]!;
			if (child.id === path) return { parent: node, index: i };
			const deeper = visit(child);
			if (deeper) return deeper;
		}
		return undefined;
	};
	return visit(root);
}

/** Give every item inside a copy its id path under the instance: `"card-1/label"`. */
function prefix(root: PenNode, id: string): PenNode {
	for (const node of walk(root.children ?? [])) {
		node.id = `${id}/${node.id}`;
		node.instanceOf = true;
	}
	return root;
}
