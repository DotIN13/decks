import { baseTheme, isArrow, placements, reroute, walk, type PenDocument } from "@decks/pen";

// Joined arrows, routed again between their ends after every change, so the
// file holds the path the page draws (README rule 10).

/** Route every joined arrow again between its ends, in place; the ids of those that moved. */
export function routeArrows(doc: PenDocument, canvas: string): string[] {
	const arrows = [...walk(doc.children)].filter(isArrow);
	if (!arrows.length) return [];
	const was = new Map(arrows.map((a) => [a.id, JSON.stringify(a)] as const));
	const placed = placements(doc, { theme: baseTheme(doc, "light") });
	const byPath = (name: string) => {
		const local = name.startsWith(`canvases/${canvas}/`) ? name.slice(`canvases/${canvas}/`.length) : name;
		const node = [...walk(doc.children)].find((n) => (n.metadata as { path?: unknown } | undefined)?.path === local);
		return node ? placed.get(node.id)?.box : undefined;
	};
	reroute(doc, placed, byPath);
	return arrows.filter((a) => was.get(a.id) !== JSON.stringify(a)).map((a) => a.id);
}
