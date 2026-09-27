import type { CanvasKit, Image, SkPicture as Picture, Surface } from "canvaskit-wasm";
import { baseTheme, expand, indexOf, isArrow, isMarkdown, layout, NOTE_PAD, pathBounds, reroute, resolve, walk, textStyleOf, withTheme, type Frame, type PenDocument, type PenNode, type Placed } from "@decks/pen";

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
import { MONO_FAMILY, PenFonts, type FontNeed } from "./fonts.ts";
import { parseMarkdown, wordsOf } from "./markdown.ts";
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
 * coordinates, and stays sharp at any zoom because the pictures are vectors, not pixels.
 *
 * **A pan paints nothing.** Both sheets are in the world, among the boards, under the same transform
 * that moves them: each is a canvas placed in stage units over a *painted region* — the window and a
 * quarter of a window round it — and its pixels are the region at the zoom it was painted at, one
 * pixel to a device pixel. A pan moves it with the boards and costs the drawing nothing; it is
 * painted again only when the view nears the region's edge, when the drawing or the scheme or the
 * window changes, or when a zoom comes to rest. While a zoom is under way the old painting is
 * stretched by the world's transform, as the boards are, and it is painted sharp once, when the zoom
 * stops (`ZOOM_REST_MS`). Replaying the whole picture into two window-sized WebGL canvases on every
 * camera frame, which is what this did before, kept a weak GPU busy for the whole of a pan: the
 * frames fell to forty a second and the stage trailed the hand.
 *
 * A sheet with nothing on it is hidden and never painted: most stages have nothing under their boards.
 *
 * CanvasKit is loaded the first time a document has anything in it, never for an empty stage.
 */

interface Sheet {
	element?: HTMLCanvasElement;
	surface?: Surface;
	size: string;
	picture?: Picture;
	/** Whether anything is drawn on this sheet at all; an empty one is hidden and never painted. */
	filled?: boolean;
}

/**
 * Where the sheets were last painted: a rectangle in stage units, and the zoom, the device pixel
 * ratio and the window they were painted for. `scale` is device pixels to a stage unit.
 */
interface Region {
	x: number;
	y: number;
	w: number;
	h: number;
	zoom: number;
	scale: number;
	dpr: number;
	pixels: { width: number; height: number };
}

/** How far past the window the sheets are painted, on each side, as a fraction of the window. */
const MARGIN = 0.25;
/** How long the zoom has to stay the same before the drawing is painted sharp at it. */
const ZOOM_REST_MS = 200;
/**
 * The most pixels a sheet's backing store may have: a side the GPU can hold as one texture, and an
 * area of a large window's worth at 2x. Past either the margin is given up first, then resolution.
 */
