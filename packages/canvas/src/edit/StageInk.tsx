import { hitStroke, inkBounds, inkShaper, lassoPick, simplify, strokeShape, type InkStroke } from "@decks/ink";
import type { Camera } from "@decks/protocol";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { inkColor, inkSelection, inkSize, inkTool, penSeen, setInkSelection, setPenSeen } from "./ink.ts";
import { inkHex, inkItem } from "../model/ink.ts";
import type { StageEngine } from "../render/engine.ts";
import type { LiveInk, PenPreview } from "../render/types.ts";
import { scheme } from "../lib/theme.ts";

/** What the lasso holds is marked with this path, since ink is the stage's now and not a board's. */
export const STAGE_INK = "stage";

/** A touch this soon after the pencil leaves the glass is the hand that held it. */
const PALM_AFTER_MS = 500;

/**
 * Drawing on the stage: a sheet of glass over the whole canvas while the draw tool is on.
 *
 * What is drawn goes into the stage's `.pen` file as ink (`ink.ts`), one pen `path` per stroke,
 * through the same edits an agent sends. The strokes in the file are drawn on the stage's one sheet
 * (`scene.ts`) as items. The stroke under the pen, before it is in the file, is drawn here, on this
 * glass, as SVG paths shaped as the sheet shapes ink, at most once a frame: handing it to the sheet
 * redrew the whole sheet, three screens of pixels, for every sample, and on an iPad that is two
 * samples a frame (Safari gives no coalesced events). The glass also takes the pointer, and shows
 * the lasso's loop and the box round what the lasso took.
 *
 * **Which pointer draws.** A pen, with its pressure, and a mouse. A finger draws only on a device
 * that has never shown a pencil (a phone, an iPad without one; remembered, `state/ink.ts`), and a
 * second finger ends its stroke; once a pencil has been seen, a finger is the canvas's and goes on up
 * to the stage, one finger to pan, two to pan and pinch. A palm is ignored as far as it can be while
 * the pencil is in use: any touch while the pencil is on the glass or has just left it
 * (`PALM_AFTER_MS`) does nothing at all, neither drawing nor moving the canvas. iPadOS turns away a
 * resting palm by itself.
 */
