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
 * that moves them, and each is a grid of **tiles**: small `<canvas>` elements placed in stage units,
 * each the picture painted over one square of 512 device pixels at the zoom it was painted for. The
 * grid is fixed to the stage, not to the window, so a pan moves the tiles with the boards and costs
 * the drawing nothing, and only the few tiles coming into view — a ring of one tile is kept painted
 * round the window, ahead of the pan first — are painted, a few a frame (`TILE_MS`), nearest the
 * middle first. Replaying the whole picture into two window-sized WebGL canvases on every camera
 * frame kept a weak GPU busy for the whole of a pan (the frames fell to forty a second and the stage
 * trailed the hand); painting one big region round the window and moving it was better, but painted
 * all of it again every quarter of a window a pan went.
 *
 * **One painter.** A page may only have a handful of WebGL contexts, so the tiles are plain 2D (or
 * bitmap) canvases, and CanvasKit paints every one of them, in turn, on one hidden 512-pixel WebGL
 * surface (`Painter`). Each finished tile is handed over whole: `transferToImageBitmap` gives the
 * surface's pixels away as a texture, with no copy and no read back, and the tile shows it
 * (`bitmaprenderer`). Where that is missing, the tile draws the surface onto itself instead, which is
 * a copy on the GPU and never a read back either.
 *
 * **A zoom stretches, then sharpens.** While a zoom is under way the tiles are stretched by the
 * world's transform, as the boards are. When it has been still for `ZOOM_REST_MS` a new generation of
 * tiles is painted at the new zoom, a few a frame, over the old one, which is let go of once the new
 * one covers the window: the drawing is never missing, only soft for a moment. A zoom that runs far
 * out starts a coarser generation on the way, so what comes into view is filled rather than left bare.
 *
 * **Edges meet.** Two tiles side by side on a fractional pixel are each drawn with a soft edge by the
 * compositor, and the two soft edges let the paper through as a faint line. So each sheet is nudged
 * by less than a device pixel (`place`), with the camera, so that the tiles' corners land on whole
 * device pixels: at the zoom they were painted for they are copied pixel for pixel, with no seam.
 *
 * **Only ink is painted.** A tile with nothing drawn in it (by the items' bounds, padded for shadows)
 * is never made, and a sheet with nothing on it is hidden: most stages have nothing under their
 * boards, and a sparse one costs a few tiles.
 *
 * **Changes.** A new picture (the drawing, a font or an image arriving, the scheme, an eraser, a word
 * typed, a table scrolled) marks every tile stale; the ones in view are painted again at once, in the
 * same frame, and the rest a few a frame. A drag slides what it carries on tiles of its own
 * (`carried`), painted once and moved by a transform on every step after that.
 *
 * CanvasKit is loaded the first time a document has anything in it, never for an empty stage.
 */

/** One tile: a square of `TILE` device pixels at a scale (`level`, device pixels to a stage unit), at column `c` and row `r`. */
interface Tile {
	element: HTMLCanvasElement;
	level: number;
	c: number;
	r: number;
	/** Painted from the sheet's current picture; a stale one still shows until it is painted again. */
	fresh: boolean;
}

/** A set of tiles over one picture: the under sheet, the over sheet, or what a drag carries. */
interface Sheet {
	element?: HTMLElement;
	/** The sheet's recorded picture; a slide paints the sheet from its own instead. */
	picture?: Picture;
	/** Whether anything is drawn on this sheet at all; an empty one is hidden and never painted. */
	filled?: boolean;
	/** Where the picture draws, in stage units, padded for what a shadow or a stroke adds. */
	ink: Frame[];
	/** The picture the tiles were painted from: another one makes them stale. */
	shown?: Picture;
	/** Its tiles, by `level c r`. */
	tiles: Map<string, Tile>;
	/** Whether a cell has ink in it, by `level c r`; forgotten with the picture. */
	inked: Map<string, boolean>;
	/** Just made stale: the tiles in view are painted again in this frame, whatever it costs. */
	urgent?: boolean;
	/** The transform last written on the element, so an unchanged one is not written again. */
	placed?: string;
}

/** The hidden surface every tile is painted on, and how its pixels get to the tile. */
interface Painter {
	surface: Surface;
	source: OffscreenCanvas | HTMLCanvasElement;
	transfer: boolean;
}

/** A tile's side, in device pixels. */
const TILE = 512;
/**
 * A tile's bitmap, a pixel more than its side: each tile overlaps the ones to its right and below by
 * one device pixel of the same picture. The edges cannot be made to meet exactly: far from the stage's
 * origin (herobrine's drawing is 138,000 units down) the compositor works out where each tile lands in
 * single precision, and two neighbours came out a fiftieth of a pixel apart, which showed as a faint
 * line through the words. Overlapping by a pixel covers the gap whatever the rounding.
 */
const BITMAP = TILE + 1;
/** Tiles kept painted round the window, on each side. */
const RING = 1;
/** How long a frame may spend painting tiles, and longer when the window has a hole in it. */
const TILE_MS = 5;
const HOLE_MS = 12;
/** How long the zoom has to stay the same before the drawing is painted sharp at it. */
const ZOOM_REST_MS = 200;
/** Tiles kept, all sheets together: each is a megabyte of texture. */
const MAX_TILES = 256;
/** Tile elements kept for reuse once let go of. */
const POOL = 32;
/** How far past an item's bounds it may draw — the app's note shadow — before its own effects are added. */
const INK_PAD = 40;

export type SheetName = "under" | "over";

export class PenLayer {
	/**
	 * `progressive: false` paints every tile in view in the frame that needs it, and none round it:
	 * the screenshot page (`shot.ts`) has one camera, and must have all of the drawing at once.
	 */
	constructor(options?: { progressive?: boolean }) {
		this.progressive = options?.progressive ?? true;
	}

	private readonly progressive: boolean;
	private readonly sheets: Record<SheetName, Sheet> = { under: { ink: [], tiles: new Map(), inked: new Map() }, over: { ink: [], tiles: new Map(), inked: new Map() } };
	/** What a drag carries, on tiles of its own in the over sheet, moved by a transform as the drag goes. */
	private readonly carried: Sheet = { ink: [], tiles: new Map(), inked: new Map() };
	private painter: Painter | null | undefined;
	/** Tile elements let go of, kept to be used again. */
	private readonly pool: HTMLCanvasElement[] = [];
	/** The scale the tiles are being painted at: the camera's, once a zoom rests. */
	private level: number | undefined;
	/** Which way the view last moved, in stage units: the ring ahead of a pan is painted first. */
	private motion = { x: 0, y: 0 };
	/** Where the world's box is on the page, for placing the tiles on whole device pixels. */
	private origin = { x: 0, y: 0 };
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
			// A step moves the carried tiles, and paints only those it brings into view.
			this.place();
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
			// With its bounds worked out, so a tile replays only what is drawn in it.
			paint(recorder.beginRecording(ck.LTRBRect(-1e7, -1e7, 1e7, 1e7), true));
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
		this.carried.ink = this.inkOf(carried);
	}

	/** Where some top-level items draw (`Sheet.ink`): their bounds, padded for shadows and strokes. */
	private inkOf(nodes: readonly PenNode[]): Frame[] {
		const ink: Frame[] = [];
		for (const node of nodes) {
			const box = this.bounds.get(node.id) ?? this.placed.get(node.id)?.box;
			// Nothing known of where it draws: the whole stage, so it is never left out.
			if (!box) return [{ x: -1e7, y: -1e7, w: 2e7, h: 2e7 }];
			let pad = INK_PAD;
			for (const inner of walk([node])) {
				const stroke = typeof inner.strokeWidth === "number" ? inner.strokeWidth : 0;
				let reach = stroke;
				const effects = inner.effect === undefined ? [] : Array.isArray(inner.effect) ? inner.effect : [inner.effect];
				for (const effect of effects) {
					if (!effect || effect.type !== "shadow") continue;
					const at = (value: unknown) => (typeof value === "number" ? Math.abs(value) : 100);
					reach = Math.max(reach, at(effect.offset?.x ?? 0) + at(effect.offset?.y ?? 0) + at(effect.blur ?? 0) * 1.5 + at(effect.spread ?? 0) + stroke);
				}
				pad = Math.max(pad, INK_PAD + reach);
			}
			ink.push({ x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 });
		}
		return ink;
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

	/**
	 * The element a sheet's tiles are put in: a box in the world, at its origin. The over sheet's
	 * also holds the tiles of what a drag carries, over its own.
	 */
	attach(element: HTMLElement, sheet: SheetName = "under"): void {
		const at = this.sheets[sheet];
		// The tiles were in the element before, and went with it.
		at.tiles.clear();
		delete at.shown;
		delete at.placed;
		at.element = element;
		if (sheet === "over") {
			this.carried.tiles.clear();
			delete this.carried.shown;
			delete this.carried.placed;
			const carried = document.createElement("div");
			carried.className = "pen-carried";
			element.append(carried);
			this.carried.element = carried;
		}
		this.measure();
		this.place();
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
	 * The camera the boards are under. A pan paints nothing (the tiles are in the world and move
	 * with it) but the tiles it brings into view; a change of zoom is noted, and the drawing painted
	 * sharp at the new zoom once it has held still for `ZOOM_REST_MS`.
	 */
	setCamera(camera: Camera): void {
		if (camera.zoom !== this.camera.zoom) {
			this.zooming = true;
			clearTimeout(this.zoomRest);
			this.zoomRest = setTimeout(() => {
				this.zooming = false;
				this.schedule();
			}, ZOOM_REST_MS);
		} else if (camera.x !== this.camera.x || camera.y !== this.camera.y) {
			this.motion = { x: camera.x - this.camera.x, y: camera.y - this.camera.y };
		}
		this.camera = camera;
		// In the same call as the world's transform, so the nudge onto whole pixels is never a frame behind it.
		this.place();
		this.schedule();
	}

	setView(view: { width: number; height: number }): void {
		if (view.width === this.view.width && view.height === this.view.height) return;
		this.view = view;
		this.measure();
		this.place();
		this.schedule();
	}

	/** Where the world's box is on the page: the tiles are put on whole device pixels of the page, not of the box. */
	private measure(): void {
		const box = (this.sheets.under.element ?? this.sheets.over.element)?.parentElement?.parentElement?.getBoundingClientRect();
		if (box) this.origin = { x: box.left, y: box.top };
	}

	/**
	 * Nudge each sheet by less than a device pixel, so that at the camera's zoom the stage's origin —
	 * and with it every tile's corner, at the zoom the tiles were painted for — is on a whole device
	 * pixel (see the top of the file). What a drag carries is moved by whole device pixels too.
	 */
	private place(): void {
		const dpr = window.devicePixelRatio || 1;
		const { x, y, zoom } = this.camera;
		const scale = zoom * dpr;
		const ax = (this.origin.x + this.view.width / 2 - zoom * x) * dpr;
		const ay = (this.origin.y + this.view.height / 2 - zoom * y) * dpr;
		const nudge = `translate(${(Math.round(ax) - ax) / scale}px, ${(Math.round(ay) - ay) / scale}px)`;
		for (const sheet of [this.sheets.under, this.sheets.over]) {
			if (!sheet.element || sheet.placed === nudge) continue;
			sheet.element.style.transform = nudge;
			sheet.placed = nudge;
		}
		const carried = this.carried;
		if (carried.element) {
			const slide = this.slide;
			const moved = slide ? `translate(${Math.round(slide.dx * scale) / scale}px, ${Math.round(slide.dy * scale) / scale}px)` : "";
			if (carried.placed !== moved) {
				carried.element.style.transform = moved;
				carried.placed = moved;
			}
		}
	}

	dispose(): void {
		this.disposed = true;
		this.dropSlide();
		cancelAnimationFrame(this.frame);
		clearTimeout(this.zoomRest);
		for (const sheet of [this.sheets.under, this.sheets.over, this.carried]) {
			sheet.picture?.delete();
			for (const tile of sheet.tiles.values()) tile.element.remove();
			sheet.tiles.clear();
		}
		this.carried.element?.remove();
		this.pool.length = 0;
		this.painter?.surface.delete();
		this.painter = undefined;
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
			// With its bounds worked out, so a tile replays only what is drawn in it.
			paintDocument(recorder.beginRecording(ck.LTRBRect(-1e7, -1e7, 1e7, 1e7), true), parts[name], ctx);
			this.sheets[name].picture = recorder.finishRecordingAsPicture();
			this.sheets[name].filled = parts[name].length > 0;
			this.sheets[name].ink = this.inkOf(parts[name]);
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
		if (empty) {
			for (const sheet of [this.sheets.under, this.sheets.over, this.carried]) {
				this.release(sheet, () => true);
				delete sheet.shown;
			}
			for (const sheet of Object.values(this.sheets)) if (sheet.element) sheet.element.hidden = true;
		}
		if (empty || !ck) return;
		if (this.dirty) {
			this.dirty = false;
			this.rebuild();
		}
		if (this.slide && !this.slide.base) this.recordSlide();
		this.painter ??= this.makePainter();
		const painter = this.painter;
		const { width, height } = this.view;
		if (!painter || width <= 0 || height <= 0) return;
		const dpr = window.devicePixelRatio || 1;
		const { x, y, zoom } = this.camera;
		const level = this.levelFor(zoom * dpr);
		const size = TILE / level;
		const slide = this.slide?.base && this.slide.carried ? this.slide : undefined;
		const { under, over } = this.sheets;
		// What each set of tiles shows now, and how far it is moved: a slide paints the sheets without what it carries.
		const sets: Array<{ sheet: Sheet; picture: Picture | undefined; dx: number; dy: number }> = [
			{ sheet: under, picture: under.filled ? (slide ? slide.base!.under : under.picture) : undefined, dx: 0, dy: 0 },
			{ sheet: over, picture: over.filled ? (slide ? slide.base!.over : over.picture) : undefined, dx: 0, dy: 0 },
			{ sheet: this.carried, picture: slide?.carried, dx: slide?.dx ?? 0, dy: slide?.dy ?? 0 },
		];
		if (under.element) under.element.hidden = !sets[0]!.picture;
		if (over.element) over.element.hidden = !sets[1]!.picture && !sets[2]!.picture;

		/*
		 * What there is to paint, most needed first: a sheet whose picture has just changed, in view
		 * (all of it, now); a hole in the view, with nothing of another zoom standing in; the view at
		 * this zoom, where an older zoom's tiles stand in; and the ring round the view, ahead of the
		 * pan first. Tiles with no ink in them are never made.
		 */
		interface Job {
			sheet: Sheet;
			picture: Picture;
			c: number;
			r: number;
			rank: number;
			order: number;
		}
		const jobs: Job[] = [];
		const ring = this.progressive && !this.zooming ? RING : 0;
		const views = new Map<Sheet, { c0: number; c1: number; r0: number; r1: number }>();
		for (const { sheet, picture, dx, dy } of sets) {
			if (picture !== sheet.shown) {
				sheet.shown = picture;
				this.invalidate(sheet);
			}
			if (!picture || !sheet.element) {
				this.release(sheet, () => true);
				continue;
			}
			const x1 = x - width / 2 / zoom - dx;
			const y1 = y - height / 2 / zoom - dy;
			const x2 = x1 + width / zoom;
			const y2 = y1 + height / zoom;
			const cells = { c0: Math.floor(x1 / size), c1: Math.ceil(x2 / size) - 1, r0: Math.floor(y1 / size), r1: Math.ceil(y2 / size) - 1 };
			views.set(sheet, cells);
			const mx = (x1 + x2) / 2;
			const my = (y1 + y2) / 2;
			for (let r = cells.r0 - ring; r <= cells.r1 + ring; r++) {
				for (let c = cells.c0 - ring; c <= cells.c1 + ring; c++) {
					const tile = sheet.tiles.get(`${level} ${c} ${r}`);
					if (tile?.fresh || !this.inked(sheet, level, c, r)) continue;
					const inView = c >= cells.c0 && c <= cells.c1 && r >= cells.r0 && r <= cells.r1;
					const ox = (c + 0.5) * size - mx;
					const oy = (r + 0.5) * size - my;
					const rank = !inView ? 3 : sheet.urgent || !this.progressive ? 0 : tile || this.covered(sheet, level, c, r) ? 2 : 1;
					const behind = rank === 3 && ox * this.motion.x + oy * this.motion.y <= 0 ? 1e9 : 0;
					jobs.push({ sheet, picture, c, r, rank, order: behind + Math.hypot(ox, oy) });
				}
			}
		}
		jobs.sort((a, b) => a.rank - b.rank || a.order - b.order);
		const started = performance.now();
		let done = 0;
		for (const job of jobs) {
			if (job.rank > 0 && done > 0 && performance.now() - started > (job.rank === 1 ? HOLE_MS : TILE_MS)) break;
			this.paintTile(painter, job.sheet, job.picture, level, job.c, job.r);
			done++;
		}
		const left = jobs.slice(done);

		/*
		 * Let go of tiles no longer wanted: this zoom's once they are more than a tile past the ring,
		 * and another zoom's once this one covers the view, or when they are out of it.
		 */
		for (const { sheet } of sets) {
			sheet.urgent = false;
			const cells = views.get(sheet);
			if (!cells) continue;
			const covering = left.some((job) => job.sheet === sheet && job.rank <= 2);
			const reach = RING + 1;
			const view = { x1: cells.c0 * size, y1: cells.r0 * size, x2: (cells.c1 + 1) * size, y2: (cells.r1 + 1) * size };
			this.release(sheet, (tile) => {
				if (tile.level === level) return tile.c < cells.c0 - reach || tile.c > cells.c1 + reach || tile.r < cells.r0 - reach || tile.r > cells.r1 + reach;
				if (!covering) return true;
				const at = TILE / tile.level;
				return tile.c * at >= view.x2 || (tile.c + 1) * at <= view.x1 || tile.r * at >= view.y2 || (tile.r + 1) * at <= view.y1;
			});
		}
		// Past the cap, the tiles farthest from the view go first.
		const all = sets.flatMap(({ sheet }) => [...sheet.tiles.values()].map((tile) => ({ sheet, tile })));
		if (all.length > MAX_TILES) {
			const away = ({ sheet, tile }: { sheet: Sheet; tile: Tile }) => {
				const cells = views.get(sheet);
				if (!cells || tile.level !== level) return Infinity;
				return Math.max(cells.c0 - tile.c, tile.c - cells.c1, cells.r0 - tile.r, tile.r - cells.r1, 0);
			};
			const drop = new Set(all.sort((a, b) => away(b) - away(a)).slice(0, all.length - MAX_TILES).filter((one) => away(one) > 0).map((one) => one.tile));
			for (const { sheet } of sets) this.release(sheet, (tile) => drop.has(tile));
		}
		if (left.length) this.schedule();
	}

	/**
	 * The scale the tiles are painted at: the camera's, except while a zoom is under way, when the
	 * last one is kept and stretched — up to twice as large, and down to a little smaller, which the
	 * ring round the view still covers. A zoom that goes further starts a generation at its scale, and
	 * a coarser one than that on the way out, so that it lasts; the zoom at rest paints the exact one.
	 */
	private levelFor(scale: number): number {
		const was = this.level;
		let level = was;
		if (was === undefined || !this.zooming || !this.progressive) level = scale;
		else if (scale > was * 2) level = scale;
		else if (scale < was * 0.8) level = scale * 0.75;
		if (level !== was && level !== undefined) {
			this.level = level;
			// Tiles already at this scale, from a zoom that came back to it, go on top of the ones about to be let go of.
			for (const sheet of [this.sheets.under, this.sheets.over, this.carried]) {
				for (const tile of sheet.tiles.values()) if (tile.level === level) sheet.element?.append(tile.element);
			}
		}
		return this.level!;
	}

	/** Whether a cell of a sheet at a scale has anything drawn in it, by the sheet's ink; kept until the picture changes. */
	private inked(sheet: Sheet, level: number, c: number, r: number): boolean {
		const key = `${level} ${c} ${r}`;
		const known = sheet.inked.get(key);
		if (known !== undefined) return known;
		const size = TILE / level;
		const x1 = c * size;
		const y1 = r * size;
		const x2 = x1 + size;
		const y2 = y1 + size;
		const inked = sheet.ink.some((b) => b.x < x2 && b.x + b.w > x1 && b.y < y2 && b.y + b.h > y1);
		if (sheet.inked.size > 20_000) sheet.inked.clear();
		sheet.inked.set(key, inked);
		return inked;
	}

	/** Whether a cell not yet painted at this scale is covered by tiles of another, which stand in for it meanwhile. */
	private covered(sheet: Sheet, level: number, c: number, r: number): boolean {
		const size = TILE / level;
		const x1 = c * size;
		const y1 = r * size;
		const levels = new Set<number>();
		for (const tile of sheet.tiles.values()) if (tile.level !== level) levels.add(tile.level);
		for (const other of levels) {
			const at = TILE / other;
			if (size / at > 8) continue;
			let all = true;
			for (let r2 = Math.floor(y1 / at); all && r2 * at < y1 + size; r2++) {
				for (let c2 = Math.floor(x1 / at); c2 * at < x1 + size; c2++) {
					if (!sheet.tiles.has(`${other} ${c2} ${r2}`) && this.inked(sheet, other, c2, r2)) {
						all = false;
						break;
					}
				}
			}
			if (all) return true;
		}
		return false;
	}

	/**
	 * A sheet's picture has changed: every tile shows the drawing as it was. This zoom's are kept on
	 * screen until each is painted again — those in view in this frame — and another zoom's let go of.
	 */
	private invalidate(sheet: Sheet): void {
		for (const tile of sheet.tiles.values()) tile.fresh = false;
		sheet.inked.clear();
		sheet.urgent = true;
		this.release(sheet, (tile) => tile.level !== this.level);
	}

	/** Take tiles out of a sheet; a few elements are kept to be used again, and the rest let go of their pixels. */
	private release(sheet: Sheet, test: (tile: Tile) => boolean): void {
		for (const [key, tile] of sheet.tiles) {
			if (!test(tile)) continue;
			sheet.tiles.delete(key);
			tile.element.remove();
			if (this.pool.length < POOL) this.pool.push(tile.element);
			else {
				tile.element.width = 0;
				tile.element.height = 0;
			}
		}
	}

	/**
	 * The one surface every tile is painted on (see the top of the file): WebGL on a canvas that is
	 * never on the page, so its pixels can be given away whole; a software one where there is no WebGL.
	 */
	private makePainter(): Painter | null {
		const ck = this.ck!;
		if (typeof OffscreenCanvas !== "undefined") {
			const source = new OffscreenCanvas(BITMAP, BITMAP);
			const surface = ck.MakeWebGLCanvasSurface(source) ?? ck.MakeSWCanvasSurface(new OffscreenCanvas(BITMAP, BITMAP));
			if (surface) return { surface, source, transfer: typeof source.transferToImageBitmap === "function" };
		}
		const source = document.createElement("canvas");
		source.width = BITMAP;
		source.height = BITMAP;
		const surface = ck.MakeWebGLCanvasSurface(source) ?? ck.MakeSWCanvasSurface(source);
		return surface ? { surface, source, transfer: false } : null;
	}

	/** Paint one tile of a sheet: a new one placed in stage units where it goes, or a stale one again. */
	private paintTile(painter: Painter, sheet: Sheet, picture: Picture, level: number, c: number, r: number): void {
		const ck = this.ck!;
		const key = `${level} ${c} ${r}`;
		let tile = sheet.tiles.get(key);
		if (!tile) {
			let element = this.pool.pop();
			if (!element) {
				element = document.createElement("canvas");
				element.width = BITMAP;
				element.height = BITMAP;
			}
			/*
			 * Sized in its own pixels and scaled down by the transform, never sized in stage units: the
			 * browser gives a layer whole-number bounds in its own units, and a tile 106.43 stage units
			 * wide was cut to 106 — a device pixel short of its neighbour at 240%, a line of paper
			 * through the words.
			 */
			const size = TILE / level;
			element.style.width = `${BITMAP}px`;
			element.style.height = `${BITMAP}px`;
			element.style.transform = `translate(${c * size}px, ${r * size}px) scale(${1 / level})`;
			// Last in the sheet, so over an older zoom's tiles; what a drag carries is over them all (`canvas.css`).
			sheet.element!.append(element);
			tile = { element, level, c, r, fresh: false };
			sheet.tiles.set(key, tile);
		}
		const canvas = painter.surface.getCanvas();
		canvas.clear(ck.TRANSPARENT);
		canvas.save();
		canvas.translate(-c * TILE, -r * TILE);
		canvas.scale(level, level);
		canvas.drawPicture(picture);
		canvas.restore();
		painter.surface.flush();
		if (painter.transfer) {
			// The surface's pixels, given to the tile as they are: no copy, no read back.
			tile.element.getContext("bitmaprenderer")!.transferFromImageBitmap((painter.source as OffscreenCanvas).transferToImageBitmap());
		} else {
			if (tile.element.width !== BITMAP) {
				tile.element.width = BITMAP;
				tile.element.height = BITMAP;
			}
			const ctx = tile.element.getContext("2d")!;
			ctx.clearRect(0, 0, BITMAP, BITMAP);
			ctx.drawImage(painter.source, 0, 0);
		}
		tile.fresh = true;
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
