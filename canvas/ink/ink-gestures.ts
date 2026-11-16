import { hitStroke, lassoPick, simplify, type InkStroke } from "./index.ts";
import type { Camera } from "@decks/protocol-old";
import { inkColor, inkSize, inkTool, penSeen, setInkSelection, setPenSeen } from "./ink.ts";
import { inkItem } from "./model.ts";
import type { StageEngine } from "../render/engine.ts";
import type { PenPreview } from "../render/types.ts";
import { knobs } from "../debug.ts";
import { clearLive, hold, paintLive, type LiveCtx } from "./live-ink.ts";

// What a pointer on the glass does: draw, erase, lasso, move or scale what
// the lasso holds; which pointer counts (a palm does not); and the finger taps.

/** What the lasso holds is marked with this path, since ink is the stage's now and not a board's. */
export const STAGE_INK = "stage";

/** A touch this soon after the pencil leaves the glass is the hand that held it. */
const PALM_AFTER_MS = 500;

export type InkProps = {
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
};

type Box = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };

export type Gesture =
	| {
			kind: "draw";
			pointer: number;
			points: number[];
			stroke: Omit<InkStroke, "points" | "id">;
			id?: string;
			/** Held still at the end, so the stroke became a straight line from where it began. */
			straight?: boolean;
			/** Where the pen last rested, and the timer that straightens the stroke if it stays. */
			still: Point;
			timer?: ReturnType<typeof setTimeout>;
	  }
	| {
			kind: "scale";
			pointer: number;
			anchor: Point;
			/** The dragged corner where it started, which sets the scale along the diagonal. */
			corner: Point;
			/** Each held stroke's box at the press: the preview redraws them, so they are read once. */
			boxes: Map<string, Box>;
			scale: number;
	  }
	| { kind: "erase"; pointer: number; gone: Set<string> }
	| { kind: "lasso"; pointer: number; polygon: number[] }
	| { kind: "move"; pointer: number; start: Point; ids: string[]; dx: number; dy: number; moved: boolean };

type Of<K extends Gesture["kind"]> = Extract<Gesture, { kind: K }>;

/** The glass's state: the live stroke's, the gesture under way, the finger taps' and the palms'. */
export type InkCtx = LiveCtx & {
	props: InkProps;
	gesture?: Gesture;
	/** A corner of the lasso's box being dragged: the box is drawn at the new size while it is. */
	setResizing: (to: { anchor: Point; by: number } | undefined) => void;
	held: () => string[];
	selection: () => Box | undefined;
	fingers: Map<number, Point>;
	tapStarted: number;
	tapMost: number;
	tapSpoiled: boolean;
	/** Whether the pencil is on the glass, when it last left it, and the touches taken for a palm. */
	penDown: boolean;
	penUpAt: number;
	palms: Set<number>;
};

const zoom = (c: InkCtx) => c.props.camera.zoom || 1;
const pressureOf = (event: PointerEvent) => (event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 0.5);

/*
 * A palm is a touch while the pencil is on the glass or has only just left it. Not a wide touch: a
 * finger on an iPad reports a contact 70px across often enough that a pan or a pinch with the draw
 * tool on was taken for a palm and did nothing, and iPadOS turns a resting palm away by itself while
 * the Pencil is in use.
 */
export const palm = (c: InkCtx) => c.penDown || performance.now() - c.penUpAt < PALM_AFTER_MS;

/** A touch taken for a palm: it does nothing, not even a pan. */
export function takePalm(c: InkCtx, event: PointerEvent): void {
	c.palms.add(event.pointerId);
	event.preventDefault();
	event.stopPropagation();
}

// The press.
export function onDown(c: InkCtx, event: PointerEvent): void {
	if (event.pointerType === "touch") {
		if (palm(c)) return takePalm(c, event);
		fingerDown(c, event);
		// With a pencil about, a finger is the canvas's: it goes on up to the stage, one to pan, two to pan and pinch.
		if (penSeen()) return;
		// Without one, a finger draws, and a second finger is half of a pinch: the first one's stroke is over.
		if (c.gesture) return cancel(c);
	}
	if (event.pointerType === "pen") {
		setPenSeen(true);
		c.penDown = true;
	}
	if (event.pointerType === "mouse" && event.button !== 0) return;
	event.stopPropagation();
	if (c.gesture) return;
	event.preventDefault();
	try {
		(event.currentTarget as Element).setPointerCapture(event.pointerId);
	} catch {
		/* a nicety: the stroke still ends on the sheet's own pointerup */
	}
	begin(c, event, c.props.toStage(event));
}