export function StageInk(props: {
	camera: Camera;
	view: { width: number; height: number };
	toStage: (event: PointerEvent) => { x: number; y: number };
	/** The ink on the stage now, each stroke in stage pixels. */
	strokes: () => InkStroke[];
	layer: StageEngine;
	/** A new stroke's pen item; the drawing's edit defines its colour's variable when it lacks it (`withDecksColors`). */
	onEdit: (ops: unknown[]) => void;
	newId: () => string;
	/** Move items by this much, as every other move on the stage does. */
	onShift: (ids: readonly string[], dx: number, dy: number) => void;
	/** Take back the last edit, or put it back: a two- or three-finger tap. */
	onStep?: (direction: "undo" | "redo") => void;
}) {
	let loop: SVGPathElement | undefined;
	/** The stroke under the pen, as it is drawn. */
	let live: LiveInk | undefined;
	/** The stroke has new samples since it was last shaped: it is shaped again at the next frame. */
	let reshape: Extract<Gesture, { kind: "draw" }> | undefined;
	/** Where the live paths go, and each one drawn, with the path text it last had. */
	let inkLayer: SVGGElement | undefined;
	const shown = new Map<string, { el: SVGPathElement; d: string }>();
	let frame = 0;

	/*
	 * A finished stroke stays on the sheet as live ink until the stage has drawn it: it is sent to the
	 * server and drawn from the answer, and taking it off at the lift left a frame or more with no
	 * stroke at all. Each one waiting is the live stroke under its id, taken off the moment that id
	 * is among the strokes the stage drew — the same layout the drawing shows it in — or after a few
	 * seconds if the edit never came back.
	 */
	const waiting = new Map<string, { ink: LiveInk; timer: ReturnType<typeof setTimeout> }>();
	/** Draw the live strokes at the next frame, however many samples come before it. */
	const sendInk = () => {
		if (!frame) frame = requestAnimationFrame(paintInk);
	};
	const paintInk = () => {
		frame = 0;
		if (reshape) live = liveOf(reshape);
		reshape = undefined;
		const want = [...[...waiting.values()].map((held) => held.ink), ...(live ? [live] : [])];
		/*
		 * Drawn by the engine, the painter that draws the saved stroke: as SVG it came out lighter than
		 * the engine's 4× multisampled tiles draw the same outline, and the stroke thickened as the copy
		 * came off. Once a frame, so it holds the frame rate (60 fps on an iPad mini, as the SVG did); the
		 * SVG is kept behind `__inkOnSvg`.
		 */
		if (!(globalThis as { __inkOnSvg?: boolean }).__inkOnSvg) {
			props.layer.ink(want);
			for (const [, path] of shown) path.el.remove();
			shown.clear();
			return;
		}
		const keep = new Set(want.map((ink) => ink.id));
		for (const [id, path] of shown) {
			if (keep.has(id)) continue;
			path.el.remove();
			shown.delete(id);
		}
		for (const ink of want) {
			let path = shown.get(ink.id);
			if (!path) {
				const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
				el.setAttribute("class", "ink-live");
				el.setAttribute("stroke-linecap", "round");
				el.setAttribute("stroke-linejoin", "round");
				inkLayer?.append(el);
				path = { el, d: "" };
				shown.set(ink.id, path);
			}
			if (path.d === ink.d) continue;
			path.d = ink.d;
			// As the sheet paints ink (`paint_ink`): a pressure stroke is its outline filled, nonzero as SVG's own rule; any other a round line.
			path.el.setAttribute("d", ink.d);
			path.el.setAttribute("fill", ink.filled ? ink.color : "none");
			path.el.setAttribute("stroke", ink.filled ? "none" : ink.color);
			path.el.setAttribute("stroke-width", String(ink.size));
			path.el.setAttribute("opacity", String(ink.opacity));
		}
	};
	const settle = (id: string) => {
		const held = waiting.get(id);
		if (!held) return;
		clearTimeout(held.timer);
		waiting.delete(id);
		sendInk();
	};
	const hold = (id: string) => {
		if (reshape) live = liveOf(reshape);
		reshape = undefined;
		if (!live) return;
		// The path drawn for the live stroke is this one now: no frame without it.
		const path = shown.get(live.id);
		if (path) {
			shown.delete(live.id);
			shown.set(id, path);
		}
		waiting.set(id, { ink: { ...live, id }, timer: setTimeout(() => settle(id), 5000) });
	};
	/*
	 * In the file is not yet on the sheet: the sheet's worker paints the tiles it falls in after the
	 * drawing arrives, so the glass keeps its copy until the engine says a frame painted after the
	 * drawing went to it is on screen (`mark`, `shows`), the handoff the text editor's ghost makes too.
	 * A fixed 250ms was short on an iPad, where the tiles took longer: for a moment neither copy showed,
	 * and the stroke flickered. The mark is taken a frame after the strokes change, once the drawing has
	 * gone to the engine; the five seconds `hold` set are still the limit.
	 */
	const handedOver = new Set<string>();
	const handOver = (id: string) => {
		if (handedOver.has(id)) return;
		handedOver.add(id);
		requestAnimationFrame(() => {
			const mark = props.layer.mark();
			const wait = () => {
				if (!waiting.has(id)) return void handedOver.delete(id);
				if (!props.layer.shows(mark)) return void requestAnimationFrame(wait);
				// The frame that shows it is up: the next one draws without the glass's copy.
				requestAnimationFrame(() => {
					handedOver.delete(id);
					settle(id);
				});
			};
			wait();
		});
	};
	createEffect(() => {
		const drawn = new Set(props.strokes().map((stroke) => stroke.id));
		for (const id of waiting.keys()) if (drawn.has(id)) handOver(id);
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
		const had = !!live || !!reshape;
		live = undefined;
		reshape = undefined;
		shaper = inkShaper();
		if (had) sendInk();
		loop?.setAttribute("d", "");
	};

	/** The stroke under the pen has changed: it is shaped and drawn at the next frame. */
	const paintLive = (drawn: Extract<Gesture, { kind: "draw" }>) => {
		reshape = drawn;
		sendInk();
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
		// A palm lifted wherever it was: forgotten, whether or not the glass heard it.
		if (palms.has(event.pointerId)) queueMicrotask(() => palms.delete(event.pointerId));
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
			fingerDown(event);
			// With a pencil about, a finger is the canvas's: it goes on up to the stage, one to pan, two to pan and pinch.
			if (penSeen()) return;
			// Without one, a finger draws, and a second finger is half of a pinch: the first one's stroke is over.
			if (gesture) {
				cancel();
				return;
			}
		}
		if (event.pointerType === "pen") {
			setPenSeen(true);
			penDown = true;
		}
		if (event.pointerType === "mouse" && event.button !== 0) return;
		event.stopPropagation();
		if (gesture) return;
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
		// A palm's moves go nowhere, the canvas included.
		if (palms.has(event.pointerId)) {
			event.stopPropagation();
			return;
		}
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
		if (event.pointerType === "pen" && event.type !== "lostpointercapture") {
			penDown = false;
			penUpAt = performance.now();
		}
		if (palms.delete(event.pointerId)) {
			event.stopPropagation();
			return;
		}
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
				props.onEdit([{ op: "insert", node: inkItem({ ...done.stroke, points }, done.id ?? props.newId()) }]);
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

	/*
	 * The pencil's touches are this sheet's alone. Safari on an iPad keeps a pencil press that comes
	 * hard after a stroke for its own gestures (Scribble's handwriting, a double tap) and never hands
	 * the page its pointerdown: the next stroke did nothing. Cancelling the browser's default for the
	 * stylus's touch events, which pointer events cannot do, keeps every press a stroke. Fingers are
	 * left alone: they pan and pinch.
	 */
	let sheet: SVGSVGElement | undefined;
	onMount(() => {
		if (!sheet) return;
		const own = (event: TouchEvent) => {
			for (const touch of Array.from(event.changedTouches)) {
				if ((touch as Touch & { touchType?: string }).touchType === "stylus") {
					if (event.cancelable) event.preventDefault();
					return;
				}
			}
		};
		const options = { passive: false } as const;
		for (const type of ["touchstart", "touchmove", "touchend"] as const) sheet.addEventListener(type, own, options);
		onCleanup(() => {
			for (const type of ["touchstart", "touchmove", "touchend"] as const) sheet?.removeEventListener(type, own);
		});
	});

	onCleanup(() => {
		cancel();
		setInkSelection(undefined);
		for (const id of [...waiting.keys()]) settle(id);
		cancelAnimationFrame(frame);
		// The engine's copies go with the sheet.
		props.layer.ink([]);
	});

	return (
		<svg
			ref={sheet}
			class="stage-ink"
			data-tool={inkTool()}
			width={props.view.width}
			height={props.view.height}
			onPointerDown={onDown}
			onPointerMove={onMove}
			onPointerUp={onUp}
			onPointerCancel={onUp}
			// The capture taken away mid-stroke (the browser's, not the pen's lift): the stroke ends there.
			onLostPointerCapture={onUp}
			// A long press with a pencil or a finger is not a request for the browser's menu.
			onContextMenu={(event) => event.preventDefault()}
		>
			<g transform={transform()}>
				<g ref={inkLayer} class="ink-live-layer" pointer-events="none" />
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
