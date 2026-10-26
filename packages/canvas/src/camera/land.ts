import type { Camera } from "@decks/protocol";
import type { AgentView } from "./agent-view.ts";
import { middleOf, type Viewport } from "./camera.ts";

/**
 * Where the camera lands on arriving at a view's key: an agent on a canvas in the Decks app, a
 * canvas in Studio. The host makes the key; this never does, so Studio stays per canvas and the
 * Decks app per agent and canvas.
 *
 * Three answers, in order:
 *
 * 1. **The view this device last left under the key**, exactly, whatever is under it now. It was
 *    checked against the boards alone before, so a view of a note or a sketch was thrown away for a
 *    fit of the boards, and a canvas with no boards kept whatever camera was on screen.
 * 2. **The middle of everything on the canvas**, boards and drawing alike, at the arrival zoom
 *    (`middleOf`: the median of the items, which one stray item cannot move).
 * 3. **The canvas's origin**, for an empty canvas. Never the camera of the key being left: that
 *    was the camera another agent had, saved a moment later as this one's own.
 */
export function landingCamera(input: {
	view: AgentView | undefined;
	/** Everything on the arriving canvas, in canvas units: its boards and its drawn items. */
	boxes: Array<{ x: number; y: number; w: number; h: number }>;
	viewport: Viewport;
	/** The part of the window the canvas has, without the panels standing over it. */
	region: { x: number; y: number; width: number; height: number };
}): Camera {
	if (input.view) return { ...input.view.camera };
	if (input.boxes.length > 0) return middleOf(input.boxes, input.region, input.viewport);
	return { x: 0, y: 0, zoom: 1 };
}

/**
 * Who the camera on screen belongs to: the key it last landed for, or nobody while a switch is
 * still arriving. A view is kept only under its owner, so a switch that has not landed, or a canvas
 * shown at a camera it never had, writes nothing.
 */
export interface CameraOwner {
	/** Whose view it is: an agent in the Decks app, a canvas in Studio. */
	scope: string;
	/** The canvas, where the key has one. */
	canvas?: string;
}

/** Whether two owners are the same key. */
export const sameOwner = (a: CameraOwner | undefined, b: CameraOwner | undefined): boolean =>
	!!a && !!b && a.scope === b.scope && a.canvas === b.canvas;
