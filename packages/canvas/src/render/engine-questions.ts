import { chipLink, isShape, pathBounds, type Placed } from "@decks/pen";
import { snapMove, type Box, type Guide } from "../edit/snap.ts";
import { BoxIndex } from "./spatial.ts";
import type { CardGeometry, SceneCard } from "./types.ts";
import type { CanvasEngine } from "./engine.ts";

/** How far a press reaches a line, in screen pixels: wider for a finger. */
const BAND_PX = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 12 : 8;

/**
 * What the view asks of the drawing: what is under a point, in a marquee or on a path, which card or
 * link is there, and the shapes a press can land on (the hit layer). Answered from the page engine's
 * layout and two box indexes. A part of the engine (`engine.ts`), which it reaches through `of`.
 */
export class EngineQuestions {
	constructor(private readonly of: CanvasEngine) {}

	hits: SVGSVGElement | undefined;

	bandZoom = 0;

	cardIndex = new BoxIndex([]);

	/** The cards with a node in the DOM (awake, kept, selected, hovered: `items-layer.tsx`): only an item drawn over one of these needs a click shape. */
	private nodePaths: ReadonlySet<string> | undefined;

	private nodeIndex = new BoxIndex([]);

	/** The boards `cardIndex` answers for, in its order: `boards` when it is up to date with them. */
	indexed: readonly SceneCard[] = [];

	/** Each page's item on the drawing by the page's path, made when first asked for after a change: what a glide's offset is kept under. */
	pageIds: Map<string, string> | undefined;

	/** `placed` as a list, and an index of what each covers, made when first asked for after a change. */
	placedList: Placed[] | undefined;

	placedIndex: BoxIndex | undefined;

	scrolls = new Map<string, number>();

	private penHit?: CanvasRenderingContext2D;

	/** The SVG of invisible shapes that take a press on a drawn item from the board page under it. */
	attachHits(svg: SVGSVGElement): void {
		this.hits = svg;
		this.writeHits();
	}

	/** The id of the item that is this page (a card, a board, a document, an app), by its path as the item names it or by its end. */
	pageIdOf(path: string): string | undefined {
		if (!this.pageIds) {
			this.pageIds = new Map();
			for (const one of this.of.placed.values()) {
				const own = (one.node.metadata as { path?: unknown } | undefined)?.path;
				if (typeof own === "string") this.pageIds.set(own, one.node.id);
			}
		}
		const exact = this.pageIds.get(path);
		if (exact) return exact;
		for (const [own, id] of this.pageIds) if (path.endsWith(own) || own.endsWith(path)) return id;
		return undefined;
	}

	private list(): Placed[] {
		return (this.placedList ??= [...this.of.placed.values()]);
	}

	/**
	 * One invisible shape per drawn item over a board, near the window: a press on it is the drawing's,
	 * and one beside it reaches the board. On bare canvas the stage has the press and the editor's pick (`editor/core/pick.ts`) answers.
	 */
	/**
	 * Which cards have a node in the DOM, from the stage (`items-layer.tsx`, `renderedPaths`): an item
	 * drawn over one of these needs a click shape to take the press from the card's page; over a
	 * sleeping card, which is the engine's picture, a press reaches the stage itself and `pickAll` finds
	 * the item. The shapes are written again when the set changes.
	 */
	setNodes(paths: ReadonlySet<string>): void {
		const was = this.nodePaths;
		if (was && was.size === paths.size && [...paths].every((path) => was.has(path))) return;
		this.nodePaths = paths;
		this.indexNodes();
		this.writeHits();
	}

