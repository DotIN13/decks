import { inkShaper, strokeShape, type InkStroke } from "./index.ts";
import { inkHex } from "./model.ts";
import type { StageEngine } from "../render/engine.ts";
import type { LiveInk } from "../render/types.ts";
import { scheme } from "../theme.ts";

// The stroke under the pen, drawn on the glass at most once a frame, and
// each finished stroke kept there until the sheet has drawn it from the file.

/** What a stroke being drawn has that its live copy is shaped from. */
export type Drawing = { points: number[]; stroke: Omit<InkStroke, "points" | "id"> };

export type LiveCtx = {
	layer: StageEngine;
	/** The stroke under the pen, as it is drawn. */
	live?: LiveInk;
	/** The stroke has new samples since it was last shaped: it is shaped again at the next frame. */
	reshape?: Drawing;
	/** Where the live paths go, and each one drawn, with the path text it last had. */
	inkLayer?: SVGGElement;
	shown: Map<string, { el: SVGPathElement; d: string }>;
	frame: number;
	/*
	 * A finished stroke stays on the sheet as live ink until the stage has drawn it: it is sent to the
	 * server and drawn from the answer, and taking it off at the lift left a frame or more with no
	 * stroke at all. Each one waiting is the live stroke under its id, taken off the moment that id
	 * is among the strokes the stage drew, or after a few seconds if the edit never came back.
	 */
	waiting: Map<string, { ink: LiveInk; timer: ReturnType<typeof setTimeout> }>;
	handedOver: Set<string>;
	/*
	 * The stroke under the pen is shaped as it grows (`inkShaper`): only its new points and its end
	 * each frame, to the same path as shaping it whole. `__inkWhole` set shapes it whole each frame,
	 * as it was, for measuring the two in one page.
	 */
	shaper: ReturnType<typeof inkShaper>;
	/** The lasso's loop, cleared with the live stroke. */
	loop?: SVGPathElement;
};

export function liveState(layer: StageEngine): LiveCtx {
	return { layer, shown: new Map(), frame: 0, waiting: new Map(), handedOver: new Set(), shaper: inkShaper() };
}

/** The stroke under the pen has changed: it is shaped and drawn at the next frame. */
export function paintLive(c: LiveCtx, drawn: Drawing): void {
	c.reshape = drawn;
	sendInk(c);
}

/** Draw the live strokes at the next frame, however many samples come before it. */
export function sendInk(c: LiveCtx): void {
	if (!c.frame) c.frame = requestAnimationFrame(() => paintInk(c));
}

function paintInk(c: LiveCtx): void {
	c.frame = 0;
	if (c.reshape) c.live = liveOf(c, c.reshape);
	c.reshape = undefined;
	const want = [...[...c.waiting.values()].map((held) => held.ink), ...(c.live ? [c.live] : [])];
	/*
	 * Drawn by the engine, the painter that draws the saved stroke: as SVG it came out lighter than
	 * the engine's 4× multisampled tiles draw the same outline, and the stroke thickened as the copy
	 * came off. Once a frame, so it holds the frame rate (60 fps on an iPad mini, as the SVG did); the
	 * SVG is kept behind `__inkOnSvg`.
	 */
	if (!(globalThis as { __inkOnSvg?: boolean }).__inkOnSvg) {
		c.layer.ink(want);
		for (const [, path] of c.shown) path.el.remove();
		c.shown.clear();
		return;
	}
	paintSvg(c, want);
}

/** The live strokes as SVG paths, each kept and changed only when its path text does. */
function paintSvg(c: LiveCtx, want: LiveInk[]): void {
	const keep = new Set(want.map((ink) => ink.id));
	for (const [id, path] of c.shown) {
		if (keep.has(id)) continue;
		path.el.remove();
		c.shown.delete(id);
	}
	for (const ink of want) {
		let path = c.shown.get(ink.id);
		if (!path) {
			const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
			el.setAttribute("class", "ink-live");
			el.setAttribute("stroke-linecap", "round");
			el.setAttribute("stroke-linejoin", "round");
			c.inkLayer?.append(el);
			path = { el, d: "" };
			c.shown.set(ink.id, path);
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
}

function liveOf(c: LiveCtx, drawn: Drawing): LiveInk {
	const stroke = { id: "live", ...drawn.stroke, points: drawn.points };
	const shape = (globalThis as { __inkWhole?: boolean }).__inkWhole ? strokeShape(stroke) : c.shaper.shape(stroke);
	return {
		id: "live",
		d: shape.d,
		filled: shape.filled,
		// As its variable will resolve: dark ink on light, light on dark, the others a shade lighter on dark.
		color: inkHex(drawn.stroke.color, scheme()),
		size: drawn.stroke.size,
		opacity: drawn.stroke.tool === "marker" ? 0.4 : 1,
	};
}

/** No stroke under the pen any more, and no loop. */
export function clearLive(c: LiveCtx): void {
	const had = !!c.live || !!c.reshape;
	c.live = undefined;
	c.reshape = undefined;
	c.shaper = inkShaper();
	if (had) sendInk(c);
	c.loop?.setAttribute("d", "");
}

/** The stroke just lifted keeps its live copy under the id it was saved as, for five seconds at most. */
export function hold(c: LiveCtx, id: string): void {
	if (c.reshape) c.live = liveOf(c, c.reshape);
	c.reshape = undefined;
	if (!c.live) return;
	// The path drawn for the live stroke is this one now: no frame without it.
	const path = c.shown.get(c.live.id);
	if (path) {
		c.shown.delete(c.live.id);
		c.shown.set(id, path);
	}
	c.waiting.set(id, { ink: { ...c.live, id }, timer: setTimeout(() => settle(c, id), 5000) });
}

export function settle(c: LiveCtx, id: string): void {
	const held = c.waiting.get(id);
	if (!held) return;
	clearTimeout(held.timer);
	c.waiting.delete(id);
	sendInk(c);
}

/*
 * In the file is not yet on the sheet: the sheet's worker paints the tiles it falls in after the
 * drawing arrives, so the glass keeps its copy until the engine says a frame painted after the
 * drawing went to it is on screen (`mark`, `shows`), the handoff the text editor's ghost makes too.
 * A fixed 250ms was short on an iPad: for a moment neither copy showed, and the stroke flickered.
 * The mark is taken a frame after the strokes change, once the drawing has gone to the engine.
 */
export function handOver(c: LiveCtx, id: string): void {
	if (c.handedOver.has(id)) return;
	c.handedOver.add(id);
	requestAnimationFrame(() => {
		const mark = c.layer.mark();
		const wait = () => {
			if (!c.waiting.has(id)) return void c.handedOver.delete(id);
			if (!c.layer.shows(mark)) return void requestAnimationFrame(wait);
			// The frame that shows it is up: the next one draws without the glass's copy.
			requestAnimationFrame(() => {
				c.handedOver.delete(id);
				settle(c, id);
			});
		};
		wait();
	});
}

/** The glass is going: every copy off it, and the engine's with them. */
export function dropLive(c: LiveCtx): void {
	for (const id of [...c.waiting.keys()]) settle(c, id);
	cancelAnimationFrame(c.frame);
	c.layer.ink([]);
}
