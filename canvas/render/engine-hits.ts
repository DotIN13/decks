/**
 * What is under a point on the canvas: the hit shapes the page keeps for the pointer, items picked
 * and lines touched, cards and links, and what the view hides or mutes.
 */
import type { StageEngine as Engine } from "./engine.ts";
import { docIndex } from "../drawing/doc-index.ts";
import { isShape, pathBounds, type PenNode, type Placed, shapeKind, shapeOutline, shapeRadius } from "@decks/pen";
import type { CardGeometry, LiveInk, PenPreview } from "./types.ts";
import { probes } from "../debug.ts";
import { BoxIndex, type Rect } from "./spatial.ts";

/** How far a press reaches a line, in screen pixels: wider for a finger. */
export const BAND_PX = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 12 : 8;

// Questions: what is under a point, on a line, a card or a link.
/**
 * Every item under a stage point, topmost first, with a press's reach round each so a thin line
 * can be hit: raw geometry, unfiltered. Which of them a press means is the editor's
 * (`canvas/editor/core/pick.ts`). Boards' own items are among them; nothing before a page.
 */
export function pickAll(e: Engine, point: { x: number; y: number }): string[] {
	if (!e.page) return [];
	return JSON.parse(e.page.pickAll(point.x, point.y, (2 * BAND_PX) / e.camera.zoom)) as string[];
}

/** Whether a stage point is on what a path draws: its line with the press's reach, or inside its fill. */
export function onPath(e: Engine, placed: Placed, point: { x: number; y: number }): boolean | undefined {
	const { node } = placed;
	if (typeof node.geometry !== "string" || !node.geometry) return undefined;
	const vb = node.viewBox ?? (() => {
		const b = pathBounds(node.geometry as string);
		return b ? ([b.x, b.y, b.w, b.h] as const) : undefined;
	})();
	if (!vb || vb[2] <= 0 || vb[3] <= 0) return undefined;
	const ctx = (e.penHit ??= document.createElement("canvas").getContext("2d") ?? undefined);
	if (!ctx) return undefined;
	const path = new Path2D(node.geometry);
	const box = placed.box;
	const sx = box.w / vb[2];
	const sy = box.h / vb[3];
	if (!(sx > 0) || !(sy > 0)) return undefined;
	const px = (point.x - box.x) / sx + vb[0];
	const py = (point.y - box.y) / sy + vb[1];
	const drawn = typeof node.strokeWidth === "number" ? node.strokeWidth : 0;
	ctx.lineWidth = Math.max(drawn, (2 * BAND_PX) / e.camera.zoom) / Math.max(sx, sy);
	const filled = node.fill !== undefined && node.fill !== null;
	return ctx.isPointInStroke(path, px, py) || (filled && ctx.isPointInPath(path, px, py));
}

/** Whether a stage point is on what a path item draws (`onPath`); `undefined` for an item not placed or with no geometry. */
export function onLine(e: Engine, id: string, point: { x: number; y: number }): boolean | undefined {
	const placed = e.placed.get(id);
	return placed ? e.onPath(placed, point) : undefined;
}

export function cardAt(e: Engine, point: { x: number; y: number }) {
	let found: CardGeometry | undefined;
	for (const card of e.cards()) {
		const { box } = card;
		if (e.viewState.hidden.includes(card.id) || (found && card.order < found.order)) continue;
		if (point.x < box.x || point.x > box.x + box.w || point.y < box.y || point.y > box.y + box.h) continue;
		found = card;
	}
	return found ? { card: found, x: point.x - found.box.x - found.pad, y: point.y - found.box.y - found.pad } : undefined;
}

/** The link under a stage point, in a markdown card. */
export function linkAt(e: Engine, point: { x: number; y: number }): string | undefined {
	const found = e.cardAt(point);
	if (!found) return undefined;
	const { card, x, y } = found;
	return card.links.find((l) => {
		let lx = l.x;
		if (l.scroller !== null && l.scroller !== undefined) {
			const view = card.scrollers[l.scroller];
			if (!view || x < view.x || x > view.x + view.w) return false;
			lx -= e.scrolls.get(`${card.id}:${l.scroller}`) ?? 0;
		}
		return x >= lx && x <= lx + l.w && y >= l.y && y <= l.y + l.h;
	})?.href;
}

