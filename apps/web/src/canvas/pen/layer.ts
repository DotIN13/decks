import type { CanvasKit, Image, SkPicture as Picture, Surface } from "canvaskit-wasm";
import { baseTheme, expand, indexOf, isArrow, layout, pathBounds, reroute, walk, textStyleOf, type Frame, type PenDocument, type PenNode, type Placed } from "@decks/pen";

/** A drag or a resize in progress: moved by `dx dy`, and sized `w h` when resizing. */
export interface PenPreview {
	dx: number;
	dy: number;
	w?: number;
	h?: number;
}

/** What a press found in the drawing: the item, and where it is on the stage. */
export interface PenHit {
	id: string;
	node: PenNode;
	box: Frame;
}
import type { Camera } from "@decks/protocol";
import { canvasKit } from "./canvaskit.ts";
import { PenFonts, type FontNeed } from "./fonts.ts";
import { PenIcons } from "./icons.ts";
import { paintDocument } from "./paint.ts";
import { backdrops, boundsOf } from "./bounds.ts";

/**
 * The stage's drawing: two `<canvas>` sheets drawn by CanvasKit, and a layer of invisible shapes
 * that catches clicks on what is drawn.
 *
 * **Boards are at the back.** The drawing is on a sheet *over* the boards, so a note put on a board
 * is on it. The one exception is a backdrop: an item listed before a board in the file that holds
 * the whole board — a frame round it, a panel behind it — goes on the sheet *under* the boards
 * (`backdrops`). A board is never lifted over the drawing: what covers it stays on top of it.
 *
 * **Clicks go to what you see** (`hits`). The over sheet lets every click through; above it is an
 * SVG of invisible shapes, one per drawn item with its outline, which the browser tests each click
 * against. A click on a shape is the drawing's; a click beside it reaches the board underneath.
 *
 * The document is laid out and recorded **once per change** into Skia pictures in stage
 * coordinates; every frame after that only replays them under the camera — a translate and a scale
 * — so a pan costs the same whether the drawing has five items or five hundred, and stays sharp at
 * any zoom because the pictures are vectors, not pixels. The under sheet is fixed to the window;
 * the over sheet lives among the boards, so it is placed back over the window each time it is drawn.
 *
 * CanvasKit is loaded the first time a document has anything in it, never for an empty stage.
 */

interface Sheet {
	element?: HTMLCanvasElement;
	surface?: Surface;
	size: string;
	picture?: Picture;
}

export type SheetName = "under" | "over";

export class PenLayer {
	private readonly sheets: Record<SheetName, Sheet> = { under: { size: "" }, over: { size: "" } };
	private hits: SVGSVGElement | undefined;
	/** The top-level items drawn under the boards (`backdrops`). */
	private under = new Set<string>();
	private ck: CanvasKit | undefined;
	private fonts: PenFonts | undefined;
	private doc: PenDocument | undefined;
	private base = "";
	private scheme: "light" | "dark" = "light";
	private camera: Camera = { x: 0, y: 0, zoom: 1 };
	private view = { width: 0, height: 0 };
	private dirty = true;
	private frame = 0;
	private starting: Promise<void> | undefined;
	private readonly images = new Map<string, Image | "loading" | "failed">();
	private readonly icons = new PenIcons(() => {
		this.dirty = true;
		this.schedule();
	});
	/** Where the boards are, for an arrow that ends on one. */
	private boards = new Map<string, Frame>();
	private boardKey = "";
	private disposed = false;
	/** The layout last drawn, by id, for whoever needs to know where an item is. */
	placed: ReadonlyMap<string, Placed> = new Map();
	/** Called after every new picture, so the stage can redraw a selection around what moved. */
	drawn: (() => void) | undefined;
	/** The document the current layout and picture were made from. */
	drawnDoc: PenDocument | undefined;
	/** Items being dragged or resized, drawn changed by this much until the edit comes back from the server. */
	private moving: ReadonlyMap<string, PenPreview> | undefined;

	/** What each item looks like it covers, by id (`boundsOf`): what is outlined, hit and boxed in. */
	bounds: ReadonlyMap<string, Frame> = new Map();

