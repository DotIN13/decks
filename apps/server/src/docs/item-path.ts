import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * Where a document item's file is, from what its writer named.
 *
 * A document item names its file as the deck does, from the deck's root: `canvases/<canvas>/files/notes.md`,
 * `docs/plan.md`. Agents name it other ways: from the canvas's folder (`files/notes.md`), by an absolute
 * path, or a file that is not there yet. Each is taken for what it means when the file can be found in
 * the deck, and said back as the deck names it, with a note for the writer; an absolute path outside
 * the deck is left as it is (a declared root may hold it, `docs/resolve.ts`). With `make`, a file named
 * nowhere is made empty in the canvas's `files/`, so a document the agent only placed can be typed in.
 */
export function documentItemPath(deck: string, canvas: string | undefined, given: string, options: { make?: boolean } = {}): { path: string; note?: string } {
	const cleaned = String(given ?? "").split("\\").join("/").trim();
	if (!cleaned) return { path: cleaned };
	const insideDeck = (abs: string): string | undefined => {
		const rel = relative(deck, abs).split("\\").join("/");
		return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : undefined;
	};
	if (isAbsolute(cleaned)) {
		const rel = insideDeck(resolve(cleaned));
		if (rel) return { path: rel, note: `${given} is in the deck, so it is kept as ${rel}: a document's path names the file as the deck does, from the deck's root, never by an absolute path.` };
		return { path: cleaned, note: `${given} is outside the deck: it opens only where a root the deck declares holds it. A document in the deck is named from the deck's root, as canvases/${canvas ?? "<canvas>"}/files/<name>.md.` };
	}
	const rel = cleaned.replace(/^(\.\/)+/, "").replace(/^\/+/, "");
	if (rel.split("/").includes("..")) return { path: rel, note: `${given} climbs out of the deck: name the file from the deck's root.` };
	if (existsSync(join(deck, rel))) return { path: rel };
	const asCanvas = canvas ? [`canvases/${canvas}/${rel}`, `canvases/${canvas}/files/${basename(rel)}`] : [];
	for (const one of asCanvas) if (existsSync(join(deck, one))) return { path: one, note: `${given} was taken as ${one}: a document's path names the file as the deck does, from the deck's root.` };
	if (options.make && canvas) {
		const made = rel.startsWith("canvases/") || rel.startsWith("docs/") ? rel : `canvases/${canvas}/files/${basename(rel)}`;
		mkdirSync(dirname(join(deck, made)), { recursive: true });
		writeFileSync(join(deck, made), "");
		return { path: made, note: `There was no file called ${given}, so ${made} was made empty for the document to open; name document files from the deck's root, as canvases/${canvas}/files/<name>.md.` };
	}
	return { path: rel, note: `There is no file called ${given} in the deck. A document's path names the file as the deck does, from the deck's root: canvases/${canvas ?? "<canvas>"}/files/<name>.md.` };
}
