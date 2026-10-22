import type { ZoomKey } from "./zoom-keys.ts";
import type { SlideAction } from "./lib/slide-keys.ts";
import type { Finger, TouchStep } from "./touch.ts";

/**
 * Canvas gestures that begin inside a board.
 *
 * A board frame is a separate document, so events that happen over it never reach
 * the stage — a wheel event does not bubble out of an iframe, and no amount of
 * listening in the parent will see it. With the frame live (above `INTERACT_ZOOM`)
 * that meant two-finger panning and pinch-zooming stopped working exactly where the
 * user is most likely to be looking: over the work.
 *
 * Same origin (DESIGN §4) makes the fix small: listen inside the frame and hand the
 * gesture to the stage. The frame owns the gesture's mechanics — it is where the
 * pointer is — and the stage owns the camera.
 *
 * Coordinates need care, and they are not one problem but three.
 * `clientX/clientY` inside the frame are in the *board's* pixels, because the stage's
 * zoom is a CSS transform on an ancestor and the frame's own coordinate system knows
 * nothing about it. Wheel *deltas* are physical scroll amounts and are not scaled by
 * that transform, so they pass through. And a **delta** measured in the frame's own
 * pixels is not the mouse's movement at all: the frame moves as the pan lands, so a
 * stationary mouse reports a shrinking `clientX` there. Positions are converted with
 * the geometry of the moment and then differenced in screen space — which is what
 * `e2e/checks/camera.mjs` measures, per event, on a live frame (`camera/coords.ts` has
 * the three conversions and the bugs that came of crossing them by hand).
 *
 * **Touch is the same problem again, and it is worse before it is fixed.** A finger
 * inside a board produced no wheel event and no gesture at all: at a readable zoom the
 * frame takes pointer events, so a one-finger drag over a board — which is most of the
 * screen when you are reading one — moved nothing, and the canvas was simply frozen.
 * So this file also owns the frame's half of the touch gestures, by the same division
 * of labour: the frame knows where the fingers are, the stage owns the camera
 * (`touch.ts` reduces a set of fingers to a pan or a pinch step).
 *
 * Two rules decide what one finger means, both of them the same rules the wheel already
 * followed. A scroll a box inside the board can take is given to it, decided once at
 * the start of the gesture and then held — flipping from scrolling an embed to panning
 * the canvas halfway through a drag is not a thing a hand can aim. And anything else
 * pans, unless the editor claimed the gesture first, which it says by calling
 * `preventDefault` on the `pointerdown` (it listens in this document too, and
 * `BoardFrame` attaches it before this file for exactly that reason).
 */

export interface FrameGestureHost {
	/** A wheel or pinch, with the cursor position already in stage coordinates. */
	wheel(gesture: { x: number; y: number; deltaX: number; deltaY: number; zooming: boolean; pinch?: boolean }): void;
	/**
	 * One finger of a canvas gesture, in stage coordinates.
	 *
	 * Reported rather than acted on, because the stage pools the fingers from every
	 * document it can see (`Stage`): a pinch with one finger on a board and the other on
	 * bare canvas is two event streams and one gesture, and each stream keeping its own
	 * idea of the gesture turns it into two pans. What comes back is what the stage made
	 * of it, so this side can tell a pinch from a pan without tracking anything.
	 */
	touch(phase: "down" | "move" | "up", finger: Finger): TouchStep;
	/**
	 * This finger belongs to something inside the board, not to the camera.
	 *
	 * A scrollable embed, here, and a board being dragged by its title bar in
	 * `BoardFrame`. The stage keeps tracking a claimed finger — it is still half of a
	 * pinch if a second one lands — and simply does not pan with it.
	 */
	claimTouch(id: number): void;
	/** Whether two or more fingers are down anywhere, which always means the canvas. */
	pinching(): boolean;
	/** A drag that means "move the canvas", reported as it happens, in screen pixels. */
	pan(dx: number, dy: number): void;
	/** Space is a modifier the stage also listens for; it has to hear it from here too. */
	space(held: boolean): void;
	/**
	 * Whether space is held anywhere.
	 *
	 * Asked rather than tracked: each document only sees the keys pressed while it has
	 * focus, so a space pressed over the canvas and a drag started over a board are
	 * two documents with two opinions. The stage is the one that counts.
	 */
	spaceHeld(): boolean;
	/** Whether the stage is currently letting the frame have pointer events at all. */
	interactive(): boolean;
	/**
	 * Where a world point is on the stage, and the zoom — from the camera as the gestures
	 * have moved it, not as the DOM has been asked to lay it out.
	 */
	screenOf(world: { x: number; y: number }): { x: number; y: number; scale: number };
	/**
	 * A camera shortcut pressed while focus was inside a board.
	 *
	 * Returns whether it meant something, so the frame knows whether to swallow it.
	 */
	key(name: string): boolean;
	/** ⌘+ / ⌘− / ⌘0, which a board frame takes rather than letting Chrome zoom the page. */
	zoom(direction: ZoomKey): void;
	/**
	 * The arrow keys, when the focused board is a deck.
	 *
	 * Returns whether there was a deck to page — so a plain board's arrows fall through to
	 * whatever else wants them rather than being swallowed by a handler that did nothing.
	 */
	slide(action: SlideAction): boolean;
}