	/**
	 * The item under a stage point: the one drawn last, since that is the one on top.
	 *
	 * Tested against what an item draws (`bounds`), not the box it was given: a petal drawn in a
	 * corner of a 600 by 700 box is hit on the petal. A press finds the outermost group round what
	 * it hit, the way a design tool selects a group whole; `deep` finds the item itself, for a
	 * double-click. Boards are not drawn here and are not found; an item inside an instance is
	 * found as the instance, because a copy is moved and deleted whole.
	 */
	hitTest(point: { x: number; y: number }, options?: { deep?: boolean }): PenHit | undefined {
		let best: Placed | undefined;
		for (const placed of this.placed.values()) {
			const { node } = placed;
			if (node.id.includes("/") || node.type === "group") continue;
			if (node.type === "browser" && node.metadata?.type === "decks.board") continue;
			const box = this.bounds.get(node.id) ?? placed.box;
			if (point.x < box.x || point.x > box.x + box.w || point.y < box.y || point.y > box.y + box.h) continue;
			if (!best || placed.order > best.order) best = placed;
		}
		if (!best) return undefined;
		if (!options?.deep) {
			for (let up = best.parent ? this.placed.get(best.parent) : undefined; up; up = up.parent ? this.placed.get(up.parent) : undefined) {
				if (up.node.type === "group") best = up;
			}
		}
		return { id: best.node.id, node: best.node, box: { ...(this.bounds.get(best.node.id) ?? best.box) } };
	}

	/**
	 * Every item wholly inside a stage rectangle, leaving out any whose parent is picked too:
	 * what a marquee selects. Boards and the inside of an instance are not items to select.
	 */
	within(r: Frame): string[] {
		const index = this.doc ? indexOf(this.doc) : new Map();
		const inside = new Set<string>();
		for (const { node, box: given } of this.placed.values()) {
			if (node.id.includes("/") || (node.type === "browser" && node.metadata?.type === "decks.board")) continue;
			const box = this.bounds.get(node.id) ?? given;
			if (box.x >= r.x && box.y >= r.y && box.x + box.w <= r.x + r.w && box.y + box.h <= r.y + r.h) inside.add(node.id);
		}
		return [...inside].filter((id) => {
			for (let parent = index.get(id)?.parent; parent; parent = index.get(parent.id)?.parent) if (inside.has(parent.id)) return false;
			return true;
		});
	}

	/**
	 * Draw items moved or resized by a gesture that has not been saved yet; nothing to stop.
	 *
	 * A move is cheap on purpose: the first step records the drawing twice, once without the moving
	 * items and once with only them, and every step after that replays the second picture shifted.
	 * Laying out and recording the whole drawing on every mouse move is what made a drag of the
	 * flower's hundred paths trail behind the pointer. A resize changes a shape, so it is redrawn.
	 */
	preview(moving: ReadonlyMap<string, PenPreview> | undefined): void {
		const slide = !!moving?.size && [...moving.values()].every((change) => change.w === undefined && change.h === undefined);
		if (slide) {
			const key = [...moving!.keys()].sort().join("|");
			if (this.slide?.key !== key) this.dropSlide();
			const first = moving!.values().next().value!;
			const kept = this.slide;
			this.slide = { key, ids: new Set(moving!.keys()), dx: first.dx, dy: first.dy, ...(kept?.base ? { base: kept.base } : {}), ...(kept?.carried ? { carried: kept.carried } : {}) };
			this.schedule();
			return;
		}
		this.dropSlide();
		this.moving = moving;
		this.dirty = true;
		this.schedule();
	}

	/** The pictures a move slides between: each sheet without the moving items, and the moving items alone. */
	private slide: { key: string; ids: Set<string>; dx: number; dy: number; base?: Record<SheetName, Picture>; carried?: Picture } | undefined;
	/** What the last picture was painted from, so a slide can record from the same thing. */
	private painted: { nodes: PenNode[]; doc: PenDocument; placed: Map<string, Placed> } | undefined;

	private dropSlide(): void {
		this.slide?.base?.under.delete();
		this.slide?.base?.over.delete();
		this.slide?.carried?.delete();
		this.slide = undefined;
	}

	private recordSlide(): void {
		const { ck, fonts, slide, painted } = this;
		if (!ck || !fonts || !slide || !painted) return;
		const ctx = { ck, fonts, doc: painted.doc, placed: painted.placed, scheme: this.scheme, image: (url: string) => this.image(url), icon: (library: string, name: string, weight: number) => this.icons.get(library, name, weight) };
		const record = (paint: (canvas: ReturnType<InstanceType<CanvasKit["PictureRecorder"]>["beginRecording"]>) => void) => {
			const recorder = new ck.PictureRecorder();
			paint(recorder.beginRecording(ck.LTRBRect(-1e7, -1e7, 1e7, 1e7)));
			const picture = recorder.finishRecordingAsPicture();
			recorder.delete();
			return picture;
		};
		const { under, over } = this.split(painted.nodes);
		slide.base = {
			under: record((canvas) => paintDocument(canvas, under, { ...ctx, skip: slide.ids })),
			over: record((canvas) => paintDocument(canvas, over, { ...ctx, skip: slide.ids })),
		};
		const carried = [...slide.ids].flatMap((id) => {
			const node = painted.placed.get(id)?.node;
			return node ? [node] : [];
		});
		// Carried on the over sheet, so what you are dragging is never hidden under a board.
		slide.carried = record((canvas) => paintDocument(canvas, carried, ctx));
	}