/** The gesture a press starts, by the tool in hand and where it lands. */
function begin(c: InkCtx, event: PointerEvent, point: Point): void {
	const tool = inkTool();
	// The button on the barrel, or the other end of the pen, erases whatever tool is in hand.
	const rubber = event.pointerType === "pen" && (event.button === 5 || (event.buttons & 32) !== 0);
	if (tool === "eraser" || rubber) {
		setInkSelection(undefined);
		const erasing: Of<"erase"> = { kind: "erase", pointer: event.pointerId, gone: new Set() };
		c.gesture = erasing;
		return erase(c, erasing, point.x, point.y);
	}
	if (tool === "lasso") {
		const box = c.selection();
		if (box && point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h) {
			c.gesture = { kind: "move", pointer: event.pointerId, start: point, ids: [...c.held()], dx: 0, dy: 0, moved: false };
			return;
		}
		setInkSelection(undefined);
		c.gesture = { kind: "lasso", pointer: event.pointerId, polygon: [point.x, point.y] };
		return;
	}
	setInkSelection(undefined);
	const drawn: Of<"draw"> = { kind: "draw", pointer: event.pointerId, points: [point.x, point.y, pressureOf(event)], stroke: { tool, color: inkColor(), size: inkSize() }, still: point };
	c.gesture = drawn;
	rest(c, drawn, point.x, point.y);
	paintLive(c, drawn);
}

/**
 * A corner of the lasso's box, dragged: what the lasso holds grows or shrinks about the opposite
 * corner, keeping its shape, as a notes app's selection does.
 */
export function startScale(c: InkCtx, event: PointerEvent, corner: "nw" | "ne" | "sw" | "se"): void {
	const box = c.selection();
	if (!box || c.gesture || (event.pointerType === "mouse" && event.button !== 0)) return;
	event.stopPropagation();
	event.preventDefault();
	try {
		(event.currentTarget as SVGElement).ownerSVGElement?.setPointerCapture(event.pointerId);
	} catch {
		/* the sheet's own pointerup still ends it */
	}
	const anchor = { x: corner.includes("w") ? box.x + box.w : box.x, y: corner.includes("n") ? box.y + box.h : box.y };
	const at = { x: corner.includes("w") ? box.x : box.x + box.w, y: corner.includes("n") ? box.y : box.y + box.h };
	const boxes = new Map(c.held().flatMap((id) => {
		const placed = c.props.layer.placed.get(id)?.box;
		return placed ? [[id, { ...placed }] as const] : [];
	}));
	c.gesture = { kind: "scale", pointer: event.pointerId, anchor, corner: at, boxes, scale: 1 };
}

// The moves.
export function onMove(c: InkCtx, event: PointerEvent): void {
	// A palm's moves go nowhere, the canvas included.
	if (c.palms.has(event.pointerId)) return void event.stopPropagation();
	const gesture = c.gesture;
	if (!gesture || gesture.pointer !== event.pointerId) return;
	event.stopPropagation();
	// A pencil reports faster than the screen draws; the samples in between are the line's shape.
	const samples = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
	const events = samples.length > 0 ? samples : [event];
	switch (gesture.kind) {
		case "draw":
			return moveDraw(c, gesture, event, events);
		case "scale":
			return moveScale(c, gesture, c.props.toStage(event));
		case "erase":
			for (const sample of events) {
				const point = c.props.toStage(sample);
				erase(c, gesture, point.x, point.y);
			}
			return;
		case "lasso":
			return moveLasso(c, gesture, events);
		case "move":
			return moveHeld(c, gesture, c.props.toStage(event));
	}
}

function moveDraw(c: InkCtx, drawn: Of<"draw">, event: PointerEvent, events: PointerEvent[]): void {
	if (drawn.straight) {
		// A straightened stroke is a line from its start to the pen.
		const point = c.props.toStage(event);
		drawn.points.splice(3, 3, point.x, point.y, 0.5);
		return paintLive(c, drawn);
	}
	for (const sample of events) {
		const point = c.props.toStage(sample);
		drawn.points.push(point.x, point.y, pressureOf(sample));
	}
	const last = c.props.toStage(event);
	// Resting means staying within a few screen pixels; anything more starts the wait again.
	if (Math.hypot(last.x - drawn.still.x, last.y - drawn.still.y) * zoom(c) > 3) rest(c, drawn, last.x, last.y);
	paintLive(c, drawn);
}

