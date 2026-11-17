import type { Setter } from "solid-js";
import { hitStroke, inkShaper, strokeShape } from "@decks/ink";
import { inkHex } from "../model/ink.ts";
import type { LiveInk } from "../render/types.ts";
import { knobs } from "../base/debug.ts";
import { scheme } from "../base/theme.ts";
import { type Gesture, type CanvasInkProps } from "./CanvasInk.tsx";

/** What `createLiveStroke` reads of `CanvasInk` (`CanvasInk.tsx`), each read when it is used. */
export interface LiveStrokeNeeds {
	live: LiveInk | undefined;
	reshape: Extract<Gesture, { kind: "draw" }> | undefined;
	readonly sendInk: () => void;
	readonly loop: SVGPathElement | undefined;
	readonly props: CanvasInkProps;
	readonly zoom: () => number;
	gesture: Gesture | undefined;
	readonly setResizing: Setter<{ anchor: { x: number; y: number; }; by: number; } | undefined>;
}

export function createLiveStroke(of: LiveStrokeNeeds) {
	const clearLive = () => {
		const had = !!of.live || !!of.reshape;
		of.live = undefined;
		of.reshape = undefined;
		shaper = inkShaper();
		if (had) of.sendInk();
		of.loop?.setAttribute("d", "");
	};

	/** The stroke under the pen has changed: it is shaped and drawn at the next frame. */
	const paintLive = (drawn: Extract<Gesture, { kind: "draw" }>) => {
		of.reshape = drawn;
		of.sendInk();
	};

	/*
	 * The stroke under the pen is shaped as it grows (`inkShaper`): only its new points and its end
	 * each frame, to the same path as shaping it whole. `__inkWhole` set shapes it whole each frame,
	 * as it was, for measuring the two in one page.
	 */
	let shaper = inkShaper();

	const liveOf = (drawn: Extract<Gesture, { kind: "draw" }>): LiveInk => {
		const stroke = { id: "live", ...drawn.stroke, points: drawn.points };
		const shape = (globalThis as { __inkWhole?: boolean }).__inkWhole ? strokeShape(stroke) : shaper.shape(stroke);
		return {
			id: "live",
			d: shape.d,
			filled: shape.filled,
			// As its variable will resolve: dark ink on light, light on dark, the others a shade lighter on dark.
			color: inkHex(drawn.stroke.color, scheme()),
			size: drawn.stroke.size,
			opacity: drawn.stroke.tool === "marker" ? 0.4 : 1,
		};
	};

	const erase = (erasing: Extract<Gesture, { kind: "erase" }>, x: number, y: number) => {
		// Eight screen pixels of rubber, whatever the zoom.
		let more = false;
		for (const stroke of of.props.strokes()) {
			if (erasing.gone.has(stroke.id) || !hitStroke(stroke, x, y, 8 / of.zoom())) continue;
			erasing.gone.add(stroke.id);
			more = true;
		}
		if (more) of.props.layer.previews.hide(new Set(erasing.gone));
	};

	const cancel = () => {
		if (!of.gesture) return;
		if (of.gesture.kind === "erase") of.props.layer.previews.hide(undefined);
		if (of.gesture.kind === "move" || of.gesture.kind === "scale") of.props.layer.previews.preview(undefined);
		if (of.gesture.kind === "draw") clearTimeout(of.gesture.timer);
		if (of.gesture.kind === "scale") of.setResizing(undefined);
		of.gesture = undefined;
		clearLive();
	};

	/*
	 * Hold at the end of a stroke and it straightens, as a notes app does: the pen resting for half a
	 * second, having drawn something longer than a tap, turns the stroke into a line from where it
	 * began to where the pen is — and the line follows the pen until it lifts.
	 */
	const HOLD_MS = 500;

	const rest = (drawn: Extract<Gesture, { kind: "draw" }>, x: number, y: number) => {
		clearTimeout(drawn.timer);
		drawn.still = { x, y };
		if (knobs.noHold) return;
		drawn.timer = setTimeout(() => {
			if (of.gesture !== drawn || drawn.straight) return;
			const [x0 = 0, y0 = 0] = drawn.points;
			const n = drawn.points.length;
			const x1 = drawn.points[n - 3] ?? x0;
			const y1 = drawn.points[n - 2] ?? y0;
			if (Math.hypot(x1 - x0, y1 - y0) * of.zoom() < 16) return;
			drawn.straight = true;
			drawn.points = [x0, y0, 0.5, x1, y1, 0.5];
			paintLive(drawn);
		}, HOLD_MS);
	};

	return {
		liveOf,
		cancel,
		erase,
		rest,
		paintLive,
		clearLive,
	};
}
