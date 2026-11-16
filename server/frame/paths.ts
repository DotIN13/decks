// Where a canvas pass may reach, by path: tested only after the path is plain. A path that climbs (..), names
// a hidden part (.decks), is absolute, or has an empty, '.', backslash or NUL part is refused before any
// prefix is compared, so assets/..%2fcanvases%2fb never passes as assets/ (Reader's attack, 2).
import { layout } from "../../protocol/index.ts";

/** The deck's roots every canvas reads from: assets, docs, apps and the card runtime's lib. */
export const SHARED_ROOTS = ["assets", "docs", "apps", "lib"] as const;

/** The parts a canvas keeps in its own folder, which an item may name from inside it (cards/x, files/a.png). */
const OWN_TOPS = new Set<string>(layout.OWN_PARTS);

/** A path made of plain parts only, or undefined: no climb, nothing hidden, nothing absolute, nothing empty. */
export function plainPath(path: unknown): string | undefined {
	if (typeof path !== "string" || !path || path.startsWith("/") || /^[a-z]:/i.test(path)) return undefined;
	const parts = path.split("/");
	if (parts.some((part) => !part || part === "." || part === ".." || part.startsWith(".") || /[\\\0]/.test(part))) return undefined;
	return path;
}

/** Whether a deck path is plain and inside the canvas's own folder. */
export function inCanvas(canvas: string, path: unknown): boolean {
	const plain = plainPath(path);
	if (!plain) return false;
	try {
		return plain.startsWith(`${layout.canvasFolder(canvas)}/`);
	} catch {
		return false;
	}
}

/** Whether a deck path is plain and under one of the deck's shared roots. */
export function inSharedRoot(path: unknown): boolean {
	const plain = plainPath(path);
	return !!plain && (SHARED_ROOTS as readonly string[]).includes(plain.split("/")[0]!) && plain.includes("/");
}

/**
 * Whether a path written inside an item a pass inserts or changes may stand: its own canvas's folder, a part
 * of that folder named from inside it (cards/x, files/a.png), or a shared root. Anything else, another
 * canvas's card or a document anywhere else in the deck, is refused (Reader's attack, 6).
 */
export function itemPathOk(canvas: string, path: unknown): boolean {
	const plain = plainPath(path);
	if (!plain) return false;
	return inCanvas(canvas, plain) || inSharedRoot(plain) || OWN_TOPS.has(plain.split("/")[0]!);
}