function moveScale(c: InkCtx, scaling: Of<"scale">, point: Point): void {
	const { anchor, corner } = scaling;
	// How far along the box's diagonal the pointer is: the shape is kept, whichever way it goes.
	const diagonal = { x: corner.x - anchor.x, y: corner.y - anchor.y };
	const length = diagonal.x * diagonal.x + diagonal.y * diagonal.y || 1;
	scaling.scale = Math.max(0.05, ((point.x - anchor.x) * diagonal.x + (point.y - anchor.y) * diagonal.y) / length);
	c.props.layer.preview(scaled(scaling.boxes, anchor, scaling.scale));
	c.setResizing({ anchor, by: scaling.scale });
}

function moveLasso(c: InkCtx, lasso: Of<"lasso">, events: PointerEvent[]): void {
	for (const sample of events) {
		const point = c.props.toStage(sample);
		lasso.polygon.push(point.x, point.y);
	}
	const polygon = lasso.polygon;
	let d = "";
	for (let i = 0; i < polygon.length; i += 2) d += `${i === 0 ? "M" : "L"}${polygon[i]?.toFixed(1)} ${polygon[i + 1]?.toFixed(1)}`;
	c.loop?.setAttribute("d", d);
}

function moveHeld(c: InkCtx, moving: Of<"move">, point: Point): void {
	const dx = point.x - moving.start.x;
	const dy = point.y - moving.start.y;
	if (!moving.moved && Math.hypot(dx, dy) * zoom(c) < 3) return;
	moving.moved = true;
	moving.dx = dx;
	moving.dy = dy;
	c.props.layer.preview(new Map<string, PenPreview>(moving.ids.map((id) => [id, { dx, dy }])));
	setInkSelection({ path: STAGE_INK, ids: [...moving.ids] });
}

function erase(c: InkCtx, erasing: Of<"erase">, x: number, y: number): void {
	// Eight screen pixels of rubber, whatever the zoom.
	let more = false;
	for (const stroke of c.props.strokes()) {
		if (erasing.gone.has(stroke.id) || !hitStroke(stroke, x, y, 8 / zoom(c))) continue;
		erasing.gone.add(stroke.id);
		more = true;
	}
	if (more) c.props.layer.hide(new Set(erasing.gone));
}

/*
 * Hold at the end of a stroke and it straightens, as a notes app does: the pen resting for half a
 * second, having drawn something longer than a tap, turns the stroke into a line from where it
 * began to where the pen is, and the line follows the pen until it lifts.
 */
const HOLD_MS = 500;
function rest(c: InkCtx, drawn: Of<"draw">, x: number, y: number): void {
	clearTimeout(drawn.timer);
	drawn.still = { x, y };
	if (knobs.noHold) return;
	drawn.timer = setTimeout(() => {
		if (c.gesture !== drawn || drawn.straight) return;
		const [x0 = 0, y0 = 0] = drawn.points;
		const n = drawn.points.length;
		const x1 = drawn.points[n - 3] ?? x0;
		const y1 = drawn.points[n - 2] ?? y0;
		if (Math.hypot(x1 - x0, y1 - y0) * zoom(c) < 16) return;
		drawn.straight = true;
		drawn.points = [x0, y0, 0.5, x1, y1, 0.5];
		paintLive(c, drawn);
	}, HOLD_MS);
}

// The lift.
export function onUp(c: InkCtx, event: PointerEvent): void {
	if (event.pointerType === "pen" && event.type !== "lostpointercapture") {
		c.penDown = false;
		c.penUpAt = performance.now();
	}
	if (c.palms.delete(event.pointerId)) return void event.stopPropagation();
	const done = c.gesture;
	if (!done || done.pointer !== event.pointerId) return;
	event.stopPropagation();
	c.gesture = undefined;
	if (done.kind === "draw") clearTimeout(done.timer);
	if (done.kind === "scale") c.setResizing(undefined);
	if (done.kind === "draw" && event.type !== "pointercancel") {
		done.id = c.props.newId();
		hold(c, done.id);
	}
	clearLive(c);
	if (event.type === "pointercancel") {
		if (done.kind === "erase") c.props.layer.hide(undefined);
		if (done.kind === "move" || done.kind === "scale") c.props.layer.preview(undefined);
		return;
	}
	finish(c, done);
}

/** What a finished gesture leaves: a stroke saved, strokes deleted, moved or resized, or a selection. */
function finish(c: InkCtx, done: Gesture): void {
	switch (done.kind) {
		case "draw": {
			const points = simplify(done.points);
			c.props.onEdit([{ op: "insert", node: inkItem({ ...done.stroke, points }, done.id ?? c.props.newId()) }]);
			return;
		}
		case "erase":
			// Hidden until the server's answer redraws the stage without them.
			if (done.gone.size) c.props.onEdit([...done.gone].map((id) => ({ op: "delete", id })));
			return;
		case "move":
			if (done.moved) c.props.onShift(done.ids, done.dx, done.dy);
			return;
		case "scale":
			if (done.scale === 1) return c.props.layer.preview(undefined);
			return c.props.onEdit(resized(done));
		case "lasso":
			return pick(c, done);
	}
}