	indexNodes(): void {
		const paths = this.nodePaths;
		this.nodeIndex = paths ? new BoxIndex(this.indexed.filter((b) => paths.has(b.path)).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }))) : this.cardIndex;
	}

	writeHits(): void {
		const svg = this.hits;
		if (!svg) return;
		const NS = "http://www.w3.org/2000/svg";
		const band = (2 * BAND_PX) / this.of.camera.zoom;
		this.bandZoom = this.of.camera.zoom;
		const shapes: SVGElement[] = [];
		// Every item over a card with a node, wherever it is: few cards have one, so no window is kept and no pan writes the shapes again.
		const over = this.nodeIndex;
		if (over.size === 0) {
			svg.replaceChildren();
			return;
		}
		for (const placed of this.list()) {
			const { node, box } = placed;
			if (node.type === "group" || isShape(node) || (node.type === "browser" && ["decks.card", "decks.document", "decks.app"].includes(String(node.metadata?.type)))) continue;
			let top = placed;
			while (top.parent) top = this.of.placed.get(top.parent) ?? top;
			if (top.parent) continue;
			const bounds = this.of.bounds.get(node.id) ?? box;
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

	/** Whether a stage point is on what a path draws: its line with the press's reach, or inside its fill. */
	private onPath(placed: Placed, point: { x: number; y: number }): boolean | undefined {
		const { node } = placed;
		if (typeof node.geometry !== "string" || !node.geometry) return undefined;
		const vb = node.viewBox ?? (() => {
			const b = pathBounds(node.geometry as string);
			return b ? ([b.x, b.y, b.w, b.h] as const) : undefined;
		})();
		if (!vb || vb[2] <= 0 || vb[3] <= 0) return undefined;
		const ctx = (this.penHit ??= document.createElement("canvas").getContext("2d") ?? undefined);
		if (!ctx) return undefined;
		const path = new Path2D(node.geometry);
		const box = placed.box;
		const sx = box.w / vb[2];
		const sy = box.h / vb[3];
		if (!(sx > 0) || !(sy > 0)) return undefined;
		const px = (point.x - box.x) / sx + vb[0];
		const py = (point.y - box.y) / sy + vb[1];
		const drawn = typeof node.strokeWidth === "number" ? node.strokeWidth : 0;
		ctx.lineWidth = Math.max(drawn, (2 * BAND_PX) / this.of.camera.zoom) / Math.max(sx, sy);
		const filled = node.fill !== undefined && node.fill !== null;
		return ctx.isPointInStroke(path, px, py) || (filled && ctx.isPointInPath(path, px, py));
	}

	/**
	 * Every item under a stage point, topmost first, with a press's reach round each so a thin line
	 * can be hit: raw geometry, unfiltered. Which of them a press means is the editor's
	 * (`canvas/editor/core/pick.ts`). Boards' own items are among them; nothing before a page.
	 */
	pickAll(point: { x: number; y: number }): string[] {
		if (!this.of.page) return [];
		return JSON.parse(this.of.page.pickAll(point.x, point.y, (2 * BAND_PX) / this.of.camera.zoom)) as string[];
	}

	/** Whether a stage point is on what a path item draws (`onPath`); `undefined` for an item not placed or with no geometry. */
	onLine(id: string, point: { x: number; y: number }): boolean | undefined {
		const placed = this.of.placed.get(id);
		return placed ? this.onPath(placed, point) : undefined;
	}

	private cardAt(point: { x: number; y: number }) {
		let found: CardGeometry | undefined;
		for (const card of this.of.layout.cards()) {
			const { box } = card;
			if (this.of.previews.viewState.hidden.includes(card.id) || (found && card.order < found.order)) continue;
			if (point.x < box.x || point.x > box.x + box.w || point.y < box.y || point.y > box.y + box.h) continue;
			found = card;
		}
		return found ? { card: found, x: point.x - found.box.x - found.pad, y: point.y - found.box.y - found.pad } : undefined;
	}

	/**
	 * A link chip under a stage point: the address of the topmost item there when it is one, or is in
	 * one (`@decks/pen`, `chipLink`). A chip under something else is not under the point.
	 */
	private chipAt(point: { x: number; y: number }): string | undefined {
		const top = this.pickAll(point)[0];
		for (let at = top === undefined ? undefined : this.of.placed.get(top); at; at = at.parent ? this.of.placed.get(at.parent) : undefined) {
			const to = chipLink(at.node);
			if (to) return to;
		}
		return undefined;
	}

	/** The link under a stage point: one in a markdown card's words, or a link chip. */
	linkAt(point: { x: number; y: number }): string | undefined {
		const found = this.cardAt(point);
		if (!found) return this.chipAt(point);
		const { card, x, y } = found;
		const inWords = card.links.find((l) => {
			let lx = l.x;
			if (l.scroller !== null && l.scroller !== undefined) {
				const view = card.scrollers[l.scroller];
				if (!view || x < view.x || x > view.x + view.w) return false;
				lx -= this.scrolls.get(`${card.id}:${l.scroller}`) ?? 0;
			}
			return x >= lx && x <= lx + l.w && y >= l.y && y <= l.y + l.h;
		})?.href;
		return inWords ?? this.chipAt(point);
	}

	/** Scroll the wide table under a stage point sideways; true when there was one to scroll. */
	scrollBy(point: { x: number; y: number }, dx: number): boolean {
		const found = this.cardAt(point);
		if (!found) return false;
		const { card, x, y } = found;
		const index = card.scrollers.findIndex((v) => x >= v.x && x <= v.x + v.w && y >= v.y && y <= v.y + v.h);
		const view = card.scrollers[index];
		if (!view) return false;
		const key = `${card.id}:${index}`;
		const now = this.scrolls.get(key) ?? 0;
		const next = Math.max(0, Math.min(view.content - view.w, now + dx));
		if (next !== now) {
			this.scrolls.set(key, next);
			this.of.previews.sendView();
		}
		return true;
	}

	snapMove(moving: Box, targets: readonly Box[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
		return snapMove(moving, targets, threshold);
	}
}
