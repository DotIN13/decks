import type { CanvasItem } from "@decks/canvas/tools";

// The Canvas and Apps tabs' rules, with no store and no DOM: cards apart from
// what is drawn, and what an empty list says.

export const cardsOf = (items: readonly CanvasItem[]) => items.filter((item) => item.path !== undefined);
export const drawnOf = (items: readonly CanvasItem[]) => items.filter((item) => item.path === undefined);

/** A row is lit when it is selected, or it is the card open. */
export const itemLit = (item: CanvasItem, selected: ReadonlySet<string>, current: string | undefined): boolean => selected.has(item.id) || (item.path !== undefined && current !== undefined && current.endsWith(item.path));

export const noItemsWords = (query: string): string => (query.trim() ? `Nothing on this canvas matches “${query.trim()}”.` : "Nothing on this canvas yet.");

export function noAppsWords(apps: readonly unknown[] | undefined, query: string): string {
	if (apps === undefined) return "Looking for apps…";
	return query.trim() ? `No app matches “${query.trim()}”.` : "This deck has no apps yet. Ask an agent for one.";
}
