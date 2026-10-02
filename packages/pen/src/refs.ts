import { clone, indexOf, walk } from "./doc.ts";
import { IMPORTED, type PenDocument, type PenNode } from "./types.ts";

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
 * - `"name:id"` is the item `id` in the file this one `imports` as `name` (the server hands those
 *   over, `IMPORTED`); inside such a copy, a plain id means that file's item first;
 * - `"frames/<name>"` is the frame saved in the deck's `frames/<name>.pen`, which the server hands
 *   over by that name with nothing declared, as a board is placed by its path;
 * - a `slot` frame takes its children from the instance (`descendants: { slotId: { children } }`),
 *   and refs among them are expanded like any other.
 *
 * A ref to something that does not exist, is not in this file, or refers back to itself is drawn as
 * a `missing` placeholder of the ref's own size rather than dropped, so the problem stays visible.
 */

export const MISSING = "missing";

/** The document with every ref replaced by its copy. The document itself is not changed. */
export function expand(doc: PenDocument): PenNode[] {
	const index = indexOf(doc);
	const imported = new Map(Object.entries(doc[IMPORTED] ?? {}).map(([name, other]) => [name, indexOf(other)]));
	/** The item a ref names, and the file it is in (undefined: this one), looked up in `scope` first. */
	const source = (id: string, scope?: string): { node: PenNode; scope?: string } | undefined => {
		// A whole imported file by its name alone, `"frames/<name>"`: its first item, the frame saved in it.
		if (imported.has(id) && !id.includes(":")) {
			const first = doc[IMPORTED]![id]!.children?.[0];
			return first ? { node: first, scope: id } : undefined;
		}
		const colon = id.indexOf(":");
		if (colon > 0 && imported.has(id.slice(0, colon))) {
			const name = id.slice(0, colon);
			const node = imported.get(name)!.get(id.slice(colon + 1))?.node;
			return node ? { node, scope: name } : undefined;
		}
		if (scope) {
			const node = imported.get(scope)?.get(id)?.node;
			if (node) return { node, scope };
		}
		const node = index.get(id)?.node;
		return node ? { node } : undefined;
	};

	/** A copy with its inner ids still relative to its own root; the caller prefixes them. */
	const instanceRaw = (ref: PenNode, stack: readonly string[], scope?: string): PenNode => {
		const found = typeof ref.ref === "string" ? source(ref.ref, scope) : undefined;
		const target = found?.node;
		const within = found?.scope;
		if (!target || stack.includes(ref.ref as string)) {
			const { ref: _r, descendants: _d, ...rest } = ref;
			const named = String(ref.ref);
			const why = target ? `${named} refers back to itself` : named.startsWith("frames/") && !named.includes(":") ? `no saved frame ${named}.pen` : named.includes(":") ? `no item "${named}" in the imported file` : `no item "${named}" in this file`;
			return { ...rest, type: MISSING, why } as PenNode;
		}
		const inner = [...stack, ref.ref as string];
		let copy: PenNode;
		if (target.type === "ref") {
			// A ref to a ref: the inner instance, with this one laid over it.
			copy = instanceRaw(target, inner, within);
		} else {
			copy = clone(target);
			delete copy.reusable;
			// Nested instances first, so an override can reach into them by path.
			if (Array.isArray(copy.children)) copy.children = copy.children.map((child) => expandIn(child, inner, within));
		}
		for (const [key, value] of Object.entries(ref)) {
			if (key === "type" || key === "id" || key === "ref" || key === "descendants" || key === "reusable") continue;
			copy[key] = clone(value);
		}
		copy.id = ref.id;
		const overridden = applyOverrides(copy, ref.descendants);
		// What the overrides put in (a slot's children, an item replaced whole) may itself hold refs, named in this file.
		if (Array.isArray(overridden.children)) overridden.children = overridden.children.map((child) => expandIn(child, inner, scope));
		return overridden;
	};

	const instance = (ref: PenNode, stack: readonly string[], scope?: string): PenNode => prefix(instanceRaw(ref, stack, scope), ref.id);

	/** Expand refs anywhere under an item that is itself part of a component. */
	const expandIn = (node: PenNode, stack: readonly string[], scope?: string): PenNode => {
		if (node.type === "ref") return instance(node, stack, scope);
		if (!Array.isArray(node.children)) return node;
		return { ...node, children: node.children.map((child) => expandIn(child, stack, scope)) };
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
