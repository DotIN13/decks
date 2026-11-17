import type { Accessor } from "solid-js";
import { inkColor, inkSize, inkTool, penSeen, setInkSelection, setPenSeen } from "./ink.ts";
import { PALM_AFTER_MS } from "./ink.ts";
import { type Gesture, type CanvasInkProps } from "./CanvasInk.tsx";

/** What `createPenDown` reads of `CanvasInk` (`CanvasInk.tsx`), each read when it is used. */
export interface PenDownNeeds {
	readonly fingerDown: (event: PointerEvent) => void;
	gesture: Gesture | undefined;
	readonly cancel: () => void;
	readonly props: CanvasInkProps;
	readonly erase: (erasing: Extract<Gesture, { kind: "erase"; }>, x: number, y: number) => void;
	readonly selection: Accessor<{ x: number; y: number; w: number; h: number } | undefined>;
	readonly held: Accessor<string[]>;
	readonly pressureOf: (event: PointerEvent) => number;
	readonly rest: (drawn: Extract<Gesture, { kind: "draw"; }>, x: number, y: number) => void;
	readonly paintLive: (drawn: Extract<Gesture, { kind: "draw"; }>) => void;
}

export function createPenDown(d: PenDownNeeds) {
	/** Whether the pencil is on the glass, when it last left it, and the touches taken for a palm. */
	let penDown = false;

	let penUpAt = Number.NEGATIVE_INFINITY;

	const palms = new Set<number>();

	/*
	 * A palm is a touch while the pencil is on the glass or has only just left it. Not a wide touch: a
	 * finger on an iPad reports a contact 70px across often enough that a pan or a pinch with the draw
	 * tool on was taken for a palm and did nothing, and iPadOS turns a resting palm away by itself while
	 * the Pencil is in use.
	 */
	const palm = (_event: PointerEvent) => penDown || performance.now() - penUpAt < PALM_AFTER_MS;

	const onDown = (event: PointerEvent) => {
		if (event.pointerType === "touch") {
			// A palm while the pencil is in use: nothing, not even a pan.
			if (palm(event)) {
				palms.add(event.pointerId);
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			d.fingerDown(event);
			// With a pencil about, a finger is the canvas's: it goes on up to the stage, one to pan, two to pan and pinch.
			if (penSeen()) return;
			// Without one, a finger draws, and a second finger is half of a pinch: the first one's stroke is over.
			if (d.gesture) {
				d.cancel();
				return;
			}
		}
		if (event.pointerType === "pen") {
			setPenSeen(true);
			penDown = true;
		}
		if (event.pointerType === "mouse" && event.button !== 0) return;
		event.stopPropagation();
		if (d.gesture) return;
		event.preventDefault();
		try {
			(event.currentTarget as Element).setPointerCapture(event.pointerId);
		} catch {
			/* a nicety: the stroke still ends on the sheet's own pointerup */
		}
		const point = d.props.toView(event);
		const tool = inkTool();
		// The button on the barrel, or the other end of the pen, erases whatever tool is in hand.
		const rubber = event.pointerType === "pen" && (event.button === 5 || (event.buttons & 32) !== 0);

		if (tool === "eraser" || rubber) {
			setInkSelection(undefined);
			d.gesture = { kind: "erase", pointer: event.pointerId, gone: new Set() };
			d.erase(d.gesture, point.x, point.y);
			return;
		}
		if (tool === "lasso") {
			const box = d.selection();
			if (box && point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) {
				d.gesture = { kind: "move", pointer: event.pointerId, start: point, ids: [...d.held()], dx: 0, dy: 0, moved: false };
				return;
			}
			setInkSelection(undefined);
			d.gesture = { kind: "lasso", pointer: event.pointerId, polygon: [point.x, point.y] };
			return;
		}
		setInkSelection(undefined);
		d.gesture = { kind: "draw", pointer: event.pointerId, points: [point.x, point.y, d.pressureOf(event)], stroke: { tool, color: inkColor(), size: inkSize() }, still: point };
		d.rest(d.gesture, point.x, point.y);
		d.paintLive(d.gesture);
	};

	return {
		palms,
		get penDown() {
			return penDown;
		},
		set penDown(next) {
			penDown = next;
		},
		get penUpAt() {
			return penUpAt;
		},
		set penUpAt(next) {
			penUpAt = next;
		},
		palm,
		onDown,
	};
}
