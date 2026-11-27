import { inkBounds, type InkStroke } from "@decks/ink";
import type { Camera } from "@decks/protocol";
import { createMemo, createSignal, For, Show } from "solid-js";
import { inkSelection, inkTool, penSeen } from "./ink.ts";
import type { CanvasEngine } from "../render/engine.ts";
import type { LiveInk } from "../render/types.ts";
import { mountInkSheet } from "./ink-sheet.ts";
import { createPenUp } from "./pen-up.ts";
import { CANVAS_INK } from "./ink.ts";
import { createPenMove } from "./pen-move.ts";
import { createInkScale } from "./ink-scale.ts";
import { createInkFingers } from "./ink-fingers.ts";
import { createPenDown } from "./pen-down.ts";
import { createInkPaint } from "./ink-paint.ts";
import { createLiveStroke } from "./live-stroke.ts";



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

/** What the ink layer is given by the view. */
export interface CanvasInkProps {
	camera: Camera;
	view: { width: number; height: number };
	toView: (event: PointerEvent) => { x: number; y: number };
	/** The ink on the canvas now, each stroke in canvas pixels. */
	strokes: () => InkStroke[];
	layer: CanvasEngine;
	/** A new stroke's pen item; the drawing's edit defines its colour's variable when it lacks it (`withDecksColors`). */
	onEdit: (ops: unknown[]) => void;
	newId: () => string;
	/** Move items by this much, as every other move on the canvas does. */
	onShift: (ids: readonly string[], dx: number, dy: number) => void;
	/** Take back the last edit, or put it back: a two- or three-finger tap. */
	onStep?: (direction: "undo" | "redo") => void;
}

/**
 * Drawing on the canvas: a sheet of glass over the whole canvas while the draw tool is on.
 *
 * What is drawn goes into the canvas's `.pen` file as ink (`ink.ts`), one pen `path` per stroke,
 * through the same edits an agent sends. The strokes in the file are drawn on the canvas's one sheet
 * (`scene.ts`) as items. The stroke under the pen, before it is in the file, is drawn here, on this
 * glass, as SVG paths shaped as the sheet shapes ink, at most once a frame: handing it to the sheet
 * redrew the whole sheet, three screens of pixels, for every sample, and on an iPad that is two
 * samples a frame (Safari gives no coalesced events). The glass also takes the pointer, and shows
 * the lasso's loop and the box round what the lasso took.
 *
 * **Which pointer draws.** A pen, with its pressure, and a mouse. A finger draws only on a device
 * that has never shown a pencil (a phone, an iPad without one; remembered, `state/ink.ts`), and a
 * second finger ends its stroke; once a pencil has been seen, a finger is the canvas's and goes on up
 * to the canvas, one finger to pan, two to pan and pinch. A palm is ignored as far as it can be while
 * the pencil is in use: any touch while the pencil is on the glass or has just left it
 * (`PALM_AFTER_MS`) does nothing at all, neither drawing nor moving the canvas. iPadOS turns away a
 * resting palm by itself.
 */
export function CanvasInk(props: CanvasInkProps) {
	let loop: SVGPathElement | undefined;
	/** The stroke under the pen, as it is drawn. */
	let live: LiveInk | undefined;
	/** The stroke has new samples since it was last shaped: it is shaped again at the next frame. */
	let reshape: Extract<Gesture, { kind: "draw" }> | undefined;
	/** Where the live paths go, and each one drawn, with the path text it last had. */
	let inkLayer: SVGGElement | undefined;
	const paint = createInkPaint({
		get reshape() { return reshape; },
		set reshape(next) { reshape = next; },
		get live() { return live; },
		set live(next) { live = next; },
		get liveOf() { return liveOf; },
		props,
		get inkLayer() { return inkLayer; },
	});
	const { sendInk, hold, waiting, settle } = paint;

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
		return picked?.path === CANVAS_INK ? picked.ids : [];
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

	const { liveOf, cancel, erase, rest, paintLive, clearLive } = createLiveStroke({
		sendInk, props, zoom, setResizing,
		get live() { return live; },
		set live(next) { live = next; },
		get reshape() { return reshape; },
		set reshape(next) { reshape = next; },
		get loop() { return loop; },
		get gesture() { return gesture; },
		set gesture(next) { gesture = next; },
	});

	const { fingerDown } = createInkFingers({
		get palms() { return palms; },
		props,
	});

	const { scaled, startScale } = createInkScale({
		selection, held, props,
		get gesture() { return gesture; },
		set gesture(next) { gesture = next; },
	});

	const pen = createPenDown({
		fingerDown, cancel, props, erase, selection, held, pressureOf, rest, paintLive,
		get gesture() { return gesture; },
		set gesture(next) { gesture = next; },
	});
	const { palms, palm, onDown } = pen;

	const { onMove } = createPenMove({
		palms, props, paintLive, pressureOf, zoom, rest, scaled, setResizing, erase,
		get gesture() { return gesture; },
		get loop() { return loop; },
	});

	const { onUp } = createPenUp({
		palms, setResizing, props, hold, clearLive, scaled, zoom,
		get penDown() { return pen.penDown; },
		set penDown(next) { pen.penDown = next; },
		get penUpAt() { return pen.penUpAt; },
		set penUpAt(next) { pen.penUpAt = next; },
		get gesture() { return gesture; },
		set gesture(next) { gesture = next; },
	});

	const inkSheet = mountInkSheet({
		palm, palms, fingerDown, onDown, onMove, onUp, cancel, waiting, settle, props,
		get frame() { return paint.frame; },
	});

	return (
		<svg
			ref={inkSheet.sheet}
			class="canvas-ink"
			data-tool={inkTool()}
			data-pencil={penSeen() ? "true" : undefined}
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
