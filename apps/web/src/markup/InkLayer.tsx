import { hitStroke, inkBounds, inkPaint, lassoPick, moveStroke, simplify, strokeShape, type InkStroke } from "@decks/board-kit";
import { createMemo, onCleanup, Show } from "solid-js";
import { stagePoint } from "../camera/coords.ts";
import {
	commitInk,
	inkColor,
	inkOf,
	inkSelection,
	inkSize,
	inkTool,
	penSeen,
	previewInk,
	setInkBoard,
	setInkSelection,
	setPenSeen,
} from "../state/ink.ts";
import type { FrameGestureHost } from "../board/frame-gestures.ts";

/**
 * Where a board is drawn on: a sheet of glass over it, while the draw tool is on.
 *
 * It takes the pointer and nothing else. The strokes already on the board are in the board's
 * own document (`ink-dom.ts`), so what this draws is only what has no place there yet: the
 * stroke under the pen, the lasso's loop, and the box round what the lasso took. It is in
 * board pixels through its `viewBox`, so the camera's zoom and the focus view's are both
 * somebody else's arithmetic.
 *
 * **Which pointer draws.** A pen always does, with its pressure. A mouse does. A finger does
 * until a pen has been seen in this session, and from then on a finger moves the canvas,
 * because the hand holding a pencil rests on the glass. Two fingers are always the canvas: the
 * first finger is reported to the stage as a claimed touch, exactly as a board's own document
 * reports one (`frame-gestures.ts`), so a second finger makes a pinch and the stroke that the
 * first one started is dropped.
 */
