import { ARROW, sidePoint, type ArrowSide } from "@decks/pen";
import { arrowHandles, type ArrowHandles } from "./arrows.ts";
import type { PageBox, Pt, Rect } from "./model.ts";
import { HANDLES, radiusStart, type Handle } from "./resize.ts";
import type { SceneQuery } from "./scene.ts";
import { type Offset, type Outline, type PageHandles, type RadiusHandle } from "./overlay.ts";

/** Handles hide when the box they would sit on is under this many screen pixels both ways: they would cover it. */
const HANDLES_MIN_PX = 10;
/** Whether a box is too small on the screen, both ways, at this zoom, to wear handles. */
const tooSmallForHandles = (box: { w: number; h: number }, zoom: number) => box.w * zoom < HANDLES_MIN_PX && box.h * zoom < HANDLES_MIN_PX;
/**
 * One item selected, and not a joined arrow (which the server redraws) or a group: it gets handles.
 * None while it is under `HANDLES_MIN_PX` on the screen both ways, at `zoom`.
 */
export function itemHandles(outlines: readonly Outline[], scene: SceneQuery, zoom = 1): Outline | undefined {
	if (outlines.length !== 1 || outlines[0]!.role !== "item") return undefined;
	if (tooSmallForHandles(outlines[0]!, zoom)) return undefined;
	const node = scene.item(outlines[0]!.id)?.node;
	// A group is as big as what is in it, and pen does not scale children, so it moves but is not sized.
	if (!node || node.metadata?.type === ARROW || node.type === "group") return undefined;
	return outlines[0]!;
}
/** What the arrow anchors and the radius handle wait for: an edit allowed, and nothing being drawn, sized or carried. */
export type HandleInput = { editable: boolean; drafting: boolean; resizing: boolean; drag: Offset };
/** One drawn item selected, not a line or words, and nothing being drawn or sized: where an arrow can leave it. */
export function arrowAnchors(handles: Outline | undefined, input: Omit<HandleInput, "drag">, scene: SceneQuery): Outline | undefined {
	if (!handles || input.drafting || input.resizing || !input.editable) return undefined;
	const node = scene.item(handles.id)?.node;
	if (!node || node.type === "path" || node.type === "text") return undefined;
	return handles;
}
/**
 * The one selected item's corner radius, when it has corners to round (`resize.ts`, `radiusStart`):
 * not while it is sized or carried.
 */
export function radiusHandle(handles: Outline | undefined, input: Omit<HandleInput, "drafting">, scene: SceneQuery): RadiusHandle | undefined {
	if (!handles || input.resizing || input.drag.dx !== 0 || input.drag.dy !== 0 || !input.editable) return undefined;
	const node = scene.item(handles.id)?.node;
	return node ? radiusStart(node, handles) : undefined;
}
/** The selected board's box, when it alone is selected, can be resized, is not being carried, and is big enough on the screen to wear handles. */
export function pageHandles(outlines: readonly Outline[], input: { resizable: boolean; carrying: boolean; boards: readonly PageBox[]; zoom?: number }): PageHandles | undefined {
	if (!input.resizable || input.carrying || outlines.length !== 1 || outlines[0]!.role !== "page") return undefined;
	if (tooSmallForHandles(outlines[0]!, input.zoom ?? 1)) return undefined;
	const path = outlines[0]!.id.slice("page:".length);
	const board = input.boards.find((candidate) => candidate.path === path);
	if (!board) return undefined;
	return { ...outlines[0]!, path };
}
/** The two ends of the one selected arrow as drawn, and its middle, for the handles that pick them up. */
export function arrowEnds(input: { selection: readonly string[]; pagePicks: readonly string[]; drag: Offset }, scene: SceneQuery): ArrowHandles | undefined {
	if (input.selection.length !== 1 || input.pagePicks.length) return undefined;
	return arrowHandles(scene, input.selection[0]!, input.drag);
}
/* ---- Where things sit, in stage pixels, with screen sizes divided by the zoom by the caller. ---- */

/** The handles a board has: all eight (`resize.ts`, `pageResizeStep`). */
export const pageHandleList = (): readonly Handle[] => HANDLES;
/** A resize handle answers a press this many screen pixels across under a pointer, whatever size it is drawn; a finger gets 44 (`dom/touch-rules.ts`). */
export const HANDLE_HIT_PX = 15;
/** How far a handle's hit zone reaches past its drawn box on each side, in stage pixels: `size` is the drawn width, in stage pixels, `hit` how wide it answers on the screen. */
export const hitReach = (size: number, zoom: number, hit = HANDLE_HIT_PX) => Math.max(0, (hit / zoom - size) / 2);
/** The top-left corner of a `size`-wide handle centred on its edge or corner of `box`. */
export function handleAt(box: Rect, handle: Handle, size: number): Pt {
	return {
		x: box.x + (handle.includes("w") ? 0 : handle.includes("e") ? box.w : box.w / 2) - size / 2,
		y: box.y + (handle.includes("n") ? 0 : handle.includes("s") ? box.h : box.h / 2) - size / 2,
	};
}
/** The centre of the arrow anchor on `side`, `gap` out from the middle of that side. */
export function anchorAt(box: Rect, side: ArrowSide, gap: number): Pt {
	const [x, y] = sidePoint(box, side);
	const [nx, ny] = side === "top" ? [0, -1] : side === "bottom" ? [0, 1] : side === "left" ? [-1, 0] : [1, 0];
	return { x: x + nx * gap, y: y + ny * gap };
}
/** How far in from the corner the radius handle sits: clear of the corner handle, never past the middle. */
export const radiusInset = (radius: number, size: number, most: number) => Math.min(Math.max(radius, size), most);
/** The radius the handle shows: a drag's, while it is this item's, else the item's own. */
export const radiusShown = (handle: { id: string; radius: number }, dragged: { id: string; radius: number } | undefined) => (dragged?.id === handle.id ? dragged.radius : handle.radius);
