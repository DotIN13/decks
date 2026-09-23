import { hitStroke, inkBounds, inkPaint, lassoPick, simplify, strokeShape, type InkStroke } from "@decks/board-kit";
import type { Camera } from "@decks/protocol";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
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
	/** Take back the last edit, or put it back: a two- or three-finger tap. */
	onStep?: (direction: "undo" | "redo") => void;
}) {
	let live: SVGPathElement | undefined;
	let loop: SVGPathElement | undefined;
	let group: SVGGElement | undefined;

	/*
	 * A finished stroke stays on the glass until the stage has drawn it: it is sent to the server and
	 * drawn from the answer, and taking it off at the lift left a frame or more with no stroke at all.
	 * Each one waiting is a copy of the live path, marked with its id and taken off the moment that id
	 * is among the strokes the stage drew — the same frame the drawing shows it — or after a few
	 * seconds if the edit never came back.
	 */
	const waiting = new Map<string, { path: SVGPathElement; timer: ReturnType<typeof setTimeout> }>();
	const settle = (id: string) => {
		const held = waiting.get(id);
		if (!held) return;
		clearTimeout(held.timer);
		held.path.remove();
		waiting.delete(id);
	};
	const hold = (id: string) => {
		if (!live || !group) return;
		const path = live.cloneNode() as SVGPathElement;
		group.insertBefore(path, live);
		waiting.set(id, { path, timer: setTimeout(() => settle(id), 5000) });
	};
	createEffect(() => {
		const drawn = new Set(props.strokes().map((stroke) => stroke.id));
		for (const id of [...waiting.keys()]) if (drawn.has(id)) settle(id);
	});

	type Gesture =
		| {
				kind: "draw";
				pointer: number;
				points: number[];
				stroke: Omit<InkStroke, "points" | "id">;
				id?: string;
				/** Held still at the end, so the stroke became a straight line from where it began. */
				straight?: boolean;
				/** Where the pen last rested, and the timer that straightens the stroke if it stays. */
				still: { x: number; y: number };
				timer?: ReturnType<typeof setTimeout>;
		  }
		| {
				kind: "scale";
				pointer: number;
				anchor: { x: number; y: number };
				/** The dragged corner where it started, which sets the scale along the diagonal. */
				corner: { x: number; y: number };
				/** Each held stroke's box at the press: the preview redraws them, so they are read once. */
				boxes: Map<string, { x: number; y: number; w: number; h: number }>;
				scale: number;
		  }
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

	/** A corner of the lasso's box being dragged: the box is drawn at the new size while it is. */
	const [resizing, setResizing] = createSignal<{ anchor: { x: number; y: number }; by: number } | undefined>();
	const held = createMemo(() => {
		const picked = inkSelection();
		return picked?.path === STAGE_INK ? picked.ids : [];
	});
	const selection = createMemo(() => {
		const ids = new Set(held());
		if (ids.size === 0) return undefined;
		const box = inkBounds(props.strokes().filter((stroke) => ids.has(stroke.id)));
		const moving = gesture?.kind === "move" ? gesture : undefined;
		const scale = resizing();
		if (box && scale) {
			const x = scale.anchor.x + (box.x - scale.anchor.x) * scale.by;
			const y = scale.anchor.y + (box.y - scale.anchor.y) * scale.by;
			return { x, y, w: box.w * scale.by, h: box.h * scale.by };
		}
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
		if (gesture.kind === "move" || gesture.kind === "scale") props.layer.preview(undefined);
		if (gesture.kind === "draw") clearTimeout(gesture.timer);
		if (gesture.kind === "scale") setResizing(undefined);
		gesture = undefined;
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
		drawn.timer = setTimeout(() => {
			if (gesture !== drawn || drawn.straight) return;
			const [x0 = 0, y0 = 0] = drawn.points;
			const n = drawn.points.length;
			const x1 = drawn.points[n - 3] ?? x0;
			const y1 = drawn.points[n - 2] ?? y0;
			if (Math.hypot(x1 - x0, y1 - y0) * zoom() < 16) return;
			drawn.straight = true;
			drawn.points = [x0, y0, 0.5, x1, y1, 0.5];
			paintLive(drawn);
		}, HOLD_MS);
	};

	/*
	 * Two fingers tapped together take back the last edit, three put it back, as in a notes app. A tap
	 * is every finger down and up within a moment, none of them having travelled; watched on the
	 * window, because a finger this sheet lets through is captured by the stage beneath it.
	 */
	const fingers = new Map<number, { x: number; y: number }>();
	let tapStarted = 0;
	let tapMost = 0;
	let tapSpoiled = false;
	const fingerDown = (event: PointerEvent) => {
		if (fingers.size === 0) {
			tapStarted = performance.now();
			tapMost = 0;
			tapSpoiled = false;
		}
		fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		tapMost = Math.max(tapMost, fingers.size);
	};
	const fingerMove = (event: PointerEvent) => {
		const at = fingers.get(event.pointerId);
		if (at && Math.hypot(event.clientX - at.x, event.clientY - at.y) > 12) tapSpoiled = true;
	};
	const fingerUp = (event: PointerEvent) => {
		if (!fingers.delete(event.pointerId) || fingers.size > 0) return;
		if (event.type === "pointercancel" || tapSpoiled || tapMost < 2 || performance.now() - tapStarted > 400) return;
		props.onStep?.(tapMost === 2 ? "undo" : "redo");
	};
	addEventListener("pointermove", fingerMove, true);
	addEventListener("pointerup", fingerUp, true);
	addEventListener("pointercancel", fingerUp, true);
	onCleanup(() => {
		removeEventListener("pointermove", fingerMove, true);
		removeEventListener("pointerup", fingerUp, true);
		removeEventListener("pointercancel", fingerUp, true);
	});

	/**
	 * A corner of the lasso's box, dragged: what the lasso holds grows or shrinks about the opposite
	 * corner, keeping its shape, as a notes app's selection does.
	 */
	const startScale = (event: PointerEvent, corner: "nw" | "ne" | "sw" | "se") => {
		const box = selection();
		if (!box || gesture || (event.pointerType === "mouse" && event.button !== 0)) return;
		event.stopPropagation();
		event.preventDefault();
		try {
			(event.currentTarget as SVGElement).ownerSVGElement?.setPointerCapture(event.pointerId);
		} catch {
			/* the sheet's own pointerup still ends it */
		}
		const anchor = { x: corner.includes("w") ? box.x + box.w : box.x, y: corner.includes("n") ? box.y + box.h : box.y };
		const at = { x: corner.includes("w") ? box.x : box.x + box.w, y: corner.includes("n") ? box.y : box.y + box.h };
		const boxes = new Map(held().flatMap((id) => {
			const placed = props.layer.placed.get(id)?.box;
			return placed ? [[id, { ...placed }] as const] : [];
		}));
		gesture = { kind: "scale", pointer: event.pointerId, anchor, corner: at, boxes, scale: 1 };
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

	const onDown = (event: PointerEvent) => {
		if (event.pointerType === "touch") fingerDown(event);
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
		gesture = { kind: "draw", pointer: event.pointerId, points: [point.x, point.y, pressureOf(event)], stroke: { tool, color: inkColor(), size: inkSize() }, still: point };
		rest(gesture, point.x, point.y);
		paintLive(gesture);
	};

	const onMove = (event: PointerEvent) => {
		if (!gesture || gesture.pointer !== event.pointerId) return;
		event.stopPropagation();
		// A pencil reports faster than the screen draws; the samples in between are the line's shape.
		const samples = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
		const events = samples.length > 0 ? samples : [event];
		switch (gesture.kind) {
			case "draw": {
				const drawn = gesture;
				if (drawn.straight) {
					// A straightened stroke is a line from its start to the pen.
					const point = props.toStage(event);
					drawn.points.splice(3, 3, point.x, point.y, 0.5);
					paintLive(drawn);
					return;
				}
				for (const sample of events) {
					const point = props.toStage(sample);
					drawn.points.push(point.x, point.y, pressureOf(sample));
				}
				const last = props.toStage(event);
				// Resting means staying within a few screen pixels; anything more starts the wait again.
				if (Math.hypot(last.x - drawn.still.x, last.y - drawn.still.y) * zoom() > 3) rest(drawn, last.x, last.y);
				paintLive(drawn);
				return;
			}
			case "scale": {
				const point = props.toStage(event);
				const { anchor, corner } = gesture;
				// How far along the box's diagonal the pointer is: the shape is kept, whichever way it goes.
				const diagonal = { x: corner.x - anchor.x, y: corner.y - anchor.y };
				const length = diagonal.x * diagonal.x + diagonal.y * diagonal.y || 1;
				gesture.scale = Math.max(0.05, ((point.x - anchor.x) * diagonal.x + (point.y - anchor.y) * diagonal.y) / length);
				props.layer.preview(scaled(gesture.boxes, anchor, gesture.scale));
				setResizing({ anchor, by: gesture.scale });
				return;
			}
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
		if (done.kind === "draw") clearTimeout(done.timer);
		if (done.kind === "scale") setResizing(undefined);
		if (done.kind === "draw" && event.type !== "pointercancel") {
			done.id = props.newId();
			hold(done.id);
		}
		clearLive();
		if (event.type === "pointercancel") {
			if (done.kind === "erase") props.layer.hide(undefined);
			if (done.kind === "move" || done.kind === "scale") props.layer.preview(undefined);
			return;
		}
		switch (done.kind) {
			case "draw": {
				const points = simplify(done.points);
				const colour = done.stroke.color === "ink" ? props.colourEdit() : undefined;
				props.onEdit([...(colour ? [colour] : []), { op: "insert", node: inkItem({ ...done.stroke, points }, done.id ?? props.newId()) }]);
				return;
			}
			case "erase":
				// Hidden until the server's answer redraws the stage without them.
				if (done.gone.size) props.onEdit([...done.gone].map((id) => ({ op: "delete", id })));
				return;
			case "move":
				if (done.moved) props.onShift(done.ids, done.dx, done.dy);
				return;
			case "scale": {
				if (done.scale === 1) return props.layer.preview(undefined);
				const r = (n: number) => Math.round(n * 10) / 10;
				const ops = [...scaled(done.boxes, done.anchor, done.scale)].flatMap(([id, change]) => {
					const box = done.boxes.get(id);
					if (!box) return [];
					const x = box.x + change.dx;
					const y = box.y + change.dy;
					return [{ op: "update", id, box: { x1: r(x), y1: r(y), x2: r(x + (change.w ?? box.w)), y2: r(y + (change.h ?? box.h)) } }];
				});
				props.onEdit(ops);
				return;
			}
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
		for (const id of [...waiting.keys()]) settle(id);
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
			<g ref={group} transform={transform()}>
				<path ref={live} d="" stroke-linecap="round" stroke-linejoin="round" />
				<path ref={loop} class="ink-loop" d="" />
				<Show when={selection()}>
					{(box) => (
						<>
							<rect class="ink-selection" x={box().x - 4 / zoom()} y={box().y - 4 / zoom()} width={box().w + 8 / zoom()} height={box().h + 8 / zoom()} rx={4 / zoom()} />
							{/* The corners that resize what the lasso holds. */}
							<For each={["nw", "ne", "sw", "se"] as const}>
								{(corner) => {
									const size = () => 12 / zoom();
									return (
										<rect
											class="ink-corner"
											data-corner={corner}
											x={(corner.includes("w") ? box().x - 4 / zoom() : box().x + box().w + 4 / zoom()) - size() / 2}
											y={(corner.includes("n") ? box().y - 4 / zoom() : box().y + box().h + 4 / zoom()) - size() / 2}
											width={size()}
											height={size()}
											rx={2 / zoom()}
											stroke-width={1.5 / zoom()}
											onPointerDown={(event) => startScale(event, corner)}
										/>
									);
								}}
							</For>
						</>
					)}
				</Show>
			</g>
		</svg>
	);
}
