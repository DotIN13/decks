import { expand, indexOf, walk, type PenDocument, type PenNode } from "@decks/pen";

type Located = ReturnType<typeof indexOf> extends Map<string, infer L> ? L : never;

/**
 * Lookups on a drawing, made once per document and kept with it. The stage is handed a new document
 * for every change and never changes one in place, so a document's answers stay its own: asked once
 * per frame under the pointer (a drag asks the parent and children of every frame near it), a fresh
 * walk of 2,000 items each time was a drag step's largest cost.
 */
const located = new WeakMap<PenDocument, Map<string, Located>>();
const drawn = new WeakMap<PenDocument, Map<string, PenNode>>();

/** Every item by id with where it sits (`@decks/pen`'s `indexOf`), for this document. */
export function docIndex(doc: PenDocument): Map<string, Located> {
	let map = located.get(doc);
	if (!map) located.set(doc, (map = indexOf(doc)));
	return map;
}

/**
 * Every item the stage draws, by id, as the engines lay them out: the document's own items, or
 * with instances expanded (`expand`, ids like `card-1/label`) when it has any.
 */
export function drawnNodes(doc: PenDocument): Map<string, PenNode> {
	let map = drawn.get(doc);
	if (map) return map;
	const index = docIndex(doc);
	let refs = false;
	for (const { node } of index.values()) if (node.type === "ref") refs = true;
	map = new Map();
	if (refs) for (const node of walk(expand(doc))) map.set(node.id, node);
	else for (const [id, { node }] of index) map.set(id, node);
	drawn.set(doc, map);
	return map;
}
