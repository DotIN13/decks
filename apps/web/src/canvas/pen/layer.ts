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

/**
 * The stage's drawing layer: one `<canvas>` under the boards, drawn by CanvasKit.
 *
 * The document is laid out and recorded **once per change** into a Skia picture in stage
 * coordinates; every frame after that only replays the picture under the camera — a translate and
 * a scale — so a pan or a pinch costs the same whether the drawing has five items or five hundred,
 * and stays sharp at any zoom because the picture is vectors, not pixels.
 *
 * It follows the camera by being told, in the same call that moves the boards' transform
 * (`Stage.writeTransform`), and draws at most once per animation frame. Pointer events pass
 * through it: the drawing is read-only to the person for now.
 *
 * CanvasKit is loaded the first time a document has anything in it, never for an empty stage.
 */

export class PenLayer {
	private element: HTMLCanvasElement | undefined;
	private ck: CanvasKit | undefined;
	private fonts: PenFonts | undefined;
	private surface: Surface | undefined;
	private surfaceSize = "";
	private picture: Picture | undefined;
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
			this.slide = { key, ids: new Set(moving!.keys()), dx: first.dx, dy: first.dy, base: this.slide?.base, over: this.slide?.over };
			this.schedule();
			return;
		}
		this.dropSlide();
		this.moving = moving;
		this.dirty = true;
		this.schedule();
	}

	/** The two pictures a move slides between, while one is in progress. */
	private slide: { key: string; ids: Set<string>; dx: number; dy: number; base: Picture | undefined; over: Picture | undefined } | undefined;
	/** What the last picture was painted from, so a slide can record from the same thing. */
	private painted: { nodes: PenNode[]; doc: PenDocument; placed: Map<string, Placed> } | undefined;

	private dropSlide(): void {
		this.slide?.base?.delete();
		this.slide?.over?.delete();
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
		slide.base = record((canvas) => paintDocument(canvas, painted.nodes, { ...ctx, skip: slide.ids }));
		const carried = [...slide.ids].flatMap((id) => {
			const node = painted.placed.get(id)?.node;
			return node ? [node] : [];
		});
		slide.over = record((canvas) => paintDocument(canvas, carried, ctx));
	}

	attach(element: HTMLCanvasElement): void {
		this.element = element;
		this.surfaceSize = "";
		this.schedule();
	}

	setDoc(doc: PenDocument | undefined, base: string): void {
		if (doc === this.doc && base === this.base) return;
		// The server's answer has arrived, so whatever a drag was previewing is now the drawing itself.
		this.moving = undefined;
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
		this.picture?.delete();
		this.picture = undefined;
		this.surface?.delete();
		this.surface = undefined;
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
		this.picture?.delete();
		this.picture = undefined;
		this.placed = new Map();
		this.bounds = new Map();
		this.dropSlide();
		if (!doc || doc.children.length === 0) return;
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
		this.painted = { nodes, doc, placed };
		const recorder = new ck.PictureRecorder();
		const canvas = recorder.beginRecording(ck.LTRBRect(-1e7, -1e7, 1e7, 1e7));
		paintDocument(canvas, nodes, { ck, fonts, doc, placed, scheme: this.scheme, image: (url) => this.image(url), icon: (library, name, weight) => this.icons.get(library, name, weight) });
		this.picture = recorder.finishRecordingAsPicture();
		recorder.delete();
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
		const { element, ck } = this;
		if (!element || this.disposed) return;
		const empty = !this.doc || this.doc.children.length === 0;
		element.hidden = empty;
		if (empty || !ck) return;
		const dpr = window.devicePixelRatio || 1;
		const width = Math.max(1, Math.round(this.view.width * dpr));
		const height = Math.max(1, Math.round(this.view.height * dpr));
		const size = `${width}x${height}`;
		if (!this.surface || size !== this.surfaceSize) {
			this.surface?.delete();
			element.width = width;
			element.height = height;
			this.surface = ck.MakeWebGLCanvasSurface(element) ?? ck.MakeSWCanvasSurface(element) ?? undefined;
			this.surfaceSize = size;
			if (!this.surface) return;
		}
		if (this.dirty) {
			this.dirty = false;
			this.rebuild();
		}
		const canvas = this.surface.getCanvas();
		canvas.clear(ck.TRANSPARENT);
		if (this.slide && !this.slide.base) this.recordSlide();
		const slide = this.slide?.base && this.slide.over ? this.slide : undefined;
		if (this.picture) {
			canvas.save();
			canvas.scale(dpr, dpr);
			canvas.translate(this.view.width / 2, this.view.height / 2);
			canvas.scale(this.camera.zoom, this.camera.zoom);
			canvas.translate(-this.camera.x, -this.camera.y);
			if (slide) {
				canvas.drawPicture(slide.base!);
				canvas.translate(slide.dx, slide.dy);
				canvas.drawPicture(slide.over!);
			} else canvas.drawPicture(this.picture);
			canvas.restore();
		}
		this.surface.flush();
	}
}

/**
 * What each item looks like it covers, which is not always the box it was given.
 *
 * A path fills its box with its `viewBox`, so a petal drawn in one corner of a 600 by 700 viewBox
 * has a 600 by 700 box; what it covers is its geometry, mapped into that box, and widened by half
 * its stroke. A group covers what its children cover. Everything else covers its box.
 */
export function boundsOf(placed: ReadonlyMap<string, Placed>): Map<string, Frame> {
	const out = new Map<string, Frame>();
	const children = new Map<string, Placed[]>();
	for (const item of placed.values()) if (item.parent) (children.get(item.parent) ?? children.set(item.parent, []).get(item.parent)!).push(item);
	const visit = (item: Placed): Frame => {
		const known = out.get(item.node.id);
		if (known) return known;
		const { node, box } = item;
		let bounds: Frame = box;
		if (node.type === "path" && typeof node.geometry === "string") {
			const drawn = pathBounds(node.geometry);
			const vb = node.viewBox;
			if (drawn && vb && vb[2] > 0 && vb[3] > 0) {
				const sx = box.w / vb[2];
				const sy = box.h / vb[3];
				const pad = (typeof node.strokeWidth === "number" && node.stroke !== undefined ? node.strokeWidth : 0) / 2;
				bounds = { x: box.x + (drawn.x - vb[0]) * sx - pad, y: box.y + (drawn.y - vb[1]) * sy - pad, w: drawn.w * sx + pad * 2, h: drawn.h * sy + pad * 2 };
			}
		} else if (node.type === "group") {
			const kids = (children.get(node.id) ?? []).map(visit);
			if (kids.length) {
				const x1 = Math.min(...kids.map((k) => k.x));
				const y1 = Math.min(...kids.map((k) => k.y));
				bounds = { x: x1, y: y1, w: Math.max(...kids.map((k) => k.x + k.w)) - x1, h: Math.max(...kids.map((k) => k.y + k.h)) - y1 };
			}
		}
		out.set(node.id, bounds);
		return bounds;
	};
	for (const item of placed.values()) visit(item);
	return out;
}