	/** Items drawn as if gone, while an eraser is over them and before the delete comes back. */
	private hidden: ReadonlySet<string> = new Set();

	hide(ids: ReadonlySet<string> | undefined): void {
		const next = ids ?? new Set<string>();
		if (next.size === 0 && this.hidden.size === 0) return;
		this.hidden = next;
		this.dirty = true;
		this.schedule();
	}

	attach(element: HTMLCanvasElement, sheet: SheetName = "under"): void {
		this.sheets[sheet].surface?.delete();
		this.sheets[sheet] = { element, size: "", ...(this.sheets[sheet].picture ? { picture: this.sheets[sheet].picture } : {}) };
		this.schedule();
	}

	/** The SVG the click shapes are written into, among the boards and over the over sheet. */
	attachHits(svg: SVGSVGElement): void {
		this.hits = svg;
		this.writeHits();
	}

	/** Whether a top-level item is drawn under the boards. */
	isUnder(id: string): boolean {
		return this.under.has(id);
	}

	private split(nodes: readonly PenNode[]) {
		return { under: nodes.filter((node) => this.under.has(node.id)), over: nodes.filter((node) => !this.under.has(node.id)) };
	}

	setDoc(doc: PenDocument | undefined, base: string): void {
		if (doc === this.doc && base === this.base) return;
		// The server's answer has arrived, so whatever a drag was previewing is now the drawing itself.
		this.moving = undefined;
		this.hidden = new Set();
		this.dropSlide();
		this.doc = doc;
		this.base = base;
		this.dirty = true;
		if (doc && doc.children.length > 0) void this.start();
		this.schedule();
	}

	/** The boards on this stage, by path: an arrow may end on one, and follows it when it moves. */
	setBoards(boards: ReadonlyArray<{ path: string; x: number; y: number; w: number; h: number }>): void {
		const key = boards.map((b) => `${b.path}@${b.x},${b.y},${b.w},${b.h}`).join("|");
		if (key === this.boardKey) return;
		this.boardKey = key;
		this.boards = new Map(boards.map((b) => [b.path, { x: b.x, y: b.y, w: b.w, h: b.h }]));
		if (this.doc && [...walk(this.doc.children)].some((node) => isArrow(node))) {
			this.dirty = true;
			this.schedule();
		}
	}

	setScheme(scheme: "light" | "dark"): void {
		if (scheme === this.scheme) return;
		this.scheme = scheme;
		this.dirty = true;
		this.schedule();
	}

	setCamera(camera: Camera): void {
		this.camera = camera;
		this.schedule();
	}

	setView(view: { width: number; height: number }): void {
		if (view.width === this.view.width && view.height === this.view.height) return;
		this.view = view;
		this.schedule();
	}

	dispose(): void {
		this.disposed = true;
		this.dropSlide();
		cancelAnimationFrame(this.frame);
		for (const sheet of Object.values(this.sheets)) {
			sheet.picture?.delete();
			sheet.surface?.delete();
		}
		for (const image of this.images.values()) if (typeof image === "object") image.delete();
		this.images.clear();
	}

	private start(): Promise<void> {
		this.starting ??= canvasKit().then((ck) => {
			if (this.disposed) return;
			this.ck = ck;
			this.fonts = new PenFonts(ck);
			this.dirty = true;
			this.schedule();
		});
		return this.starting;
	}

