import type { Setter } from "solid-js";
import { setInkSelection } from "./ink.ts";
import type { PenPreview } from "../render/types.ts";
import { STAGE_INK } from "./ink.ts";
import { type Gesture, type CanvasInkProps } from "./CanvasInk.tsx";

/** What `createPenMove` reads of `CanvasInk` (`CanvasInk.tsx`), each read when it is used. */
export interface PenMoveNeeds {
	readonly palms: Set<number>;
	readonly gesture: Gesture | undefined;
	readonly props: CanvasInkProps;
	readonly paintLive: (drawn: Extract<Gesture, { kind: "draw"; }>) => void;
	readonly pressureOf: (event: PointerEvent) => number;
	readonly zoom: () => number;
	readonly rest: (drawn: Extract<Gesture, { kind: "draw"; }>, x: number, y: number) => void;
	readonly scaled: (boxes: ReadonlyMap<string, { x: number; y: number; w: number; h: number; }>, anchor: { x: number; y: number; }, scale: number) => Map<string, PenPreview>;
	readonly setResizing: Setter<{ anchor: { x: number; y: number; }; by: number; } | undefined>;
	readonly erase: (erasing: Extract<Gesture, { kind: "erase"; }>, x: number, y: number) => void;
	readonly loop: SVGPathElement | undefined;
}

export function createPenMove(of: PenMoveNeeds) {
	const onMove = (event: PointerEvent) => {
		// A palm's moves go nowhere, the canvas included.
		if (of.palms.has(event.pointerId)) {
			event.stopPropagation();
			return;
		}
		if (!of.gesture || of.gesture.pointer !== event.pointerId) return;
		event.stopPropagation();
		// A pencil reports faster than the screen draws; the samples in between are the line's shape.
		const samples = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
		const events = samples.length > 0 ? samples : [event];
		switch (of.gesture.kind) {
			case "draw": {
				const drawn = of.gesture;
				if (drawn.straight) {
					// A straightened stroke is a line from its start to the pen.
					const point = of.props.toView(event);
					drawn.points.splice(3, 3, point.x, point.y, 0.5);
					of.paintLive(drawn);
					return;
				}
				for (const sample of events) {
					const point = of.props.toView(sample);
					drawn.points.push(point.x, point.y, of.pressureOf(sample));
				}
				const last = of.props.toView(event);
				// Resting means staying within a few screen pixels; anything more starts the wait again.
				if (Math.hypot(last.x - drawn.still.x, last.y - drawn.still.y) * of.zoom() > 3) of.rest(drawn, last.x, last.y);
				of.paintLive(drawn);
				return;
			}
			case "scale": {
				const point = of.props.toView(event);
				const { anchor, corner } = of.gesture;
				// How far along the box's diagonal the pointer is: the shape is kept, whichever way it goes.
				const diagonal = { x: corner.x - anchor.x, y: corner.y - anchor.y };
				const length = diagonal.x * diagonal.x + diagonal.y * diagonal.y || 1;
				of.gesture.scale = Math.max(0.05, ((point.x - anchor.x) * diagonal.x + (point.y - anchor.y) * diagonal.y) / length);
				of.props.layer.previews.preview(of.scaled(of.gesture.boxes, anchor, of.gesture.scale));
				of.setResizing({ anchor, by: of.gesture.scale });
				return;
			}
			case "erase":
				for (const sample of events) {
					const point = of.props.toView(sample);
					of.erase(of.gesture, point.x, point.y);
				}
				return;
			case "lasso": {
				for (const sample of events) {
					const point = of.props.toView(sample);
					of.gesture.polygon.push(point.x, point.y);
				}
				const polygon = of.gesture.polygon;
				let d = "";
				for (let i = 0; i < polygon.length; i += 2) d += `${i === 0 ? "M" : "L"}${polygon[i]?.toFixed(1)} ${polygon[i + 1]?.toFixed(1)}`;
				of.loop?.setAttribute("d", d);
				return;
			}
			case "move": {
				const point = of.props.toView(event);
				const dx = point.x - of.gesture.start.x;
				const dy = point.y - of.gesture.start.y;
				if (!of.gesture.moved && Math.hypot(dx, dy) * of.zoom() < 3) return;
				of.gesture.moved = true;
				of.gesture.dx = dx;
				of.gesture.dy = dy;
				of.props.layer.previews.preview(new Map<string, PenPreview>(of.gesture.ids.map((id) => [id, { dx, dy }])));
				setInkSelection({ path: STAGE_INK, ids: [...of.gesture.ids] });
				return;
			}
		}
	};

	return {
		onMove,
	};
}
