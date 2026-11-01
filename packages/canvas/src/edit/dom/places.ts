/**
 * Where the page puts what it draws over the canvas for the hand to press (`HitLayer.tsx`): a
 * handle's box and how far it answers, an arrow anchor, the radius handle, an insert line.
 * Geometry only; what the overlay holds is the engine's (`edit/wire.ts`, `Overlay`), and its sizes
 * are the rules table's.
 */
import { sidePoint, type ArrowSide } from "@decks/pen";
import { RULES } from "../../device/profile.ts";
import { HANDLES, type Handle } from "../wire.ts";
import type { Offset, Pt, Rect } from "../model.ts";
import type { SceneQuery } from "../scene.ts";

/** The handles a board has: all eight. */
export const pageHandleList = (): readonly Handle[] => HANDLES;

/** How far a handle's hit zone reaches past its drawn box on each side, in stage pixels (`handle.reach-px`). */
export const hitReach = (size: number, zoom: number, hit = RULES.handleReach) => Math.max(0, (hit / zoom - size) / 2);

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

/** The insert line as a box at least `thick` across, centred on the boundary. */
export function insertBox(line: Rect, thick: number): Rect {
	return { x: line.x - (line.w === 0 ? thick / 2 : 0), y: line.y - (line.h === 0 ? thick / 2 : 0), w: Math.max(line.w, thick), h: Math.max(line.h, thick) };
}

const NO_SHIFT: Offset = { dx: 0, dy: 0 };
/** How far a drop's glide still draws an item from where it lands: its own shift, or that of the nearest parent that glides. */
export function glideShift(glide: ReadonlyMap<string, Offset> | undefined, scene: SceneQuery, id: string): Offset {
	if (!glide?.size) return NO_SHIFT;
	for (let at: string | undefined = id; at; at = scene.item(at)?.parent) {
		const shift = glide.get(at);
		if (shift) return shift;
	}
	return NO_SHIFT;
}
