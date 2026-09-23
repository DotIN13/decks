import { hitStroke, inkBounds, inkPaint, lassoPick, simplify, strokeShape, type InkStroke } from "@decks/board-kit";
import type { Camera } from "@decks/protocol";
import { createMemo, onCleanup, Show } from "solid-js";
import { inkColor, inkSelection, inkSize, inkTool, penSeen, setInkSelection, setPenSeen } from "../../state/ink.ts";
import { inkItem } from "./ink.ts";
import type { PenLayer, PenPreview } from "./layer.ts";

/** What the lasso holds is marked with this path, since ink is the stage's now and not a board's. */
export const STAGE_INK = "stage";

/**
 * Drawing on the stage: a sheet of glass over the whole canvas while the draw tool is on.
 *
 * What is drawn goes into the stage's `.pen` file as ink (`ink.ts`), one pen `path` per stroke,
 * through the same edits an agent sends. The strokes already there are drawn by the stage's own
 * drawing layer; this sheet draws only what has no place there yet — the stroke under the pen,
 * the lasso's loop, and the box round what the lasso took — in stage pixels, under the camera.
 *
 * **Which pointer draws.** A pen always does, with its pressure. A mouse does. A finger does until
 * a pen has been seen in this session; from then on a finger is the canvas's, and goes on up to the
 * stage to pan and pinch, because the hand holding a pencil rests on the glass.
 */
