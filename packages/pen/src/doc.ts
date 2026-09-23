import type { PenDocument, PenNode } from "./types.ts";

/**
 * Reading and writing a `.pen` file, and finding things in one.
 *
 * The file is JSON and stays JSON: `parse` checks the shape pen.dev needs (a `children` array
 * of items that each have a `type` and an `id`) and nothing more, and `serialize` writes it back
 * with two-space indentation, which is how pen.dev saves. Neither step drops or renames a field.
 */

/** The version written into a document this package creates. Existing files keep their own. */
export const PEN_VERSION = "2.14";

export function emptyDocument(): PenDocument {
	return { version: PEN_VERSION, children: [] };
}

export class PenError extends Error {}

/** A parsed document, or a sentence saying what is wrong with the text. */
export function parse(text: string): PenDocument {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		throw new PenError(`Not JSON: ${(error as Error).message}`);
	}
	return check(raw);
}

/** Check a value is a document: an object with `children`, each item typed and uniquely named. */
export function check(raw: unknown): PenDocument {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PenError("A .pen document is a JSON object with a children array.");
	const doc = raw as PenDocument;
	if (!Array.isArray(doc.children)) throw new PenError("A .pen document needs a children array.");
	if (typeof doc.version !== "string") doc.version = PEN_VERSION;
	const seen = new Set<string>();
	const visit = (node: unknown, where: string) => {
		if (!node || typeof node !== "object" || Array.isArray(node)) throw new PenError(`${where} is not an object.`);
		const item = node as PenNode;
		if (typeof item.type !== "string" || !item.type) throw new PenError(`${where} has no type.`);
		if (typeof item.id !== "string" || !item.id) throw new PenError(`${where} (${item.type}) has no id.`);
		if (item.id.includes("/")) throw new PenError(`The id "${item.id}" contains "/", which separates the steps of an id path.`);
		if (seen.has(item.id)) throw new PenError(`The id "${item.id}" is used twice.`);
		seen.add(item.id);
		if (item.children !== undefined) {
			if (!Array.isArray(item.children)) throw new PenError(`${item.id}.children is not an array.`);
			item.children.forEach((child, index) => visit(child, `${item.id}.children[${index}]`));
		}
	};
	doc.children.forEach((child, index) => visit(child, `children[${index}]`));
	return doc;
}

export function serialize(doc: PenDocument): string {
	return `${JSON.stringify(doc, null, 2)}\n`;
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** A fresh five-character id, the length pen.dev generates, not already in `taken`. */
export function newId(taken: ReadonlySet<string>): string {
	for (;;) {
		let id = "";
		for (let i = 0; i < 5; i++) id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
		if (!taken.has(id)) return id;
	}
}

export interface Located {
	node: PenNode;
	/** The parent item, or undefined at the top of the document. */
	parent: PenNode | undefined;
	/** The array this item sits in: the parent's children, or the document's. */
	siblings: PenNode[];
	index: number;
}

/** Every item by id, with where it sits. Rebuilt after an edit; documents are small. */
export function indexOf(doc: PenDocument): Map<string, Located> {
	const map = new Map<string, Located>();
	const visit = (siblings: PenNode[], parent: PenNode | undefined) => {
		siblings.forEach((node, index) => {
			map.set(node.id, { node, parent, siblings, index });
			if (Array.isArray(node.children)) visit(node.children, node);
		});
	};
	visit(doc.children, undefined);
	return map;
}

/** Depth-first, parents before children, in paint order. */
export function* walk(nodes: readonly PenNode[]): Generator<PenNode> {
	for (const node of nodes) {
		yield node;
		if (Array.isArray(node.children)) yield* walk(node.children);
	}
}

export function ids(doc: PenDocument): Set<string> {
	const set = new Set<string>();
	for (const node of walk(doc.children)) set.add(node.id);
	return set;
}

/** A deep copy through JSON, which is all a `.pen` item is. */
export function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