	private schedule(): void {
		if (this.frame || this.disposed) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			this.render();
		});
	}

	/** What the document's words need from the font CDN; asked before the first layout, and again when it changes. */
	private fontsFor(nodes: readonly PenNode[], doc: PenDocument, theme: ReturnType<typeof baseTheme>): FontNeed[] {
		const needs: FontNeed[] = [];
		for (const node of walk(nodes)) {
			if (typeof node.content !== "string" || !node.content) continue;
			const style = textStyleOf(doc, node, theme);
			needs.push({ family: style.fontFamily, weight: style.fontWeight, italic: style.fontStyle === "italic", text: node.content });
		}
		return needs;
	}

	private rebuild(): void {
		const { ck, fonts } = this;
		let doc = this.doc;
		if (!ck || !fonts) return;
		for (const sheet of Object.values(this.sheets)) {
			sheet.picture?.delete();
			delete sheet.picture;
		}
		this.placed = new Map();
		this.bounds = new Map();
		this.dropSlide();
		if (!doc || doc.children.length === 0) {
			this.under = new Set();
			this.writeHits();
			return;
		}
		const theme = baseTheme(doc, this.scheme);
		/*
		 * Arrows are routed here as well as on the server: a file written by hand, or a board dragged
		 * a moment ago, has arrows whose geometry the server has not redrawn yet. The copy is only for
		 * drawing; the file is the server's to rewrite.
		 */
		if (this.moving?.size) {
			const copy = structuredClone(doc);
			const index = indexOf(copy);
			for (const [id, change] of this.moving) {
				const found = index.get(id);
				if (!found) continue;
				found.node.x = (typeof found.node.x === "number" ? found.node.x : 0) + change.dx;
				found.node.y = (typeof found.node.y === "number" ? found.node.y : 0) + change.dy;
				if (change.w !== undefined) found.node.width = change.w;
				if (change.h !== undefined && !(found.node.type === "text" && found.node.textGrowth !== "fixed-width-height")) found.node.height = change.h;
				if (change.w !== undefined && found.node.type === "text" && (found.node.textGrowth ?? "auto") === "auto") found.node.textGrowth = "fixed-width";
			}
			doc = copy;
		}
		if ([...walk(doc.children)].some((node) => isArrow(node))) {
			const copy = structuredClone(doc);
			if (reroute(copy, layout(copy, expand(copy), { theme, measure: fonts.measure }), (path) => this.boards.get(path))) doc = copy;
		}
		const nodes = expand(doc);
		const generation = fonts.generation;
		void fonts.need(this.fontsFor(nodes, doc, theme)).then((fresh) => {
			// A font landed after this picture was drawn without it: lay out and draw again.
			if (fresh && fonts.generation !== generation && !this.disposed) {
				this.dirty = true;
				this.schedule();
			}
		});
		const placed = layout(doc, nodes, { theme, measure: fonts.measure });
		this.placed = placed;
		this.bounds = boundsOf(placed);
		this.drawnDoc = this.doc;
		this.painted = { nodes, doc, placed };
		this.under = backdrops(nodes, this.bounds, placed);
		const ctx = { ck, fonts, doc, placed, scheme: this.scheme, image: (url: string) => this.image(url), icon: (library: string, name: string, weight: number) => this.icons.get(library, name, weight), skip: this.hidden };
		const parts = this.split(nodes);
		for (const name of ["under", "over"] as const) {
			const recorder = new ck.PictureRecorder();
			paintDocument(recorder.beginRecording(ck.LTRBRect(-1e7, -1e7, 1e7, 1e7)), parts[name], ctx);
			this.sheets[name].picture = recorder.finishRecordingAsPicture();
			recorder.delete();
		}
		this.writeHits();
		this.drawn?.();
	}

	/** An image fill's picture, fetched once; the drawing is redone when it arrives. */
	private image(url: string): Image | undefined {
		const absolute = new URL(url, new URL(this.base || "/", location.href)).href;
		const known = this.images.get(absolute);
		if (known === "loading" || known === "failed") return undefined;
		if (known) return known;
		this.images.set(absolute, "loading");
		void fetch(absolute)
			.then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
			.then((bytes) => {
				const image = this.ck?.MakeImageFromEncoded(new Uint8Array(bytes));
				this.images.set(absolute, image ?? "failed");
				this.dirty = true;
				this.schedule();
			})
			.catch(() => this.images.set(absolute, "failed"));
		return undefined;
	}

	private render(): void {
		const { ck } = this;
		if (this.disposed) return;
		const empty = !this.doc || this.doc.children.length === 0;
		for (const sheet of Object.values(this.sheets)) if (sheet.element) sheet.element.hidden = empty;
		if (empty || !ck) return;
		if (this.dirty) {
			this.dirty = false;
			this.rebuild();
		}
		if (this.slide && !this.slide.base) this.recordSlide();
		const slide = this.slide?.base && this.slide.carried ? this.slide : undefined;
		this.paint("under", slide ? slide.base!.under : this.sheets.under.picture);
		this.paint("over", slide ? slide.base!.over : this.sheets.over.picture, slide ? { picture: slide.carried!, dx: slide.dx, dy: slide.dy } : undefined);
	}

	/** Draw one sheet: its picture under the camera, and anything being dragged on top of it. */
	private paint(name: SheetName, picture: Picture | undefined, carried?: { picture: Picture; dx: number; dy: number }): void {
		const { ck } = this;
		const sheet = this.sheets[name];
		const element = sheet.element;
		if (!ck || !element) return;
		const dpr = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.round(this.view.width * dpr));
		const height = Math.max(1, Math.round(this.view.height * dpr));
		const size = `${width}x${height}`;
		if (!sheet.surface || size !== sheet.size) {
			sheet.surface?.delete();
			element.width = width;
			element.height = height;
			sheet.surface = ck.MakeWebGLCanvasSurface(element) ?? ck.MakeSWCanvasSurface(element) ?? undefined;
			sheet.size = size;
			if (!sheet.surface) return;
		}
		const { x, y, zoom } = this.camera;
		if (name === "over") {
			/*
			 * The over sheet is among the boards, inside their transform, so it is placed back over the
			 * window: the inverse of the camera. Set here, with the camera this picture is drawn for, so
			 * between two frames it moves with the boards instead of a frame ahead of them.
			 */
			element.style.width = `${this.view.width}px`;
			element.style.height = `${this.view.height}px`;
			element.style.transform = `translate(${x - this.view.width / 2 / zoom}px, ${y - this.view.height / 2 / zoom}px) scale(${1 / zoom})`;
		}
		const canvas = sheet.surface.getCanvas();
		canvas.clear(ck.TRANSPARENT);
		canvas.save();
		canvas.scale(dpr, dpr);
		canvas.translate(this.view.width / 2, this.view.height / 2);
		canvas.scale(zoom, zoom);
		canvas.translate(-x, -y);
		if (picture) canvas.drawPicture(picture);
		if (carried) {
			canvas.translate(carried.dx, carried.dy);
			canvas.drawPicture(carried.picture);
		}
		canvas.restore();
		sheet.surface.flush();
	}

	/**
	 * The click shapes: one invisible SVG shape per drawn item on the over sheet, in stage units,
	 * among the boards. A filled shape catches clicks over its area; a line, over a band 12 units
	 * wide, so a thin arrow can still be picked up. A group has no shape of its own: its children do.
	 */
	private writeHits(): void {
		const svg = this.hits;
		if (!svg) return;
		const NS = "http://www.w3.org/2000/svg";
		const shapes: SVGElement[] = [];
		const add = (placed: Placed) => {
			const { node, box } = placed;
			if (node.id.includes("/") && node.type === "group") return;
			if (node.type === "browser" && node.metadata?.type === "decks.board") return;
			if (node.type === "group") return;
			let shape: SVGElement;
			if (node.type === "ellipse") {
				shape = document.createElementNS(NS, "ellipse");
				shape.setAttribute("cx", String(box.x + box.w / 2));
				shape.setAttribute("cy", String(box.y + box.h / 2));
				shape.setAttribute("rx", String(box.w / 2));
				shape.setAttribute("ry", String(box.h / 2));
			} else if (node.type === "path" && typeof node.geometry === "string") {
				const vb = node.viewBox ?? (() => {
					const b = pathBounds(node.geometry as string);
					return b ? ([b.x, b.y, b.w, b.h] as const) : undefined;
				})();
				if (!vb || vb[2] <= 0 || vb[3] <= 0) return;
				shape = document.createElementNS(NS, "path");
				shape.setAttribute("d", node.geometry);
				shape.setAttribute("transform", `translate(${box.x} ${box.y}) scale(${box.w / vb[2]} ${box.h / vb[3]}) translate(${-vb[0]} ${-vb[1]})`);
				const filled = node.fill !== undefined && node.fill !== null;
				shape.setAttribute("stroke-width", String(Math.max(12, typeof node.strokeWidth === "number" ? node.strokeWidth : 0)));
				shape.setAttribute("vector-effect", "non-scaling-stroke");
				shape.style.pointerEvents = filled ? "all" : "stroke";
			} else {
				const bounds = this.bounds.get(node.id) ?? box;
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
		};
		for (const placed of this.placed.values()) {
			let top = placed;
			while (top.parent) top = this.placed.get(top.parent) ?? top;
			if (top.parent || this.under.has(top.node.id)) continue;
			add(placed);
		}
		svg.replaceChildren(...shapes);
	}
}
