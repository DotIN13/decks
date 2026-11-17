import type { Accessor } from "solid-js";
import type { PenPreview } from "../render/types.ts";
import { type Gesture, type CanvasInkProps } from "./CanvasInk.tsx";

/** What `createInkScale` reads of `CanvasInk` (`CanvasInk.tsx`), each read when it is used. */
export interface InkScaleNeeds {
	readonly selection: Accessor<{ x: number; y: number; w: number; h: number } | undefined>;
	gesture: Gesture | undefined;
	readonly held: Accessor<string[]>;
	readonly props: CanvasInkProps;
}

export function createInkScale(d: InkScaleNeeds) {
	/**
	 * A corner of the lasso's box, dragged: what the lasso holds grows or shrinks about the opposite
	 * corner, keeping its shape, as a notes app's selection does.
	 */
	const startScale = (event: PointerEvent, corner: "nw" | "ne" | "sw" | "se") => {
		const box = d.selection();
		if (!box || d.gesture || (event.pointerType === "mouse" && event.button !== 0)) return;
		event.stopPropagation();
		event.preventDefault();
		try {
			(event.currentTarget as SVGElement).ownerSVGElement?.setPointerCapture(event.pointerId);
		} catch {
			/* the sheet's own pointerup still ends it */
		}
		const anchor = { x: corner.includes("w") ? box.x + box.w : box.x, y: corner.includes("n") ? box.y + box.h : box.y };
		const at = { x: corner.includes("w") ? box.x : box.x + box.w, y: corner.includes("n") ? box.y : box.y + box.h };
		const boxes = new Map(d.held().flatMap((id) => {
			const placed = d.props.layer.placed.get(id)?.box;
			return placed ? [[id, { ...placed }] as const] : [];
		}));
		d.gesture = { kind: "scale", pointer: event.pointerId, anchor, corner: at, boxes, scale: 1 };
	};

	/** Each held stroke's box as it was at the press, scaled about `anchor` by `scale`, as the change a preview draws. */
	const scaled = (boxes: ReadonlyMap<string, { x: number; y: number; w: number; h: number }>, anchor: { x: number; y: number }, scale: number) =>
		new Map<string, PenPreview>(
			[...boxes].map(([id, box]) => {
				const x = anchor.x + (box.x - anchor.x) * scale;
				const y = anchor.y + (box.y - anchor.y) * scale;
				return [id, { dx: x - box.x, dy: y - box.y, w: box.w * scale, h: box.h * scale }];
			}),
		);

	return {
		scaled,
		startScale,
	};
}
