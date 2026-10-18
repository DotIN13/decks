/**
 * What adding something to the stage decides, with no page under it: what an item a tool makes
 * opens (`opensWords`), what an arrow being drawn lights up (`drawHints`), what a pick in the
 * canvas menu or the insert panel does (`menuPick`, `insertPick`), and where the menu sits on the
 * screen (`menuPlace`).
 *
 * The page's half is `dom/InsertMenu.tsx`: the press a tool follows, the dashed outline kept until
 * the item is drawn, and the menu itself.
 */
import type { Op } from "@decks/pen";
import type { Join } from "./arrows.ts";
import type { MakingTool, PenTool, Pt, Rect, SideHintBox } from "./model.ts";

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

/** A pick in the canvas menu: the arrow, which needs a drag, put in hand; a shape or an icon chosen first in the insert panel; anything else made there. */
export type MenuPick = { do: "arm"; tool: "arrow" } | { do: "panel"; tab: "shapes" | "icons" } | { do: "make"; tool: MakingTool };
export function menuPick(tool: Exclude<PenTool, "select">): MenuPick {
	if (tool === "arrow") return { do: "arm", tool };
	if (tool === "shape" || tool === "icon") return { do: "panel", tab: tool === "shape" ? "shapes" : "icons" };
	return { do: "make", tool };
}

/** The insert panel as it was opened (`state/pen-tools.ts`, `InsertPanel`): at a stage point, or for an icon to change. */
export type InsertOpen = { at?: Pt | undefined; replace?: string | undefined };
/**
 * A pick in the insert panel: another icon for one already drawn (the same place, size and colour, a
 * new name); else put where the canvas menu was opened, centred there; else armed for the next press.
 */
export type InsertPick = { do: "update"; ops: Op[] } | { do: "make"; at: Pt } | { do: "arm" };
export function insertPick(open: InsertOpen | undefined, tool: "shape" | "icon", icon: { library: string; name: string }): InsertPick {
	if (open?.replace && tool === "icon") return { do: "update", ops: [{ op: "update", id: open.replace, set: { library: icon.library, icon: icon.name, name: icon.name } }] };
	if (open?.at) return { do: "make", at: open.at };
	return { do: "arm" };
}

/** How wide the canvas menu is, and how far it keeps from the window's edge and from the point. */
export const MENU_W = 220;
const MENU_EDGE = 8;
const MENU_GAP = 12;
/**
 * Where the canvas menu sits for a point on the screen: its left edge at the point, as a dropdown's
 * is at its button's, and kept on the screen; above the point in the lower half of the screen,
 * under it in the upper half.
 */
export function menuPlace(client: Pt, screen: { w: number; h: number }): { left: number; top: number; width: number; above: boolean } {
	return { left: Math.max(MENU_EDGE, Math.min(client.x, screen.w - MENU_W - MENU_EDGE)), top: client.y, width: MENU_W, above: client.y > screen.h / 2 };
}
export const menuShift = (above: boolean) => (above ? `translateY(calc(-100% - ${MENU_GAP}px))` : `translateY(${MENU_GAP}px)`);
