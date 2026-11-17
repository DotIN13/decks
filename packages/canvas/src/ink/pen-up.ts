import type { Setter } from "solid-js";
import { hitStroke, lassoPick, simplify } from "@decks/ink";
import { setInkSelection } from "./ink.ts";
import { inkItem } from "../model/ink.ts";
import type { PenPreview } from "../render/types.ts";
import { type Gesture, type CanvasInkProps, } from "./CanvasInk.tsx";
import { STAGE_INK } from "./ink.ts";

/** What `createPenUp` reads of `CanvasInk` (`CanvasInk.tsx`), each read when it is used. */
export interface PenUpNeeds {
	penDown: boolean;
	penUpAt: number;
	readonly palms: Set<number>;
	gesture: Gesture | undefined;
	readonly setResizing: Setter<{ anchor: { x: number; y: number; }; by: number; } | undefined>;
	readonly props: CanvasInkProps;
	readonly hold: (id: string) => void;
	readonly clearLive: () => void;
	readonly scaled: (boxes: ReadonlyMap<string, { x: number; y: number; w: number; h: number; }>, anchor: { x: number; y: number; }, scale: number) => Map<string, PenPreview>;
	readonly zoom: () => number;
}

export function createPenUp(d: PenUpNeeds) {
	const onUp = (event: PointerEvent) => {
		if (event.pointerType === "pen" && event.type !== "lostpointercapture") {
			d.penDown = false;
			d.penUpAt = performance.now();
		}
		if (d.palms.delete(event.pointerId)) {
			event.stopPropagation();
			return;
		}
		if (!d.gesture || d.gesture.pointer !== event.pointerId) return;
		event.stopPropagation();
		const done = d.gesture;
		d.gesture = undefined;
		if (done.kind === "draw") clearTimeout(done.timer);
		if (done.kind === "scale") d.setResizing(undefined);
		if (done.kind === "draw" && event.type !== "pointercancel") {
			done.id = d.props.newId();
			d.hold(done.id);
		}
		d.clearLive();
		if (event.type === "pointercancel") {
			if (done.kind === "erase") d.props.layer.previews.hide(undefined);
			if (done.kind === "move" || done.kind === "scale") d.props.layer.previews.preview(undefined);
			return;
		}
		switch (done.kind) {
			case "draw": {
				const points = simplify(done.points);
				d.props.onEdit([{ op: "insert", node: inkItem({ ...done.stroke, points }, done.id ?? d.props.newId()) }]);
				return;
			}
			case "erase":
				// Hidden until the server's answer redraws the stage without them.
				if (done.gone.size) d.props.onEdit([...done.gone].map((id) => ({ op: "delete", id })));
				return;
			case "move":
				if (done.moved) d.props.onShift(done.ids, done.dx, done.dy);
				return;
			case "scale": {
				if (done.scale === 1) return d.props.layer.previews.preview(undefined);
				const r = (n: number) => Math.round(n * 10) / 10;
				const ops = [...d.scaled(done.boxes, done.anchor, done.scale)].flatMap(([id, change]) => {
					const box = done.boxes.get(id);
					if (!box) return [];
					const x = box.x + change.dx;
					const y = box.y + change.dy;
					return [{ op: "update", id, box: { x1: r(x), y1: r(y), x2: r(x + (change.w ?? box.w)), y2: r(y + (change.h ?? box.h)) } }];
				});
				d.props.onEdit(ops);
				return;
			}
			case "lasso": {
				const strokes = d.props.strokes();
				const [x0 = 0, y0 = 0] = done.polygon;
				const far = done.polygon.some((n, i) => Math.abs(n - (i % 2 === 0 ? x0 : y0)) * d.zoom() > 6);
				// A tap is "this one": the topmost stroke under it. A loop is what it goes round.
				const ids = far
					? lassoPick(strokes, done.polygon)
					: [...strokes].reverse().filter((stroke) => hitStroke(stroke, x0, y0, 6 / d.zoom())).slice(0, 1).map((stroke) => stroke.id);
				setInkSelection(ids.length > 0 ? { path: STAGE_INK, ids } : undefined);
				return;
			}
		}
	};

	return {
		onUp,
	};
}
