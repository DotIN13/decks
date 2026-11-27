import { createEffect } from "solid-js";
import type { LiveInk } from "../render/types.ts";
import { type Gesture, type CanvasInkProps } from "./CanvasInk.tsx";

/** What `createInkPaint` reads of `CanvasInk` (`CanvasInk.tsx`), each read when it is used. */
export interface InkPaintNeeds {
	reshape: Extract<Gesture, { kind: "draw" }> | undefined;
	live: LiveInk | undefined;
	readonly liveOf: (drawn: Extract<Gesture, { kind: "draw"; }>) => LiveInk;
	readonly props: CanvasInkProps;
	readonly inkLayer: SVGGElement | undefined;
}

export function createInkPaint(of: InkPaintNeeds) {
	const shown = new Map<string, { el: SVGPathElement; d: string }>();

	let frame = 0;

	/*
	 * A finished stroke stays on the sheet as live ink until the canvas has drawn it: it is sent to the
	 * server and drawn from the answer, and taking it off at the lift left a frame or more with no
	 * stroke at all. Each one waiting is the live stroke under its id, taken off the moment that id
	 * is among the strokes the canvas drew — the same layout the drawing shows it in — or after a few
	 * seconds if the edit never came back.
	 */
	const waiting = new Map<string, { ink: LiveInk; timer: ReturnType<typeof setTimeout> }>();

	/** Draw the live strokes at the next frame, however many samples come before it. */
	const sendInk = () => {
		if (!frame) frame = requestAnimationFrame(paintInk);
	};

	const paintInk = () => {
		frame = 0;
		if (of.reshape) of.live = of.liveOf(of.reshape);
		of.reshape = undefined;
		const want = [...[...waiting.values()].map((held) => held.ink), ...(of.live ? [of.live] : [])];
		/*
		 * Drawn by the engine, the painter that draws the saved stroke: as SVG it came out lighter than
		 * the engine's 4× multisampled tiles draw the same outline, and the stroke thickened as the copy
		 * came off. Once a frame, so it holds the frame rate (60 fps on an iPad mini, as the SVG did); the
		 * SVG is kept behind `__inkOnSvg`.
		 */
		if (!(globalThis as { __inkOnSvg?: boolean }).__inkOnSvg) {
			of.props.layer.previews.ink(want);
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
				of.inkLayer?.append(el);
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
		if (of.reshape) of.live = of.liveOf(of.reshape);
		of.reshape = undefined;
		if (!of.live) return;
		// The path drawn for the live stroke is this one now: no frame without it.
		const path = shown.get(of.live.id);
		if (path) {
			shown.delete(of.live.id);
			shown.set(id, path);
		}
		waiting.set(id, { ink: { ...of.live, id }, timer: setTimeout(() => settle(id), 5000) });
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
			const mark = of.props.layer.tiles.mark();
			const wait = () => {
				if (!waiting.has(id)) return void handedOver.delete(id);
				if (!of.props.layer.tiles.shows(mark)) return void requestAnimationFrame(wait);
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
		const drawn = new Set(of.props.strokes().map((stroke) => stroke.id));
		for (const id of waiting.keys()) if (drawn.has(id)) handOver(id);
	});

	return {
		sendInk,
		hold,
		waiting,
		settle,
		get frame() {
			return frame;
		},
		set frame(next) {
			frame = next;
		},
	};
}
