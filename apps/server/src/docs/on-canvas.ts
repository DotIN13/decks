import type { Deck } from "../deck/loader.ts";
import type { StagePens } from "../stage/pens.ts";
import { documentItemPath } from "./item-path.ts";
import { resolveDoc } from "./resolve.ts";

/**
 * The files the document items on a canvas name (`decks.document`), each as the deck names it and as
 * the document service keys it: the only files a canvas frame may open (`connections/routes/v1.ts`, `connections/line.ts`). Each is listed under the path written on its item, under the file it means as the deck names it (an older item may name it from the canvas's folder), and under its key: any of them opens the same file.
 */
export function documentsOnCanvas(pens: Pick<StagePens, "get">, deck: Deck, canvas: string): Map<string, string> {
	const out = new Map<string, string>();
	let doc: { children?: unknown[] } | undefined;
	try {
		doc = pens.get(canvas).doc as { children?: unknown[] };
	} catch {
		return out;
	}
	const walk = (nodes: unknown[] | undefined) => {
		for (const node of nodes ?? []) {
			const item = node as { type?: string; metadata?: { type?: string; path?: unknown }; children?: unknown[] };
			if (item.type === "browser" && item.metadata?.type === "decks.document" && typeof item.metadata.path === "string" && item.metadata.path) {
				// The path as written on the item, and the file it means as the deck names it (an older item may name it from the canvas's folder): either opens the same file.
				const given = item.metadata.path;
				const { path } = documentItemPath(deck.path, canvas, given);
				let key = path;
				try {
					key = resolveDoc(deck.roots, path).key;
				} catch {
					/* a file that does not resolve opens nothing */
				}
				out.set(given, key);
				out.set(path, key);
				out.set(key, key);
			}
			walk(item.children);
		}
	};
	walk(doc?.children);
	return out;
}
