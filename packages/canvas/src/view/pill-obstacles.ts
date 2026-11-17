import { boxOf } from "../camera/camera.ts";
import type { CanvasEngine } from "../render/engine.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";

/** What `createPillObstacles` reads of `createSelection` (`selection.tsx`), each read when it is used. */
export interface PillObstaclesNeeds {
	readonly props: CanvasViewProps;
	readonly penLayer: CanvasEngine;
}

export function createPillObstacles(d: PillObstaclesNeeds) {
	/**
	 * The corner radius and the angle being dragged, for the handles and the outline the canvas draws
	 * round the item. What the *sheet* draws is told separately, as a preview the worker applies to
	 * its own copy (`penLayer.preview`): a turn used to send the whole drawing to the worker on every
	 * frame, which is a relayout of the whole stage sixty times a second, and that was the flicker.
	 *
	 * Neither is cleared when the gesture ends. The worker lets a preview go when the server's answer
	 * arrives — "whatever a drag was previewing is now the drawing itself" — and clearing it first is
	 * what shows the item at its old angle for a frame.
	 */
	/*
	 * The radius (`editor.radius`) is let go of when the drawing comes back with the change in it, not
	 * when the hand lifts (`editor/core/gesture.ts`, `drawn`). The sheet's own preview works that way
	 * already; the outline and the handles are drawn from it, and dropping it first shows the item
	 * upright for the frame or two the save takes. A time limit is for an edit that is refused, which
	 * would otherwise leave the handles turned for an item that is not.
	 */

	/**
	 * What the pill should not sit on (`PageCallout`): every board and drawn item but those touching the
	 * box it is for, which are the selection itself, what is in it and what holds it.
	 */
	const pillObstacles = (box: { x: number; y: number; w: number; h: number }) => {
		const touches = (o: { x: number; y: number; w: number; h: number }) => o.x < box.x + box.w && o.x + o.w > box.x && o.y < box.y + box.h && o.y + o.h > box.y;
		const out: Array<{ x: number; y: number; w: number; h: number }> = [];
		for (const board of d.props.boards) {
			const b = boxOf(board);
			if (!touches(b)) out.push(b);
		}
		for (const [id, placed] of d.penLayer.placed) {
			const b = d.penLayer.bounds.get(id) ?? placed.box;
			if (b.w > 0 && b.h > 0 && !touches(b)) out.push(b);
		}
		return out;
	};

	return {
		pillObstacles,
	};
}
