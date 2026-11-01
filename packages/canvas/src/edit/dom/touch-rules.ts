import type { PointerKind } from "../core/model.ts";

/**
 * The numbers that make the canvas feel right under a finger, in one place: how far a press may
 * wobble before it means to move, how big a handle is drawn and how far it answers, how long a hold
 * is, how close two taps are. The DOM layer reads them now (`pointer.ts`, `OverlayLayer.tsx`); the
 * engine reads the same ones once it paints the overlays, so the feel does not change when the
 * drawing moves. Apple asks for 44 pt targets and Google for 48 dp; a glyph may be smaller than
 * what answers the press, which is why a handle is drawn as a 10 pt dot and answers 44.
 */

/** Whether the main pointer is a finger (`pointer: coarse`): a touch screen, with or without a Pencil. */
export const COARSE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** Before a press moves this far on the screen, it has not moved: a finger wobbles, a mouse does not. */
export const DRAG_SLOP_BY_POINTER: Record<PointerKind, number> = { touch: 8, pen: 4, mouse: 3 };

/** The slop for a pointer of this kind; a kind the browser does not name counts as a mouse. */
export const slopFor = (kind: string | PointerKind | undefined): number => DRAG_SLOP_BY_POINTER[(kind === "touch" || kind === "pen" ? kind : "mouse") as PointerKind];

/** A resize handle as drawn, in screen pixels: a small dot under a finger, a square under a pointer. */
export const HANDLE_DOT_PX = COARSE ? 10 : 9;
/** How wide a handle answers a press, in screen pixels, whatever it is drawn: a finger's width on touch. */
export const HANDLE_HIT_PX = COARSE ? 44 : 15;

/** The selection's outline and handles fade in over this long, rather than appearing. */
export const SELECTION_FADE_MS = 120;

/** A press held still this long is a hold: the item's menu, with a preview. */
export const HOLD_MS = 450;