export function InkLayer(props: { path: string; w: number; h: number; gestures: FrameGestureHost }) {
	let svg: SVGSVGElement | undefined;
	let live: SVGPathElement | undefined;
	let loop: SVGPathElement | undefined;

	type Gesture =
		| { kind: "draw"; pointer: number; points: number[]; stroke: Omit<InkStroke, "points" | "id"> }
		| { kind: "erase"; pointer: number; from: InkStroke[]; working: InkStroke[] }
		| { kind: "lasso"; pointer: number; polygon: number[] }
		| { kind: "move"; pointer: number; start: { x: number; y: number }; ids: Set<string>; from: InkStroke[]; moved: boolean };
	let gesture: Gesture | undefined;
	/** Board pixels per screen pixel is `1 / scale`; read at the press, when the box is known. */
	let scale = 1;
	let origin = { x: 0, y: 0 };
	/** Fingers reported to the stage, so each gets its `up` whatever happened to the stroke. */
	const fingers = new Set<number>();

	const at = (event: PointerEvent) => ({ x: (event.clientX - origin.x) / scale, y: (event.clientY - origin.y) / scale });
	const pressureOf = (event: PointerEvent) => (event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 0.5);
	const fingerOf = (event: PointerEvent) => {
		const point = stagePoint(event);
		return { id: event.pointerId, x: point.x, y: point.y };
	};

	const selection = createMemo(() => {
		const held = inkSelection();
		if (!held || held.path !== props.path) return undefined;
		const ids = new Set(held.ids);
		return inkBounds(inkOf(props.path).filter((stroke) => ids.has(stroke.id)));
	});

	const clearLive = () => {
		live?.setAttribute("d", "");
		loop?.setAttribute("d", "");
	};

	/** The stroke under the pen, drawn straight into the DOM: a signal per sample is a frame late. */
	const paintLive = (drawn: Extract<Gesture, { kind: "draw" }>) => {
		if (!live) return;
		const shape = strokeShape({ id: "live", ...drawn.stroke, points: drawn.points });
		const paint = inkPaint(drawn.stroke.color);
		live.setAttribute("d", shape.d);
		live.setAttribute("fill", shape.filled ? paint : "none");
		live.setAttribute("stroke", shape.filled ? "none" : paint);
		live.setAttribute("stroke-width", String(drawn.stroke.size));
		live.setAttribute("opacity", drawn.stroke.tool === "marker" ? "0.4" : "1");
	};

	const erase = (erasing: Extract<Gesture, { kind: "erase" }>, x: number, y: number) => {
		// Eight screen pixels of rubber, whatever the zoom.
		const kept = erasing.working.filter((stroke) => !hitStroke(stroke, x, y, 8 / scale));
		if (kept.length === erasing.working.length) return;
		erasing.working = kept;
		previewInk(props.path, kept);
	};

	const cancel = () => {
		if (!gesture) return;
		if (gesture.kind === "erase" || gesture.kind === "move") previewInk(props.path, gesture.from);
		gesture = undefined;
		clearLive();
	};

	const onDown = (event: PointerEvent) => {
		if (!svg) return;
		if (event.pointerType === "pen") setPenSeen(true);
		// A finger, once a pencil is about: the canvas's, so it goes on up to the stage untouched.
		if (event.pointerType === "touch" && penSeen()) return;
		if (event.pointerType === "mouse" && event.button !== 0) return;
		event.stopPropagation();

		if (event.pointerType === "touch") {
			fingers.add(event.pointerId);
			props.gestures.touch("down", fingerOf(event));
			// A second finger is half of a pinch, and the first one's stroke is over.
			if (gesture) {
				cancel();
				return;
			}
			props.gestures.claimTouch(event.pointerId);
		} else if (gesture) return;

		event.preventDefault();
		const rect = svg.getBoundingClientRect();
		scale = rect.width / props.w || 1;
		origin = { x: rect.left, y: rect.top };
		try {
			svg.setPointerCapture(event.pointerId);
		} catch {
			/* a nicety: the stroke still ends on the svg's own pointerup */
		}
		setInkBoard(props.path);
		const point = at(event);
		const tool = inkTool();
		// The button on the barrel, or the other end of the pen, erases whatever tool is in hand.
		const rubber = event.pointerType === "pen" && (event.button === 5 || (event.buttons & 32) !== 0);

		if (tool === "eraser" || rubber) {
			setInkSelection(undefined);
			const from = inkOf(props.path);
			gesture = { kind: "erase", pointer: event.pointerId, from, working: from };
			erase(gesture, point.x, point.y);
			return;
		}
		if (tool === "lasso") {
			const box = selection();
			const held = inkSelection();
			if (box && held && point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) {
				gesture = { kind: "move", pointer: event.pointerId, start: point, ids: new Set(held.ids), from: inkOf(props.path), moved: false };
				return;
			}
			setInkSelection(undefined);
			gesture = { kind: "lasso", pointer: event.pointerId, polygon: [point.x, point.y] };
			return;
		}
		setInkSelection(undefined);
		gesture = {
			kind: "draw",
			pointer: event.pointerId,
			points: [point.x, point.y, pressureOf(event)],
			stroke: { tool, color: inkColor(), size: inkSize() },
		};
		paintLive(gesture);
	};

	const onMove = (event: PointerEvent) => {
		if (event.pointerType === "touch" && fingers.has(event.pointerId)) {
			const step = props.gestures.touch("move", fingerOf(event));
			if (step.kind === "pinch") cancel();
		}
		if (!gesture || gesture.pointer !== event.pointerId) return;
		event.stopPropagation();
		// A pencil reports faster than the screen draws; the samples in between are the line's shape.
		const samples = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
		const events = samples.length > 0 ? samples : [event];
		switch (gesture.kind) {
			case "draw":
				for (const sample of events) {
					const point = at(sample);
					gesture.points.push(point.x, point.y, pressureOf(sample));
				}
				paintLive(gesture);
				return;
			case "erase":
				for (const sample of events) {
					const point = at(sample);
					erase(gesture, point.x, point.y);
				}
				return;
			case "lasso": {
				for (const sample of events) {
					const point = at(sample);
					gesture.polygon.push(point.x, point.y);
				}
				const polygon = gesture.polygon;
				let d = "";
				for (let i = 0; i < polygon.length; i += 2) d += `${i === 0 ? "M" : "L"}${polygon[i]?.toFixed(1)} ${polygon[i + 1]?.toFixed(1)}`;
				loop?.setAttribute("d", d);
				return;
			}
			case "move": {
				const point = at(event);
				const dx = point.x - gesture.start.x;
				const dy = point.y - gesture.start.y;
				if (!gesture.moved && Math.hypot(dx, dy) * scale < 3) return;
				gesture.moved = true;
				const ids = gesture.ids;
				previewInk(props.path, gesture.from.map((stroke) => (ids.has(stroke.id) ? moveStroke(stroke, dx, dy) : stroke)));
				return;
			}
		}
	};

	const onUp = (event: PointerEvent) => {
		if (fingers.delete(event.pointerId)) props.gestures.touch("up", fingerOf(event));
		if (!gesture || gesture.pointer !== event.pointerId) return;
		event.stopPropagation();
		const done = gesture;
		gesture = undefined;
		clearLive();
		if (event.type === "pointercancel") {
			if (done.kind === "erase" || done.kind === "move") previewInk(props.path, done.from);
			return;
		}
		switch (done.kind) {
			case "draw": {
				const points = simplify(done.points);
				const id = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
				commitInk(props.path, [...inkOf(props.path), { id, ...done.stroke, points }]);
				return;
			}
			case "erase":
				commitInk(props.path, done.working);
				return;
			case "move":
				if (done.moved) commitInk(props.path, inkOf(props.path));
				return;
			case "lasso": {
				const strokes = inkOf(props.path);
				const [x0 = 0, y0 = 0] = done.polygon;
				const far = done.polygon.some((n, i) => Math.abs(n - (i % 2 === 0 ? x0 : y0)) * scale > 6);
				// A tap is "this one": the topmost stroke under it. A loop is what it goes round.
				const ids = far
					? lassoPick(strokes, done.polygon)
					: [...strokes].reverse().filter((stroke) => hitStroke(stroke, x0, y0, 6 / scale)).slice(0, 1).map((stroke) => stroke.id);
				setInkSelection(ids.length > 0 ? { path: props.path, ids } : undefined);
				return;
			}
		}
	};

	onCleanup(() => {
		cancel();
		for (const id of fingers) props.gestures.touch("up", { id, x: 0, y: 0 });
		fingers.clear();
	});

	return (
		<svg
			ref={svg}
			class="ink-input"
			data-tool={inkTool()}
			viewBox={`0 0 ${props.w} ${props.h}`}
			width={props.w}
			height={props.h}
			onPointerDown={onDown}
			onPointerMove={onMove}
			onPointerUp={onUp}
			onPointerCancel={onUp}
			// A long press with a pencil or a finger is not a request for the browser's menu.
			onContextMenu={(event) => event.preventDefault()}
		>
			<path ref={live} d="" stroke-linecap="round" stroke-linejoin="round" />
			<path ref={loop} class="ink-loop" d="" />
			<Show when={selection()}>
				{(box) => <rect class="ink-selection" x={box().x - 4} y={box().y - 4} width={box().w + 8} height={box().h + 8} rx="4" />}
			</Show>
		</svg>
	);
}