export function StageInk(props: {
	camera: Camera;
	view: { width: number; height: number };
	toStage: (event: PointerEvent) => { x: number; y: number };
	/** The ink on the stage now, each stroke in stage pixels. */
	strokes: () => InkStroke[];
	layer: PenLayer;
	/** A new stroke's pen items, and the edits before it that it needs (the ink colour). */
	onEdit: (ops: unknown[]) => void;
	/** The edit that defines the ink colour, when the stage does not have it yet. */
	colourEdit: () => unknown | undefined;
	newId: () => string;
	/** Move items by this much, as every other move on the stage does. */
	onShift: (ids: readonly string[], dx: number, dy: number) => void;
}) {
	let live: SVGPathElement | undefined;
	let loop: SVGPathElement | undefined;

	type Gesture =
		| { kind: "draw"; pointer: number; points: number[]; stroke: Omit<InkStroke, "points" | "id"> }
		| { kind: "erase"; pointer: number; gone: Set<string> }
		| { kind: "lasso"; pointer: number; polygon: number[] }
		| { kind: "move"; pointer: number; start: { x: number; y: number }; ids: string[]; dx: number; dy: number; moved: boolean };
	let gesture: Gesture | undefined;

	const zoom = () => props.camera.zoom || 1;
	const pressureOf = (event: PointerEvent) => (event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 0.5);
	const transform = () => {
		const { x, y } = props.camera;
		return `translate(${props.view.width / 2} ${props.view.height / 2}) scale(${zoom()}) translate(${-x} ${-y})`;
	};

	const held = createMemo(() => {
		const picked = inkSelection();
		return picked?.path === STAGE_INK ? picked.ids : [];
	});
	const selection = createMemo(() => {
		const ids = new Set(held());
		if (ids.size === 0) return undefined;
		const box = inkBounds(props.strokes().filter((stroke) => ids.has(stroke.id)));
		const moving = gesture?.kind === "move" ? gesture : undefined;
		return box && moving ? { ...box, x: box.x + moving.dx, y: box.y + moving.dy } : box;
	});

	const clearLive = () => {
		live?.setAttribute("d", "");
		loop?.setAttribute("d", "");
	};

	/** The stroke under the pen, drawn straight into the DOM: a signal per sample is a frame late. */
	const paintLive = (drawn: Extract<Gesture, { kind: "draw" }>) => {
		if (!live) return;
		const shape = strokeShape({ id: "live", ...drawn.stroke, points: drawn.points });
		const paint = drawn.stroke.color === "ink" ? "var(--fg)" : inkPaint(drawn.stroke.color);
		live.setAttribute("d", shape.d);
		live.setAttribute("fill", shape.filled ? paint : "none");
		live.setAttribute("stroke", shape.filled ? "none" : paint);
		live.setAttribute("stroke-width", String(drawn.stroke.size));
		live.setAttribute("opacity", drawn.stroke.tool === "marker" ? "0.4" : "1");
	};

	const erase = (erasing: Extract<Gesture, { kind: "erase" }>, x: number, y: number) => {
		// Eight screen pixels of rubber, whatever the zoom.
		let more = false;
		for (const stroke of props.strokes()) {
			if (erasing.gone.has(stroke.id) || !hitStroke(stroke, x, y, 8 / zoom())) continue;
			erasing.gone.add(stroke.id);
			more = true;
		}
		if (more) props.layer.hide(new Set(erasing.gone));
	};

	const cancel = () => {
		if (!gesture) return;
		if (gesture.kind === "erase") props.layer.hide(undefined);
		if (gesture.kind === "move") props.layer.preview(undefined);
		gesture = undefined;
		clearLive();
	};

	const onDown = (event: PointerEvent) => {
		if (event.pointerType === "pen") setPenSeen(true);
		// A finger, once a pencil is about: the canvas's, so it goes on up to the stage untouched.
		if (event.pointerType === "touch" && penSeen()) return;
		if (event.pointerType === "mouse" && event.button !== 0) return;
		event.stopPropagation();
		if (gesture) {
			// A second finger is half of a pinch, and the first one's stroke is over.
			if (event.pointerType === "touch") cancel();
			return;
		}
		event.preventDefault();
		try {
			(event.currentTarget as Element).setPointerCapture(event.pointerId);
		} catch {
			/* a nicety: the stroke still ends on the sheet's own pointerup */
		}
		const point = props.toStage(event);
		const tool = inkTool();
		// The button on the barrel, or the other end of the pen, erases whatever tool is in hand.
		const rubber = event.pointerType === "pen" && (event.button === 5 || (event.buttons & 32) !== 0);

		if (tool === "eraser" || rubber) {
			setInkSelection(undefined);
			gesture = { kind: "erase", pointer: event.pointerId, gone: new Set() };
			erase(gesture, point.x, point.y);
			return;
		}
		if (tool === "lasso") {
			const box = selection();
			if (box && point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) {
				gesture = { kind: "move", pointer: event.pointerId, start: point, ids: [...held()], dx: 0, dy: 0, moved: false };
				return;
			}
			setInkSelection(undefined);
			gesture = { kind: "lasso", pointer: event.pointerId, polygon: [point.x, point.y] };
			return;
		}
		setInkSelection(undefined);
		gesture = { kind: "draw", pointer: event.pointerId, points: [point.x, point.y, pressureOf(event)], stroke: { tool, color: inkColor(), size: inkSize() } };
		paintLive(gesture);
	};

	const onMove = (event: PointerEvent) => {
		if (!gesture || gesture.pointer !== event.pointerId) return;
		event.stopPropagation();
		// A pencil reports faster than the screen draws; the samples in between are the line's shape.
		const samples = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
		const events = samples.length > 0 ? samples : [event];
		switch (gesture.kind) {
			case "draw":
				for (const sample of events) {
					const point = props.toStage(sample);
					gesture.points.push(point.x, point.y, pressureOf(sample));
				}
				paintLive(gesture);
				return;
			case "erase":
				for (const sample of events) {
					const point = props.toStage(sample);
					erase(gesture, point.x, point.y);
				}
				return;
			case "lasso": {
				for (const sample of events) {
					const point = props.toStage(sample);
					gesture.polygon.push(point.x, point.y);
				}
				const polygon = gesture.polygon;
				let d = "";
				for (let i = 0; i < polygon.length; i += 2) d += `${i === 0 ? "M" : "L"}${polygon[i]?.toFixed(1)} ${polygon[i + 1]?.toFixed(1)}`;
				loop?.setAttribute("d", d);
				return;
			}
			case "move": {
				const point = props.toStage(event);
				const dx = point.x - gesture.start.x;
				const dy = point.y - gesture.start.y;
				if (!gesture.moved && Math.hypot(dx, dy) * zoom() < 3) return;
				gesture.moved = true;
				gesture.dx = dx;
				gesture.dy = dy;
				props.layer.preview(new Map<string, PenPreview>(gesture.ids.map((id) => [id, { dx, dy }])));
				setInkSelection({ path: STAGE_INK, ids: [...gesture.ids] });
				return;
			}
		}
	};

	const onUp = (event: PointerEvent) => {
		if (!gesture || gesture.pointer !== event.pointerId) return;
		event.stopPropagation();
		const done = gesture;
		gesture = undefined;
		clearLive();
		if (event.type === "pointercancel") {
			if (done.kind === "erase") props.layer.hide(undefined);
			if (done.kind === "move") props.layer.preview(undefined);
			return;
		}
		switch (done.kind) {
			case "draw": {
				const points = simplify(done.points);
				const colour = done.stroke.color === "ink" ? props.colourEdit() : undefined;
				props.onEdit([...(colour ? [colour] : []), { op: "insert", node: inkItem({ ...done.stroke, points }, props.newId()) }]);
				return;
			}
			case "erase":
				// Hidden until the server's answer redraws the stage without them.
				if (done.gone.size) props.onEdit([...done.gone].map((id) => ({ op: "delete", id })));
				return;
			case "move":
				if (done.moved) props.onShift(done.ids, done.dx, done.dy);
				return;
			case "lasso": {
				const strokes = props.strokes();
				const [x0 = 0, y0 = 0] = done.polygon;
				const far = done.polygon.some((n, i) => Math.abs(n - (i % 2 === 0 ? x0 : y0)) * zoom() > 6);
				// A tap is "this one": the topmost stroke under it. A loop is what it goes round.
				const ids = far
					? lassoPick(strokes, done.polygon)
					: [...strokes].reverse().filter((stroke) => hitStroke(stroke, x0, y0, 6 / zoom())).slice(0, 1).map((stroke) => stroke.id);
				setInkSelection(ids.length > 0 ? { path: STAGE_INK, ids } : undefined);
				return;
			}
		}
	};

	onCleanup(() => {
		cancel();
		setInkSelection(undefined);
	});

	return (
		<svg
			class="stage-ink"
			data-tool={inkTool()}
			width={props.view.width}
			height={props.view.height}
			onPointerDown={onDown}
			onPointerMove={onMove}
			onPointerUp={onUp}
			onPointerCancel={onUp}
			// A long press with a pencil or a finger is not a request for the browser's menu.
			onContextMenu={(event) => event.preventDefault()}
		>
			<g transform={transform()}>
				<path ref={live} d="" stroke-linecap="round" stroke-linejoin="round" />
				<path ref={loop} class="ink-loop" d="" />
				<Show when={selection()}>
					{(box) => (
						<rect class="ink-selection" x={box().x - 4 / zoom()} y={box().y - 4 / zoom()} width={box().w + 8 / zoom()} height={box().h + 8 / zoom()} rx={4 / zoom()} />
					)}
				</Show>
			</g>
		</svg>
	);
}
