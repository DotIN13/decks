// Where a canvas pass may reach, by path, on the kernel's own path rules: a path is first made a deck path
// (toDeckPath: no climb, nothing hidden, nothing absolute; an address's path through deckPathFrom, which
// decodes once and refuses what is encoded twice), and only then tested with inside(), never startsWith, so
// assets/..%2fcanvases%2fb never passes as assets/ (Reader's attack, 2).
import { layout } from "../../protocol/index.ts";
import { inside, toDeckPath } from "../kernel/index.ts";

/** The deck's roots every canvas reads from: assets, docs, apps and the card runtime's lib. */
export const SHARED_ROOTS = ["assets", "docs", "apps", "lib"] as const;

/** The parts a canvas keeps in its own folder, which an item may name from inside it (cards/x, files/a.png). */
const OWN_TOPS = new Set<string>(layout.OWN_PARTS);

/** A deck path as the kernel takes it, or undefined for a climb, a hidden part or anything outside the deck. */
export function plainPath(path: unknown): string | undefined {
	if (typeof path !== "string" || !path) return undefined;
	try {
		return toDeckPath(path);
	} catch {
		return undefined;
	}
}

/** Whether a path is a deck path inside the canvas's own folder. */
export function inCanvas(canvas: string, path: unknown): boolean {
	const plain = plainPath(path);
	if (!plain) return false;
	try {
		return inside(plain, layout.canvasFolder(canvas)) && plain !== layout.canvasFolder(canvas);
	} catch {
		return false;
	}
}

/** Whether a path is a deck path under one of the deck's shared roots. */
export function inSharedRoot(path: unknown): boolean {
	const plain = plainPath(path);
	return !!plain && SHARED_ROOTS.some((root) => inside(plain, root) && plain !== root);
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