/** Scroll the wide table under a stage point sideways; true when there was one to scroll. */
export function scrollBy(e: Engine, point: { x: number; y: number }, dx: number): boolean {
	const found = e.cardAt(point);
	if (!found) return false;
	const { card, x, y } = found;
	const index = card.scrollers.findIndex((v) => x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h);
	const view = card.scrollers[index];
	if (!view) return false;
	const key = `${card.id}:${index}`;
	const now = e.scrolls.get(key) ?? 0;
	const next = Math.max(0, Math.min(view.content - view.w, now + dx));
	if (next !== now) {
		e.scrolls.set(key, next);
		e.sendView();
	}
	return true;
}

// The hit shapes the page keeps for the pointer, written as the window moves.
export function attach(e: Engine, _sheet: HTMLCanvasElement): void {}

/** The SVG of invisible shapes that take a press on a drawn item from the board page under it. */
export function attachHits(e: Engine, svg: SVGSVGElement): void {
	e.hits = svg;
	e.writeHits();
}

/**
 * Which cards have a node in the DOM, from the stage (`items-layer.tsx`, `renderedPaths`): an item
 * drawn over one of these needs a click shape to take the press from the card's page; over a
 * sleeping card, which is the engine's picture, a press reaches the stage itself and `pickAll` finds
 * the item. The shapes are written again when the set changes.
 */
export function setNodes(e: Engine, paths: ReadonlySet<string>): void {
	const was = e.nodePaths;
	if (was && was.size === paths.size && [...paths].every((path) => was.has(path))) return;
	e.nodePaths = paths;
	e.indexNodes();
	e.writeHits();
}

export function indexNodes(e: Engine): void {
	const paths = e.nodePaths;
	e.nodeIndex = paths ? new BoxIndex(e.indexed.filter((b) => paths.has(b.path)).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }))) : e.cardIndex;
}

/**
 * One invisible shape per drawn item over a board, near the window: a press on it is the drawing's,
 * and one beside it reaches the board. On bare canvas the stage has the press and the editor's pick (`editor/core/pick.ts`) answers.
 */
