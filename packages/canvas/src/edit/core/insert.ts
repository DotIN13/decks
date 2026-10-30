/**
 * What adding something to the stage decides, with no page under it: what an item a tool makes
 * opens (`opensWords`), what an arrow being drawn lights up (`drawHints`), and what a pick in the
 * insert panel does (`insertPick`).
 *
 * The page's half is `dom/InsertMenu.tsx`: the press a tool follows, the dashed outline kept until
 * the item is drawn, and the insert panel.
 */
import type { Op } from "@decks/pen";
import type { Join } from "./arrows.ts";
import type { PenTool, Pt, Rect, SideHintBox } from "./model.ts";

/** Words, a note or a card: made, it opens for typing at once. */
export const opensWords = (tool: PenTool): tool is "text" | "note" | "card" => tool === "text" || tool === "note" || tool === "card";

/**
 * What an arrow being drawn lights up: what its start joins, from the first press, and what the
 * pointer would join now if that is something else, with the sides it can keep to there.
 */
export function drawHints(start: Join | undefined, end: Join | undefined): { joins: Rect[]; sides: SideHintBox[] } {
	const other = end && end.name !== start?.name ? end : undefined;
	return { joins: [...(start ? [start.box] : []), ...(other ? [other.box] : [])], sides: other ? [{ box: other.box, ...(other.side ? { side: other.side } : {}) }] : [] };
}

/** The insert panel as it was opened (`state/pen-tools.ts`, `InsertPanel`): at a stage point, or for an icon to change. */
export type InsertOpen = { at?: Pt | undefined; replace?: string | undefined };
/**
 * A pick in the insert panel: another icon for one already drawn (the same place, size and colour, a
 * new name); else put where it was opened for, centred there; else armed for the next press.
 */
export type InsertPick = { do: "update"; ops: Op[] } | { do: "make"; at: Pt } | { do: "arm" };
export function insertPick(open: InsertOpen | undefined, tool: "shape" | "icon", icon: { library: string; name: string }): InsertPick {
	if (open?.replace && tool === "icon") return { do: "update", ops: [{ op: "update", id: open.replace, set: { library: icon.library, icon: icon.name, name: icon.name } }] };
	if (open?.at) return { do: "make", at: open.at };
	return { do: "arm" };
}