/** Each held stroke's box as it was at the press, scaled about `anchor` by `scale`, as the change a preview draws. */
function scaled(boxes: ReadonlyMap<string, Box>, anchor: Point, scale: number): Map<string, PenPreview> {
	return new Map<string, PenPreview>(
		[...boxes].map(([id, box]) => {
			const x = anchor.x + (box.x - anchor.x) * scale;
			const y = anchor.y + (box.y - anchor.y) * scale;
			return [id, { dx: x - box.x, dy: y - box.y, w: box.w * scale, h: box.h * scale }];
		}),
	);
}

/** The edits that give each held stroke its scaled box, to a tenth of a pixel. */
function resized(done: Of<"scale">): unknown[] {
	const r = (n: number) => Math.round(n * 10) / 10;
	return [...scaled(done.boxes, done.anchor, done.scale)].flatMap(([id, change]) => {
		const box = done.boxes.get(id);
		if (!box) return [];
		const x = box.x + change.dx;
		const y = box.y + change.dy;
		return [{ op: "update", id, box: { x1: r(x), y1: r(y), x2: r(x + (change.w ?? box.w)), y2: r(y + (change.h ?? box.h)) } }];
	});
}

function pick(c: InkCtx, done: Of<"lasso">): void {
	const strokes = c.props.strokes();
	const [x0 = 0, y0 = 0] = done.polygon;
	const far = done.polygon.some((n, i) => Math.abs(n - (i % 2 === 0 ? x0 : y0)) * zoom(c) > 6);
	// A tap is "this one": the topmost stroke under it. A loop is what it goes round.
	const ids = far
		? lassoPick(strokes, done.polygon)
		: [...strokes].reverse().filter((stroke) => hitStroke(stroke, x0, y0, 6 / zoom(c))).slice(0, 1).map((stroke) => stroke.id);
	setInkSelection(ids.length > 0 ? { path: STAGE_INK, ids } : undefined);
}

/** The gesture under way is dropped, and nothing it did so far stays. */
export function cancel(c: InkCtx): void {
	const gesture = c.gesture;
	if (!gesture) return;
	if (gesture.kind === "erase") c.props.layer.hide(undefined);
	if (gesture.kind === "move" || gesture.kind === "scale") c.props.layer.preview(undefined);
	if (gesture.kind === "draw") clearTimeout(gesture.timer);
	if (gesture.kind === "scale") c.setResizing(undefined);
	c.gesture = undefined;
	clearLive(c);
}

/*
 * Two fingers tapped together take back the last edit, three put it back, as in a notes app. A tap
 * is every finger down and up within a moment, none of them having travelled; watched on the
 * window, because a finger this sheet lets through is captured by the stage beneath it.
 */
export function fingerDown(c: InkCtx, event: PointerEvent): void {
	if (c.fingers.size === 0) {
		c.tapStarted = performance.now();
		c.tapMost = 0;
		c.tapSpoiled = false;
	}
	c.fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
	c.tapMost = Math.max(c.tapMost, c.fingers.size);
}

function fingerMove(c: InkCtx, event: PointerEvent): void {
	const at = c.fingers.get(event.pointerId);
	if (at && Math.hypot(event.clientX - at.x, event.clientY - at.y) > 12) c.tapSpoiled = true;
}

function fingerUp(c: InkCtx, event: PointerEvent): void {
	// A palm lifted wherever it was: forgotten, whether or not the glass heard it.
	if (c.palms.has(event.pointerId)) queueMicrotask(() => c.palms.delete(event.pointerId));
	if (!c.fingers.delete(event.pointerId) || c.fingers.size > 0) return;
	if (event.type === "pointercancel" || c.tapSpoiled || c.tapMost < 2 || performance.now() - c.tapStarted > 400) return;
	c.props.onStep?.(c.tapMost === 2 ? "undo" : "redo");
}

/** Watch every finger on the window for the taps; answers what stops watching. */
export function listenTaps(c: InkCtx): () => void {
	const move = (event: PointerEvent) => fingerMove(c, event);
	const up = (event: PointerEvent) => fingerUp(c, event);
	addEventListener("pointermove", move, true);
	addEventListener("pointerup", up, true);
	addEventListener("pointercancel", up, true);
	return () => {
		removeEventListener("pointermove", move, true);
		removeEventListener("pointerup", up, true);
		removeEventListener("pointercancel", up, true);
	};
}