export function writeHits(e: Engine): void {
	const svg = e.hits;
	if (!svg) return;
	const NS = "http://www.w3.org/2000/svg";
	const band = (2 * BAND_PX) / e.camera.zoom;
	e.bandZoom = e.camera.zoom;
	const shapes: SVGElement[] = [];
	// Every item over a card with a node, wherever it is: few cards have one, so no window is kept and no pan writes the shapes again.
	e.hitWindow = undefined;
	const over = e.nodeIndex;
	if (over.size === 0) {
		svg.replaceChildren();
		return;
	}
	for (const placed of e.list()) {
		const { node, box } = placed;
		if (node.type === "group" || isShape(node) || (node.type === "browser" && ["decks.board", "decks.card", "decks.document", "decks.app"].includes(String(node.metadata?.type)))) continue;
		let top = placed;
		while (top.parent) top = e.placed.get(top.parent) ?? top;
		if (top.parent) continue;
		const bounds = e.bounds.get(node.id) ?? box;
		if (over.search(bounds).length === 0) continue;
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
	svg.replaceChildren(...shapes);
}

export function list(e: Engine): Placed[] {
	return (e.placedList ??= [...e.placed.values()]);
}

export function index(e: Engine): BoxIndex {
	return (e.placedIndex ??= new BoxIndex(e.list().map((one) => e.bounds.get(one.node.id) ?? one.box)));
}

/** The window on the stage, grown by `more` windows on each side. */
export function windowRect(e: Engine, more: number): Rect {
	const { x, y, zoom } = e.camera;
	const w = e.view.width / zoom;
	const h = e.view.height / zoom;
	return { x: x - w / 2 - more * w, y: y - h / 2 - more * h, w: w * (1 + 2 * more), h: h * (1 + 2 * more) };
}

/** The id of the item that is this page (a card, a board, a document, an app), by its path as the item names it or by its end. */
export function pageIdOf(e: Engine, path: string): string | undefined {
	if (!e.pageIds) {
		e.pageIds = new Map();
		for (const one of e.placed.values()) {
			const own = (one.node.metadata as { path?: unknown } | undefined)?.path;
			if (typeof own === "string") e.pageIds.set(own, one.node.id);
		}
	}
	const exact = e.pageIds.get(path);
	if (exact) return exact;
	for (const [own, id] of e.pageIds) if (path.endsWith(own) || own.endsWith(path)) return id;
	return undefined;
}

export function sendView(e: Engine): void {
	e.viewState.scrolls = Object.fromEntries(e.scrolls);
	const key = JSON.stringify(e.viewState);
	if (key === e.viewKey) return;
	e.viewKey = key;
	e.page?.setView(key);
	e.post({ type: "view", view: key });
	e.draw();
}

// What the view hides, mutes or shows as holes, and who wrote the drawing.
/**
 * A library shape being resized or rounded shows its outline as the saved drawing will have it
 * (`fitShapes`): sized to the shape, and built at that size by its kind (`build`) so a curve stays
 * a circle, rather than left at its old size. Its radius is the shape's own, not a frame corner.
 */
export function withOutlines(e: Engine, moving: ReadonlyMap<string, PenPreview>): Array<[string, PenPreview]> {
	const list = [...moving];
	if (!e.doc) return list;
	for (const [at, [id, change]] of list.entries()) {
		if (change.w === undefined && change.h === undefined && change.radius === undefined) continue;
		const node = docIndex(e.doc).get(id)?.node;
		const outline = node && isShape(node) ? shapeOutline(node) : undefined;
		if (!node || !outline) continue;
		const w = change.w ?? node.width;
		const h = change.h ?? node.height;
		if (typeof w !== "number" || typeof h !== "number") continue;
		const set: Record<string, unknown> = { x: 0, y: 0, width: w, height: h };
		const build = shapeKind(node.metadata?.kind)?.build;
		if (build) {
			const metadata = change.radius === undefined ? node.metadata : ({ ...node.metadata, radius: change.radius ?? undefined } as PenNode["metadata"]);
			set.geometry = build(w, h, shapeRadius({ ...node, width: w, height: h, metadata }) ?? 0);
			set.viewBox = [0, 0, w, h];
		}
		if (change.radius !== undefined) {
			const { radius: _, ...rest } = change;
			list[at] = [id, rest];
		}
		list.push([outline.id, { dx: 0, dy: 0, set }]);
	}
	return list;
}

/** Strokes to draw over everything until they are in the drawing, at the next frame however often they change. */
export function ink(e: Engine, strokes: readonly LiveInk[], _warm?: boolean): void {
	probes.sheet.ink = strokes.length;
	e.page?.setInk(JSON.stringify(strokes));
	e.drawSoon();
}

export function hide(e: Engine, ids: ReadonlySet<string> | undefined): void {
	e.viewState.hidden = [...(ids ?? [])];
	e.sendView();
}

export function muteText(e: Engine, ids: ReadonlySet<string> | undefined): void {
	e.viewState.mute = [...(ids ?? [])];
	e.sendView();
}

export function holes(e: Engine, ids: ReadonlySet<string>): void {
	e.viewState.holes = [...ids];
	e.sendView();
}

/**
 * Who last wrote the drawing: its placeholder frames (`placeholder: true`) are drawn unfinished,
 * a dashed outline in `color` (a CSS colour the engine reads: hex, rgb() or hsl(), not a `var()`)
 * with `name` on a tag in their top-left corner. None: the accent, no name.
 */
export function setWriter(e: Engine, writer: { name?: string; color: string } | undefined): void {
	if (writer) e.viewState.writer = writer.name ? { name: writer.name, color: writer.color } : { color: writer.color };
	else delete e.viewState.writer;
	e.sendView();
}
