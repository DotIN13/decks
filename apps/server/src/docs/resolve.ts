import { relative } from "node:path";
import type { Resolved } from "@decks/docs/server";
import { containedIn, resolveFileRequest, type ResolvedRoots } from "../deck/roots.ts";

/**
 * Which files a document page may open in Decks, and the name each is kept under.
 *
 * The same rule an embed reads by (`deck/roots.ts`): anything in the deck or in a root the deck
 * declares. A file in the deck is named by its deck-relative path, which is also its name in the
 * board version store, so a markdown board opened as a document shares its history; a file in
 * another root by its absolute path, and it is written only when that root says `writable`.
 * The app's own records under `.decks/` are never a document.
 */
export function resolveDoc(roots: ResolvedRoots, path: string): Resolved {
	const file = resolveFileRequest(roots, { path });
	if (containedIn(roots.deck, file)) {
		const key = relative(roots.deck, file).split("\\").join("/");
		if (key === ".decks" || key.startsWith(".decks/")) throw new Error(`${path} is the app's own record, not a document`);
		return { file, key, writable: true };
	}
	const root = roots.roots.find((r) => r.exists && containedIn(r.path, file));
	return { file, key: file, writable: !!root?.writable };
}