const MAX_AREA = 24_000_000;
let maxSide: number | undefined;
const sideLimit = (): number => {
	if (maxSide === undefined) {
		maxSide = 8192;
		try {
			const gl = document.createElement("canvas").getContext("webgl");
			if (gl) {
				maxSide = Math.min(maxSide, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
				gl.getExtension("WEBGL_lose_context")?.loseContext();
			}
		} catch {
			// No WebGL to ask: the software surface has no texture limit, and 8192 is sane for it.
		}
	}
	return maxSide;
};

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
	/** The sheets no longer show what they should (a new picture, a slide, a new element or window). */
	private stale = true;
	private region: Region | undefined;
	/** A zoom is under way: the painting is stretched until it rests (`ZOOM_REST_MS`). */
	private zooming = false;
	private zoomRest: ReturnType<typeof setTimeout> | undefined;
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
	hitTest(point: { x: number; y: number }, options?: { deep?: boolean; skip?: (node: PenNode) => boolean }): PenHit | undefined {
		let best: Placed | undefined;
		for (const placed of this.placed.values()) {
			const { node } = placed;
			if (node.id.includes("/") || node.type === "group") continue;
			if (options?.skip?.(node)) continue;
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
	/** The markdown card on top at a stage point, its layout as drawn, and the point inside it. */
	private cardAt(point: { x: number; y: number }) {
		const fonts = this.fonts;
		const doc = this.drawnDoc;
		if (!fonts || !doc) return undefined;
		let found: { id: string; layout: ReturnType<PenFonts["markdown"]>; x: number; y: number } | undefined;
		let order = -1;
		for (const placed of this.placed.values()) {
			const { node, box } = placed;
			if (!isMarkdown(node) || placed.order < order || this.hidden.has(node.id)) continue;
			if (point.x < box.x || point.x > box.x + box.w || point.y < box.y || point.y > box.y + box.h) continue;
			const content = String(resolve(doc, node.content, withTheme(placed.theme, node)) ?? "");
			const layout = fonts.markdown(content, textStyleOf(doc, node, placed.theme), { width: box.w - NOTE_PAD * 2, align: node.textAlign ?? "left" });
			order = placed.order;
			found = { id: node.id, layout, x: point.x - box.x - NOTE_PAD, y: point.y - box.y - NOTE_PAD };
		}
		return found;
	}

	/**
	 * The link under a stage point, in a markdown card: where a press there would go. The card's
	 * layout is the one it was drawn with (`fonts.markdown` keeps it), so the boxes are exact; a link
	 * in a wide table is where the table's scroll has put it, and only while it is in view.
	 */
	linkAt(point: { x: number; y: number }): string | undefined {
		const card = this.cardAt(point);
		if (!card) return undefined;
		const { layout, x, y } = card;
		return layout.links.find((l) => {
			let lx = l.x;
			if (l.scroller !== undefined) {
				const view = layout.scrollers[l.scroller];
				if (!view || x < view.x || x > view.x + view.w) return false;
				lx -= this.scrollOf(card.id, l.scroller);
			}
			return x >= lx && x <= lx + l.w && y >= l.y && y <= l.y + l.h;
		})?.href;
	}

	/** How far each card's wide tables are scrolled, by `id:index`. The stage's to keep, not the file's. */
	private readonly scrolls = new Map<string, number>();
	private readonly scrollOf = (id: string, index: number): number => this.scrolls.get(`${id}:${index}`) ?? 0;

	/**
	 * Scroll the wide table under a stage point sideways by `dx` stage pixels. True when there was one
	 * to scroll — even at its end, so a sideways gesture over a table never turns into a pan halfway.
	 */
	scrollBy(point: { x: number; y: number }, dx: number): boolean {
		const card = this.cardAt(point);
		if (!card) return false;
		const index = card.layout.scrollers.findIndex((v) => card.x >= v.x && card.x <= v.x + v.w && card.y >= v.y && card.y <= v.y + v.h);
		const view = card.layout.scrollers[index];
		if (!view) return false;
		const key = `${card.id}:${index}`;
		const now = this.scrolls.get(key) ?? 0;
		const next = Math.max(0, Math.min(view.content - view.w, now + dx));
		if (next !== now) {
			this.scrolls.set(key, next);
			this.dirty = true;
			this.schedule();
		}
		return true;
	}

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
		const ctx = { ck, fonts, doc: painted.doc, placed: painted.placed, scheme: this.scheme, image: (url: string) => this.image(url), icon: (library: string, name: string, weight: number) => this.icons.get(library, name, weight), scroll: this.scrollOf };
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
	/** Items drawn without their words, while the words are being typed in an editor over them. */
	private muted: ReadonlySet<string> = new Set();

	muteText(ids: ReadonlySet<string> | undefined): void {
		const next = ids ?? new Set<string>();
		if (next.size === 0 && this.muted.size === 0) return;
		this.muted = next;
		this.dirty = true;
		this.schedule();
	}

	hide(ids: ReadonlySet<string> | undefined): void {
		const next = ids ?? new Set<string>();
		if (next.size === 0 && this.hidden.size === 0) return;
		this.hidden = next;
		this.dirty = true;
		this.schedule();
	}

	attach(element: HTMLCanvasElement, sheet: SheetName = "under"): void {
		this.sheets[sheet].surface?.delete();
		const { picture, filled } = this.sheets[sheet];
		this.sheets[sheet] = { element, size: "", ...(picture ? { picture } : {}), ...(filled !== undefined ? { filled } : {}) };
		this.stale = true;
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
		if (this.fonts) this.fonts.scheme = scheme;
		this.dirty = true;
		this.schedule();
	}

	/**
	 * The camera the boards are under. A pan inside the painted region paints nothing (the sheets
	 * are in the world and move with it); a change of zoom is noted, and the drawing painted sharp
	 * at the new zoom once it has held still for `ZOOM_REST_MS`.
	 */
	setCamera(camera: Camera): void {
		if (camera.zoom !== this.camera.zoom) {
			this.zooming = true;
			clearTimeout(this.zoomRest);
			this.zoomRest = setTimeout(() => {
				this.zooming = false;
				this.schedule();
			}, ZOOM_REST_MS);
		}
		this.camera = camera;
		this.schedule();
	}

	setView(view: { width: number; height: number }): void {
		if (view.width === this.view.width && view.height === this.view.height) return;
		this.view = view;
		this.stale = true;
		this.schedule();
	}

	dispose(): void {
		this.disposed = true;
		this.dropSlide();
		cancelAnimationFrame(this.frame);
		clearTimeout(this.zoomRest);
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
			this.fonts.images = (url) => this.image(url);
			this.fonts.scheme = this.scheme;
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
			// A markdown card sets headings and bold heavier, emphasis in italic and code in a monospace face.
			if (isMarkdown(node)) {
				// The words as drawn (emoji for their shortcodes, and so on), and the list markers and the
				// picture sign, which are signs Inter does not draw.
				needs.push({ family: style.fontFamily, weight: 400, italic: false, text: `${wordsOf(parseMarkdown(node.content))}◦▪🖼` });
				needs.push({ family: style.fontFamily, weight: 700, italic: false, text: node.content }, { family: style.fontFamily, weight: 600, italic: false, text: node.content }, { family: style.fontFamily, weight: style.fontWeight, italic: true, text: node.content });
				if (/`|^( {4}|\t)|<code|<pre/m.test(node.content)) needs.push({ family: MONO_FAMILY, weight: 400, italic: false, text: node.content }, { family: MONO_FAMILY, weight: 700, italic: false, text: node.content });
			}
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
			sheet.filled = false;
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
		const ctx = { ck, fonts, doc, placed, scheme: this.scheme, image: (url: string) => this.image(url), icon: (library: string, name: string, weight: number) => this.icons.get(library, name, weight), skip: this.hidden, mute: this.muted, scroll: this.scrollOf };
		const parts = this.split(nodes);
		for (const name of ["under", "over"] as const) {
			const recorder = new ck.PictureRecorder();
			paintDocument(recorder.beginRecording(ck.LTRBRect(-1e7, -1e7, 1e7, 1e7)), parts[name], ctx);
			this.sheets[name].picture = recorder.finishRecordingAsPicture();
			this.sheets[name].filled = parts[name].length > 0;
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
				if (this.fonts) this.fonts.imageVersion++;
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
		if (empty) for (const sheet of Object.values(this.sheets)) if (sheet.element) sheet.element.hidden = true;
		if (empty || !ck) return;
		if (this.dirty) {
			this.dirty = false;
			this.rebuild();
			this.stale = true;
		}
		// A slide is painted on every frame it moves: what is carried is not where it was painted.
		if (this.slide) {
			if (!this.slide.base) this.recordSlide();
			this.stale = true;
		}
		const region = this.nextRegion();
		if (!region) return;
		this.stale = false;
		this.region = region;
		const slide = this.slide?.base && this.slide.carried ? this.slide : undefined;
		this.paint("under", region, slide ? slide.base!.under : this.sheets.under.picture);
		this.paint("over", region, slide ? slide.base!.over : this.sheets.over.picture, slide ? { picture: slide.carried!, dx: slide.dx, dy: slide.dy } : undefined);
	}

	/**
	 * The region to paint the sheets over now, or nothing when the painting on screen still does.
	 *
	 * It still does while the window is inside the painted region at the zoom it was painted at: a
	 * pan. During a zoom it is kept, stretched, as long as it covers the window and is not blown up
	 * past twice its resolution; the zoom coming to rest paints it again, sharp.
	 */
	private nextRegion(): Region | undefined {
		const { width, height } = this.view;
		if (width <= 0 || height <= 0) return undefined;
		const dpr = window.devicePixelRatio || 1;
		const { x, y, zoom } = this.camera;
		const was = this.region;
		if (was && !this.stale && was.dpr === dpr) {
			// Half a screen pixel of slack, so a region that just covers the window is not painted every frame.
			const slack = 0.5 / zoom;
			const hw = width / 2 / zoom;
			const hh = height / 2 / zoom;
			const covered = x - hw >= was.x - slack && y - hh >= was.y - slack && x + hw <= was.x + was.w + slack && y + hh <= was.y + was.h + slack;
			if (covered && (zoom === was.zoom || (this.zooming && zoom <= was.zoom * 2))) return undefined;
		}
		/*
		 * The window and a margin round it, one pixel to a device pixel — unless that is more than
		 * the GPU should hold, when the margin shrinks first and then the resolution.
		 */
		const limit = sideLimit();
		const grow = Math.min(1 + 2 * MARGIN, limit / (width * dpr), limit / (height * dpr), Math.sqrt(MAX_AREA / (width * height)) / dpr);
		const cover = Math.max(1, grow);
		const scale = zoom * dpr * Math.min(1, grow);
		const pixels = {
			width: Math.max(1, Math.min(limit, Math.ceil(width * cover * dpr * Math.min(1, grow)))),
			height: Math.max(1, Math.min(limit, Math.ceil(height * cover * dpr * Math.min(1, grow)))),
		};
		// The region's corner on a whole device pixel of the window, so what is painted lands on the pixels it was painted for.
		const left = Math.round(((width - width * cover) / 2) * dpr) / dpr;
		const top = Math.round(((height - height * cover) / 2) * dpr) / dpr;
		return { x: x + (left - width / 2) / zoom, y: y + (top - height / 2) / zoom, w: pixels.width / scale, h: pixels.height / scale, zoom, scale, dpr, pixels };
	}

	/** Paint one sheet over a region: its picture, and anything being dragged on top of it. */
	private paint(name: SheetName, region: Region, picture: Picture | undefined, carried?: { picture: Picture; dx: number; dy: number }): void {
		const { ck } = this;
		const sheet = this.sheets[name];
		const element = sheet.element;
		if (!ck || !element) return;
		const filled = (sheet.filled && picture) || carried;
		element.hidden = !filled;
		if (!filled) return;
		const { width, height } = region.pixels;
		const size = `${width}x${height}`;
		if (!sheet.surface || size !== sheet.size) {
			sheet.surface?.delete();
			element.width = width;
			element.height = height;
			sheet.surface = ck.MakeWebGLCanvasSurface(element) ?? ck.MakeSWCanvasSurface(element) ?? undefined;
			sheet.size = size;
			if (!sheet.surface) return;
		}
		/*
		 * Placed in stage units, in the world, where the region is: the world's transform puts it on
		 * screen with the boards. Set here, with the picture drawn for it, so the two change together.
		 */
		element.style.width = `${region.w}px`;
		element.style.height = `${region.h}px`;
		element.style.transform = `translate(${region.x}px, ${region.y}px)`;
		const canvas = sheet.surface.getCanvas();
		canvas.clear(ck.TRANSPARENT);
		canvas.save();
		canvas.scale(region.scale, region.scale);
		canvas.translate(-region.x, -region.y);
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
