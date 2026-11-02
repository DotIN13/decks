/**
 * The invisible shapes that take a press on a drawn item from the board page under it, and the test
 * for a press on a path's line or fill. Pure DOM and geometry: the engine hands over what is laid out.
 */
import { isShape, pathBounds, type Frame, type Placed } from "@decks/pen";
import type { BoxIndex } from "./spatial.ts";

const NS = "http://www.w3.org/2000/svg";

/** What the shapes are made from: every item as laid out, what each covers, and where the boards are. */
export interface HitScene {
	placed: ReadonlyMap<string, Placed>;
	bounds: ReadonlyMap<string, Frame>;
	boards: BoxIndex;
	/** How far a press reaches a line, in stage units. */
	band: number;
}

/**
 * One invisible shape per drawn item in `near` that sits over a board: an ellipse, the path itself
 * with the press's reach as its stroke, or the item's box. Items inside another (a card's children)
 * are their top item's; shapes, groups and boards get none.
 */
export function hitShapes(near: readonly Placed[], scene: HitScene): SVGElement[] {
	const { band } = scene;
	const shapes: SVGElement[] = [];
	for (const placed of near) {
		const { node, box } = placed;
		if (node.type === "group" || isShape(node) || (node.type === "browser" && node.metadata?.type === "decks.board")) continue;
		let top = placed;
		while (top.parent) top = scene.placed.get(top.parent) ?? top;
		if (top.parent) continue;
		const bounds = scene.bounds.get(node.id) ?? box;
		if (scene.boards.search(bounds).length === 0) continue;
		let shape: SVGElement;
		if (node.type === "ellipse") {
			shape = document.createElementNS(NS, "ellipse");
			shape.setAttribute("cx", String(box.x + box.w / 2));
			shape.setAttribute("cy", String(box.y + box.h / 2));
			shape.setAttribute("rx", String(box.w / 2));
			shape.setAttribute("ry", String(box.h / 2));
		} else if (node.type === "path" && typeof node.geometry === "string") {
			const b = node.viewBox ?? (() => {
				const p = pathBounds(node.geometry as string);
				return p ? ([p.x, p.y, p.w, p.h] as const) : undefined;
			})();
			if (!b || b[2] <= 0 || b[3] <= 0) continue;
			shape = document.createElementNS(NS, "path");
			shape.setAttribute("d", node.geometry);
			shape.setAttribute("transform", `translate(${box.x} ${box.y}) scale(${box.w / b[2]} ${box.h / b[3]}) translate(${-b[0]} ${-b[1]})`);
			shape.setAttribute("stroke-width", String(Math.max(band, typeof node.strokeWidth === "number" ? node.strokeWidth : 0)));
			shape.setAttribute("vector-effect", "non-scaling-stroke");
			shape.style.pointerEvents = node.fill !== undefined && node.fill !== null ? "all" : "stroke";
		} else {
			shape = document.createElementNS(NS, "rect");
			shape.setAttribute("x", String(bounds.x));
			shape.setAttribute("y", String(bounds.y));
			shape.setAttribute("width", String(Math.max(0, bounds.w)));
			shape.setAttribute("height", String(Math.max(0, bounds.h)));
		}
		shape.setAttribute("class", "pen-hit");
		shape.setAttribute("fill", "none");
		shape.setAttribute("stroke", "none");
		shape.dataset.id = node.id;
		shapes.push(shape);
	}
	return shapes;
}

/** Whether a stage point is on what a path draws: its line with the press's reach (`band`), or inside its fill. */
export function onPath(placed: Placed, point: { x: number; y: number }, band: number, ctx: CanvasRenderingContext2D): boolean | undefined {
	const { node } = placed;
	if (typeof node.geometry !== "string" || !node.geometry) return undefined;
	const vb = node.viewBox ?? (() => {
		const b = pathBounds(node.geometry as string);
		return b ? ([b.x, b.y, b.w, b.h] as const) : undefined;
	})();
	if (!vb || vb[2] <= 0 || vb[3] <= 0) return undefined;
	const path = new Path2D(node.geometry);
	const box = placed.box;
	const sx = box.w / vb[2];
	const sy = box.h / vb[3];
	if (!(sx > 0) || !(sy > 0)) return undefined;
	const px = (point.x - box.x) / sx + vb[0];
	const py = (point.y - box.y) / sy + vb[1];
	const drawn = typeof node.strokeWidth === "number" ? node.strokeWidth : 0;
	ctx.lineWidth = Math.max(drawn, band) / Math.max(sx, sy);
	const filled = node.fill !== undefined && node.fill !== null;
	return ctx.isPointInStroke(path, px, py) || (filled && ctx.isPointInPath(path, px, py));
}
