import type { Canvas, CanvasKit, GrDirectContext, Image, Paint, SkPicture as Picture, Surface } from "canvaskit-wasm";
import { baseTheme, bendsArrow, estimateText, expand, fitShapes, shapeRadius, indexOf, isArrow, isMarkdown, isMarkdownText, layout, NOTE_PAD, reroute, resolve, walk, textStyleOf, withTheme, type Frame, type PenDocument, type PenNode, type Placed, type MeasureText, type ThemeState, type TextStyle } from "@decks/pen";
import type { Camera } from "@decks/protocol";
import type { Painter, SceneLayout } from "@decks/engine/scene";
import { canvasKit } from "./canvaskit.ts";
import { MONO_FAMILY, PenFonts } from "./fonts.ts";
import { fontNeeds } from "./font-files.ts";
import { encodeCard } from "./card-wire.ts";
import { formulaText, handFormulas } from "./math.ts";
import { inkOps, opsOf, paintRecord } from "./paint-wire.ts";
import { CARD_PALETTE, type MarkdownLayout } from "./markdown-layout.ts";
import { PenIcons } from "./icons.ts";
import { NOTE_RADIUS, paintDocument } from "./paint.ts";
import { boundsOf } from "./bounds.ts";
import { BoxIndex, type Rect } from "../spatial.ts";

/**
 * The stage, drawn: the drawing and the boards' pictures on one sheet, in one order.
 *
 * **One sheet.** Everything drawn goes on one canvas, which sits among the boards and over them
 * (`layer.ts`), in two layers: the boards, then the drawing, ink included, and the stroke still
 * under the pen on top of all of it (`ink`). A board is drawn as one of two things. A board with a
 * live document is a **hole**: the sheet is cleared over it, so the page underneath shows through.
 * Any other board is its **picture**, the server's screenshot of the whole board
 * (`/api/thumb?whole=1`), so a board with no document is still the board rather than a grey tile.
 * Nothing drawn goes under a board: boards are at the back, always.
 *
 * **Anywhere.** Nothing here touches the page: no `document`, no `window`. It runs in a worker
 * (`scene.worker.ts`), so laying out the drawing, recording it and painting every frame is off the
 * page's thread, and the page only swaps a finished bitmap in (`layer.ts`). A browser that cannot
 * paint in a worker runs the same class on the page.
 *
 * **Two ways to paint.** CanvasKit, which is seven megabytes, is loaded only once the drawing has
 * something in it. A stage with only boards on it paints their pictures with the canvas's own 2D
 * context, which costs nothing to load.
 *
 * **Only what is in view.** The drawing is laid out once per change and recorded into one Skia
 * picture per top-level item, in stage coordinates, each filed in a spatial index by what it covers
 * (`spatial.ts`); the boards are filed the same way. A frame asks the two indexes for what touches
 * the sheet and replays only that, in the document's order, so a pan across a stage of five hundred
 * items and a hundred boards costs what the dozen in view cost.
 */

/** A tile's side, in device pixels: a megabyte of pixels each. */
const TILE = 512;
/** Tiles drawn per frame at most, so a change on a big drawing never holds the worker for long. */
const TILES_PER_FRAME = 12;
const TILES_PER_FRAME_MOVING = 4;
/** Tiles asked for at most; the page keeps up to 96 (`MAX_TILES` in `engine-stage.ts`). */
const TILES_HELD = 48;

/** How wide a news board's outline is on screen, in CSS px, when the sheet draws it (`paintNewsGpu`). */
const NEWS_OUTLINE_PX = 1;
/** How strong a news board's outline is: the writer's colour, faded, so it marks the board without framing it in ink. */
const NEWS_OUTLINE_ALPHA = 0.35;

/** What a drawn item may paint past the box it covers — a note's shadow, a thick outside stroke — in stage px. */
const ITEM_REACH = 96;

/** A drag or a resize in progress: moved by `dx dy`, and sized `w h` when resizing. */
export interface PenPreview {
	dx: number;
	dy: number;
	w?: number;
	h?: number;
	/**
	 * A corner radius being dragged.
	 *
	 * Here rather than by sending a changed document each frame, which is what this started as and
	 * what made the gesture flicker: a `doc` message carries the **whole drawing** to the worker, and
	 * doing that sixty times a second is a relayout of everything on the stage per frame. A preview
	 * is a handful of numbers, and the worker already clones the document itself to draw one.
	 */
	radius?: number | null;
	/**
	 * Fields changed on the item, as an `update` op's `set`: a colour being dragged in the panel's
	 * colour picker. `null` takes a field off, as the op does.
	 */
	set?: Record<string, unknown>;
}

/** A board as the sheet draws it: a hole where its document shows, or its picture. */
export interface SceneBoard {
	path: string;
	x: number;
	y: number;
	w: number;
	h: number;
	/** The board has a document showing: the sheet is cleared over it. */
	live: boolean;
	/** Where its picture is, when it is not live: an absolute URL. */
	picture?: string;
	/** Have the picture ready while the board is live, to cover its page the moment it is asked to (`Stage.sleepOnZoom`). */
	ready?: boolean;
	/** The writer's colour, when the board is news (`.news-glow`). */
	news?: string;
	/** Draw the news mark here, as an outline: the board has no page to draw its glow (`Stage.paged`). */
	glow?: boolean;
}

/** A markdown card's links and wide tables, for the page to answer a press with (`layer.ts`). */
export interface CardGeometry {
	id: string;
	order: number;
	box: Frame;
	/** Between the box's edge and the words: a note card's padding, none for a card's own block. */
	pad: number;
	links: MarkdownLayout["links"];
	scrollers: MarkdownLayout["scrollers"];
}

/** A stroke of ink the drawing does not hold yet, as the page shaped it (`strokeShape`), in stage pixels. */
export interface LiveInk {
	id: string;
	/** SVG path data: a filled outline, or a centre line stroked `size` wide. */
	d: string;
	filled: boolean;
	/** A CSS colour, already resolved for the scheme. */
	color: string;
	size: number;
	opacity: number;
}

/** What the page sends. */
export type SceneInput =
	| { type: "doc"; doc: PenDocument | undefined; base: string; seq: number }
	| { type: "boards"; boards: SceneBoard[] }
	| { type: "scheme"; scheme: "light" | "dark" }
	| { type: "view"; width: number; height: number; dpr: number; overscan: number; budget: number; widest: number }
	| { type: "camera"; camera: Camera; moving: boolean }
	| { type: "preview"; moving: Array<[string, PenPreview]> | undefined }
	/** Boards being carried by a drag: drawn into the carried picture, not the sheet (`drawFrame`). */
	| { type: "carry"; boards: string[] }
	| { type: "hide"; ids: string[] }
	| { type: "mute"; ids: string[] }
	/** File items shown live by an element under the sheet: drawn as holes (`paint.ts`, `holes`). */
	| { type: "holes"; ids: string[] }
	| { type: "scroll"; scrolls: Array<[string, number]> }
	/** The ink not yet in the drawing. An empty list with `warm` loads CanvasKit ahead of the first stroke. */
	| { type: "ink"; strokes: LiveInk[]; warm?: boolean }
	/** Draw the drawing as tiles for the page's engine (`canvas/engine-stage.ts`) rather than as a sheet. */
	| { type: "tiles"; on: boolean }
	/** The page let a tile go: draw it again when it is next in view. */
	| { type: "tile-gone"; key: string }
	| { type: "ack" }
	/** Development only: switch parts off to find what a phone dies of, and report what the scene holds. */
	| { type: "debug"; off: string[] }
	| { type: "dispose" };

/** What the scene sends back. */
export type SceneOutput =
	/**
	 * A frame: the bitmap, and the camera and size it was drawn for, so the page places it where it
	 * belongs in the same moment it shows it. No bitmap is a sheet with nothing on it.
	 */
	| {
			type: "frame";
			bitmap: ImageBitmap | undefined;
			camera: Camera;
			width: number;
			height: number;
			/**
			 * What a drag is carrying, drawn on its own at where it was picked up, over the same area as
			 * the sheet: the page slides it with the pointer, with no frame drawn per move. Absent when
			 * nothing is carried. `boards` are the boards drawn in it, whose pages hide while it shows.
			 */
			carried?: { bitmap: ImageBitmap; boards: string[] };
			/** How many of the page's messages the frame was painted after, so the page knows which change it shows (`layer.ts`, `seen`). */
			seen?: number;
			/** Drawn by CanvasKit, with the drawing in it; false while it loads, when only boards are drawn. */
			gpu?: boolean;
			/** Tile mode, mid-drag: the carried picture already on the page stays as it is. */
			keepCarried?: true;
	  }
	/** A new layout of the drawing, after a change, for the page's hit tests. */
	| { type: "layout"; seq: number; placed: Array<[string, Placed]>; bounds: Array<[string, Frame]>; cards: CardGeometry[]; partial?: true }
	/** Which boards the sheet is drawing a picture of, as they change. */
	| { type: "pictured"; paths: string[] }
	/** Development only: what the scene holds, once a second after a `debug` message. */
	| { type: "stats"; stats: Record<string, unknown> }
	/**
	 * In tile mode (`tiles`), one square of the drawing at one zoom level, drawn because it changed or
	 * came into view: `bitmap` is its pixels, or absent for a square with nothing drawn in it.
	 */
	| { type: "tile"; key: string; level: number; x: number; y: number; size: number; bitmap?: ImageBitmap }
	/** In tile mode: the drawing is empty, every tile the page holds can go. */
	| { type: "tiles-clear" }
	/** In tile mode: every tile in view at `level` has been sent, so the page can swap to that level whole. */
	| { type: "tiles-done"; level: number };

/** The C++ layout, once loaded: only with the engine on, so the sheet never fetches it. */
let cppLayout: SceneLayout | undefined;
let cppLoading: Promise<SceneLayout | undefined> | undefined;
function loadCppLayout(): Promise<SceneLayout | undefined> {
	cppLoading ??= import("@decks/engine/scene")
		.then(({ loadScene }) => loadScene())
		.then((scene) => (cppLayout = scene))
		.catch((error: unknown) => {
			console.error(`stage scene: the C++ layout did not load (${String((error as Error)?.message ?? error)}); TypeScript lays out instead`);
			return undefined;
		});
	return cppLoading;
}

/** What the scene needs of where it runs. */
export interface SceneHost {
	post(message: SceneOutput, transfer?: Transferable[]): void;
	/** A canvas to paint into: an `OffscreenCanvas` in a worker. */
	canvas(): OffscreenCanvas | HTMLCanvasElement;
	/** The canvas's pixels as a bitmap, leaving it free for the next frame. */
	snapshot(canvas: OffscreenCanvas | HTMLCanvasElement): ImageBitmap | Promise<ImageBitmap>;
	/** The page's address, for resolving a relative image URL. */
	origin: string;
}

/** One top-level drawn item, recorded on its own so a frame can leave it out when it is off the sheet. */
interface DrawnItem {
	id: string;
	/** CanvasKit's recording of it; none when the engine draws everything (`native`). */
	picture?: Picture;
	/** What it draws, as words, when there is no recording to compare: changed means its tiles are drawn again. */
	sig?: string;
}

/**
 * Picture widths the scene decodes at, in pixels: the smallest that covers the board on screen, and
 * never wider than the picture itself (`natural`). A whole picture is up to twice the board's width
 * (`wholeScale` on the server), so a board zoomed in on stays sharp.
 */
const LEVELS = [96, 192, 384, 720, 1024, 1440, 2048];
/**
 * The smaller copies of a whole picture the server keeps (`SMALL_WIDTHS` in the server's
 * `boards/thumbs.ts`). A board is fetched at the smallest that covers it on screen, and at a larger
 * one only once the camera stops where it needs it: a first look at 400 boards zoomed out had
 * downloaded each one's whole picture, 289 KB on average, 118 MB in all.
 */
const SMALL = [192, 480];

/**
 * Whether a drawing has anything for the sheet to draw. A stage's boards are items of the drawing too
 * (a `browser` item marked `decks.board`), but the sheet paints nothing for them (`paint.ts`): a stage
 * of boards alone has no drawing, so it loads no CanvasKit (134 MB of WebAssembly memory, measured)
 * and paints no sheet of its own.
 */
function drawsAnything(doc: PenDocument | undefined): boolean {
	return !!doc && doc.children.some((child) => !(child.type === "browser" && (child.metadata as { type?: string } | undefined)?.type === "decks.board"));
}

/** The stage area some strokes of ink cover, read from their SVG paths' numbers; undefined for none. */
function inkBounds(strokes: readonly LiveInk[]): Frame | undefined {
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	for (const stroke of strokes) {
		const numbers = (stroke.d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
		const pad = stroke.size + 2;
		for (let i = 0; i + 1 < numbers.length; i += 2) {
			left = Math.min(left, numbers[i]! - pad);
			right = Math.max(right, numbers[i]! + pad);
			top = Math.min(top, numbers[i + 1]! - pad);
			bottom = Math.max(bottom, numbers[i + 1]! + pad);
		}
	}
	return left === Infinity ? undefined : { x: left, y: top, w: right - left, h: bottom - top };
}

/** A picture's width from its header, without decoding it: WebP (the server's whole pictures) or JPEG; undefined for anything else. */
async function pictureWidth(blob: Blob): Promise<number | undefined> {
	const bytes = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
	const tag = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
	if (bytes.length > 30 && tag(0) === "RIFF" && tag(8) === "WEBP") {
		const chunk = tag(12);
		if (chunk === "VP8X") return 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
		if (chunk === "VP8L") return 1 + (bytes[21]! | ((bytes[22]! & 0x3f) << 8));
		if (chunk === "VP8 ") return (bytes[26]! | (bytes[27]! << 8)) & 0x3fff;
		return undefined;
	}
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
	let at = 2;
	while (at + 9 < bytes.length) {
		if (bytes[at] !== 0xff) return undefined;
		const marker = bytes[at + 1]!;
		const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
		// A start-of-frame segment (baseline, progressive and the rest, not the tables between them) holds the size.
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return (bytes[at + 7]! << 8) | bytes[at + 8]!;
		at += 2 + length;
	}
	return undefined;
}
/**
 * Pictures fetched at once. The server renders a missing one two at a time, but most are on its disk
 * already and come back in about 16 ms, so the limit is the browser's six connections to a server.
 */
const FETCHES = 6;
/** How long after a stand-in picture the real one is asked for again, and how many times. */
const STAND_IN_RETRY_MS = 1200;
const STAND_IN_TRIES = 50;
/** How long the camera has to be still before a picture is decoded at a new size. */
const SETTLE_MS = 200;
/**
 * How far a zoom may go, in or out, before the frame on screen is drawn again (`covers`). While a
 * zoom is under way the sheet is drawn this much larger on each side and this much denser, so one
 * frame serves the steps of a pinch either side of it: about 1.75 times the pixels a frame, for a
 * frame every 15% of zoom rather than every step. At rest it is drawn at its own size again.
 */
const ZOOM_BAND = 1.15;
/** How often, at most, a moving camera asks which pictures it needs (`wantPictures`). */
const WANT_EVERY_MS = 100;

interface PictureEntry {
	path: string;
	url: string;
	blob?: Blob;
	/** The picture's own width, from its header: no level is decoded wider. */
	natural?: number;
	/** The width of the copy `blob` is (`SMALL`), or 0 for the whole picture. */
	size?: number;
	/**
	 * The server sent an older picture of the board while it takes the current one
	 * (`X-Decks-Stand-In`): drawn as it is, and asked for again until the real one comes.
	 */
	standIn?: { tries: number; timer?: ReturnType<typeof setTimeout> };
	/** A new picture arrived over one already decoded: decode it again, keeping the old until then. */
	redecode?: boolean;
	fetching?: boolean;
	failed?: boolean;
	/** The decoded picture, and the width it was decoded at. */
	bitmap?: ImageBitmap;
	image?: Image;
	w: number;
	h: number;
	level: number;
	decoding?: number;
	/** The frame this was last drawn in, for choosing what to let go of. */
	used: number;
}

export class StageScene {
	private ck: CanvasKit | undefined;
	private fonts: PenFonts | undefined;
	private starting: Promise<void> | undefined;
	private doc: PenDocument | undefined;
	private docSeq = 0;
	private base = "";
	private scheme: "light" | "dark" = "light";
	private camera: Camera = { x: 0, y: 0, zoom: 1 };
	private cameraMoving = false;
	/** The frame last handed to the page: the camera it was drawn for, what it covers, and how far it may be zoomed into before it blurs. */
	private shown: { camera: Camera; rect: Rect; headroom: number } | undefined;
	/** The camera's zoom has changed since it started moving: frames are drawn with room to zoom (`ZOOM_BAND`). */
	private zooming = false;
	/** The pixel density of the frame being drawn: the screen's, times `ZOOM_BAND` while zooming. */
	private drawDpr = 1;
	/** When a moving camera last asked for pictures (`WANT_EVERY_MS`). */
	private wantedAt = 0;
	/** A picture was decoded since the budget was last checked (`keepToBudget`). */
	private budgetDirty = false;
	private movedAt = 0;
	private view = { width: 0, height: 0, dpr: 1, overscan: 0, budget: 16_000_000, widest: 2048 };
	private boards: SceneBoard[] = [];
	private boardFrames = new Map<string, Frame>();
	private dirty = true;
	/*
	 * Whether the next rebuild has to draw every item again. A gesture's step (`preview`) and a
	 * board moving under an arrow change a few items of a document that is otherwise the one
	 * drawn last: those are drawn again and the rest keep their recordings. Anything else (a new
	 * document, the scheme, a font or a picture arriving, what is hidden) redraws the lot.
	 */
	private allDirty = true;
	/*
	 * The items a resize is changing, while one is: the rest of the sheet is drawn once into `still`
	 * and each step draws that picture and these items over it. With every item on screen, drawing
	 * them all at each step was most of the step, and a resize changes one of them.
	 */
	private sizing: ReadonlySet<string> | undefined;
	private still: { key: string; image: Image } | undefined;
	/** Bumped by everything that can change what the still shows, other than the gesture's own steps. */
	private stillGen = 0;
	/** What the last rebuild previewed, so a step that lets an item go draws it back where it was. */
	private lastMoving: ReadonlyMap<string, PenPreview> | undefined;
	private disposed = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private settle: ReturnType<typeof setTimeout> | undefined;
	/** A frame is with the page and has not been shown yet: the next waits for it. */
	private awaiting = false;
	private emptySent = false;
	/** Something changed since the last frame. An acknowledgement alone draws nothing. */
	private wanted = true;
	private frameNo = 0;

	private items: DrawnItem[] = [];
	private itemIndex: BoxIndex | undefined;
	private boardIndex: BoxIndex | undefined;
	private placed: Map<string, Placed> = new Map();
	private bounds: ReadonlyMap<string, Frame> = new Map();
	private moving: ReadonlyMap<string, PenPreview> | undefined;
	private hidden: ReadonlySet<string> = new Set();
	private muted: ReadonlySet<string> = new Set();
	private holes: ReadonlySet<string> = new Set();
	private scrolls = new Map<string, number>();
	private ink: LiveInk[] = [];
	/** Tile mode (`tiles` message): the drawing goes to the page as tiles, and no sheet is drawn. */
	private tiles = false;
	/** Device pixels per stage pixel the tiles are drawn at, a power of two, held through a zoom. */
	private tileLevel = 0;
	/** The tiles the page holds that show the drawing as it is now. */
	private tileDrawn = new Set<string>();
	/** Stage areas that changed since tiles were last drawn: the tiles over them are drawn again. */
	private tileStale: Frame[] = [];
	/** A canvas of one tile, with its own surface. */
	/** The level the page was last told is whole in view (`tiles-done`). */
	private tilesDoneLevel = 0;
	private tileGpu: { canvas: OffscreenCanvas | HTMLCanvasElement; surface: Surface } | undefined;
	/** Whether the page has been told the tiles are all drawn for what it last sent (`seen`). */
	private tilesSaid = -1;
	private readonly scrollOf = (id: string, index: number): number => this.scrolls.get(`${id}:${index}`) ?? 0;
	/**
	 * A move being dragged: the items it carries, drawn as one picture shifted each step; the items
	 * left where they are are the ones already recorded, minus the carried ones. An item that is not
	 * carried but holds one that is (a child picked out of a group) is recorded again without it.
	 */
	private slide: { key: string; ids: Set<string>; ready?: boolean; carried?: Picture; replaced?: Map<string, Picture | undefined>; sent?: boolean; carriedIds?: string[] } | undefined;
	/** The boards a drag is carrying (`carry`). */
	private carryBoards: ReadonlySet<string> = new Set();
	private painted: { nodes: PenNode[]; doc: PenDocument; placed: Map<string, Placed>; source: PenDocument | undefined } | undefined;
	private readonly images = new Map<string, Image | "loading" | "failed">();
	private readonly icons = new PenIcons(() => this.redraw());

	private readonly entries = new Map<string, PictureEntry>();
	private fetching = 0;
	/** The boards the last frame wanted pictures for, so a fetch that lands can start the next without waiting for a frame. */
	private lastWanted: SceneBoard[] = [];
	private pictured = "";

	/** The two canvases: a 2D one for boards alone, and CanvasKit's once the drawing has anything in it. */
	private flat: { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D } | undefined;
	private gpu: { canvas: OffscreenCanvas | HTMLCanvasElement; gr: GrDirectContext | undefined; surface: Surface | undefined; size: string } | undefined;
	private clearPaint: Paint | undefined;
	private boardPaint: Paint | undefined;

	/** Parts switched off for a debugging run (`debug`), and what the scene reports while one is on. */
	private off = new Set<string>();
	private drawnSince = 0;
	private lastMode = "none";
	private lastSize = "";
	private lastError: string | undefined;
	private statsTimer: ReturnType<typeof setInterval> | undefined;

	constructor(private readonly host: SceneHost) {}

	private stats(): Record<string, unknown> {
		let decoded = 0;
		let decodedPx = 0;
		let blobs = 0;
		let blobBytes = 0;
		let decoding = 0;
		for (const entry of this.entries.values()) {
			if (entry.bitmap || entry.image) {
				decoded++;
				decodedPx += entry.w * entry.h;
			}
			if (entry.blob) {
				blobs++;
				blobBytes += entry.blob.size;
			}
			if (entry.decoding !== undefined) decoding++;
		}
		const heap = (this.ck as unknown as { HEAPU8?: Uint8Array } | undefined)?.HEAPU8?.buffer.byteLength;
		const out = { mode: this.lastMode, sheet: this.lastSize, drawn: this.drawnSince, entries: this.entries.size, decoded, decodedMPx: +(decodedPx / 1e6).toFixed(2), blobs, blobMB: +(blobBytes / 1e6).toFixed(1), decoding, fetching: this.fetching, items: this.items.length, ck: !!this.ck, wasmMB: heap ? Math.round(heap / 1e6) : undefined, fonts: this.fonts?.loaded.map((f) => `${f.url} ${(f.bytes / 1e6).toFixed(1)}MB`), cards: (this.fonts as unknown as { cards?: Map<string, unknown> } | undefined)?.cards?.size, layout: this.layoutBy, words: this.wordsBy, pageMeasures: cppLayout?.last.measured, tiles: { ...this.tilesBy, painter: this.cppPainter === null ? "no webgl2" : this.cppPainter ? "ready" : "not made" }, error: this.lastError };
		this.drawnSince = 0;
		return out;
	}

	/** Messages taken in, counted as the page counts them sent. */
	private seen = 0;

	receive(message: SceneInput): void {
		if (this.disposed) return;
		this.seen++;
		switch (message.type) {
			case "doc": {
				// The server's answer has arrived, so whatever a drag was previewing is now the drawing itself.
				this.moving = undefined;
				this.hidden = new Set();
				this.dropSlide();
				this.doc = message.doc;
				this.docSeq = message.seq;
				this.base = message.base;
				this.dirty = this.allDirty = true;
				if (drawsAnything(message.doc)) void this.start();
				break;
			}
			case "boards": {
				const hadArrows = this.doc && [...walk(this.doc.children)].some((node) => isArrow(node));
				const moved = message.boards.some((b) => {
					const was = this.boardFrames.get(b.path);
					return !was || was.x !== b.x || was.y !== b.y || was.w !== b.w || was.h !== b.h;
				});
				this.boards = message.boards;
				this.boardIndex = new BoxIndex(message.boards);
				this.boardFrames = new Map(message.boards.map((b) => [b.path, { x: b.x, y: b.y, w: b.w, h: b.h }]));
				/*
				 * An arrow may end on a board, and follows it when it moves. Not while a drag's picture is
				 * still out: a drop moves its boards here before the server's answer moves its items, and
				 * laying out then let go of that picture and drew the items from the document as it was,
				 * where the drag began, until the answer came. The answer lays everything out, arrows too.
				 */
				if (hadArrows && moved && !this.slide) this.dirty = true;
				this.forgetGone();
				break;
			}
			case "scheme":
				if (message.scheme === this.scheme) return;
				this.scheme = message.scheme;
				if (this.fonts) this.fonts.scheme = message.scheme;
				this.dirty = this.allDirty = true;
				break;
			case "view":
				this.view = { width: message.width, height: message.height, dpr: message.dpr, overscan: message.overscan, budget: message.budget, widest: message.widest };
				break;
			case "camera":
				if (!message.moving) this.zooming = false;
				else if (message.camera.zoom !== this.camera.zoom) this.zooming = true;
				this.camera = message.camera;
				if (message.moving) this.movedAt = performance.now();
				this.cameraMoving = message.moving;
				this.settleLater();
				// A pan the last frame still covers: the page places that frame under the new camera
				// (`layer.ts`, `present`), so drawing it again would make the same pixels.
				if (message.moving && this.covers(message.camera)) return;
				break;
			case "preview":
				// The same items moved further: the page slides the carried picture, and nothing is drawn.
				if (!this.preview(message.moving ? new Map(message.moving) : undefined)) return;
				break;
			case "carry": {
				const next = new Set(message.boards);
				if (next.size === this.carryBoards.size && [...next].every((path) => this.carryBoards.has(path))) return;
				this.carryBoards = next;
				break;
			}
			case "hide": {
				if (message.ids.length === 0 && this.hidden.size === 0) return;
				this.hidden = new Set(message.ids);
				this.dirty = this.allDirty = true;
				break;
			}
			case "holes": {
				if (message.ids.length === 0 && this.holes.size === 0) return;
				this.holes = new Set(message.ids);
				this.dirty = this.allDirty = true;
				break;
			}
			case "mute": {
				if (message.ids.length === 0 && this.muted.size === 0) return;
				this.muted = new Set(message.ids);
				this.dirty = this.allDirty = true;
				break;
			}
			case "scroll":
				this.scrolls = new Map(message.scrolls);
				this.dirty = this.allDirty = true;
				break;
			case "tiles":
				if (message.on === this.tiles) return;
				this.tiles = message.on;
				this.tileDrawn.clear();
				if (message.on) void loadCppLayout();
				if (this.fonts) this.fonts.keepFiles = message.on;
				// The engine stopped drawing tiles and CanvasKit was never loaded: load it now, fonts and all.
				if (!message.on && this.fonts && !this.ck) {
					this.starting = undefined;
					this.fonts = undefined;
					void this.start();
				}
				break;
			case "tile-gone":
				// A tile the page let go of while it is still wanted is drawn again; others wait to be in view.
				if (this.tileDrawn.delete(message.key) && message.key.startsWith(`${this.tileLevel}:`)) {
					this.wanted = true;
					this.schedule();
				}
				break;
			case "ink":
				if (message.strokes.length === 0 && this.ink.length === 0) {
					if (message.warm) void this.start();
					return;
				}
				if (this.tiles) {
					for (const box of [inkBounds(this.ink), inkBounds(message.strokes)]) if (box) this.tileStale.push(box);
				}
				this.ink = message.strokes;
				if (!this.fonts) void this.start();
				break;
			case "ack":
				this.awaiting = false;
				// Nothing new to draw: the frame the page just showed is still the right one.
				if (!this.wanted) return;
				this.schedule();
				return;
			case "debug":
				this.off = new Set(message.off);
				clearInterval(this.statsTimer);
				this.statsTimer = setInterval(() => this.host.post({ type: "stats", stats: this.stats() }), 1000);
				break;
			case "dispose":
				this.dispose();
				return;
		}
		// Anything but a step of the gesture changes what the still behind it shows.
		if (message.type !== "preview") this.stillGen++;
		this.wanted = true;
		this.schedule();
	}

	/** Draw again: something the scene fetched or decoded has arrived. */
	private again(): void {
		this.stillGen++;
		this.wanted = true;
		this.schedule();
	}

	// --- tiles -------------------------------------------------------------------------------

	/**
	 * Rebuild, and say which parts of the stage changed: every item whose recording is new, where it
	 * was and where it is. A whole rebuild changes every item; a step of a drag, the moved ones.
	 */
	private rebuildMarkingTiles(): void {
		const before = new Map(this.items.map((item) => [item.id, item.picture ?? item.sig]));
		const boundsBefore = this.bounds;
		this.rebuild();
		const after = new Set<string>();
		for (const item of this.items) {
			after.add(item.id);
			if (before.get(item.id) === (item.picture ?? item.sig)) continue;
			const was = boundsBefore.get(item.id);
			const now = this.bounds.get(item.id);
			if (was) this.tileStale.push(was);
			if (now) this.tileStale.push(now);
		}
		for (const id of before.keys()) {
			if (after.has(id)) continue;
			const was = boundsBefore.get(id);
			if (was) this.tileStale.push(was);
		}
	}

	/**
	 * The drawing as tiles: the squares in view (and half a square round them) at the current level,
	 * nearest the middle first, each drawn only if it changed or the page does not hold it. A few per
	 * frame; the rest next frame. When all are drawn the page hears it with a frame that has no sheet.
	 */
	private async drawTiles(): Promise<void> {
		const ck = this.ck;
		if (!drawsAnything(this.doc) && this.ink.length === 0) {
			if (this.tileDrawn.size > 0) {
				this.tileDrawn.clear();
				this.host.post({ type: "tiles-clear" });
			}
			this.sayTilesDrawn();
			return;
		}
		if (!this.fonts || (!ck && !this.native)) return;
		const dpr = this.view.dpr;
		/*
		 * The screen's own scale at rest, so a tile's pixel is a screen pixel and words are as sharp as
		 * the sheet drew them; a power of two was up to 30% under it, and stretched words read mushy.
		 * Rounded only so a camera at rest keeps one key for its tiles.
		 */
		const exact = Math.max(1e-3, this.camera.zoom * dpr);
		/*
		 * While zooming, a power of two at or under the screen's scale: it changes once each time the
		 * zoom halves or doubles, and between those its tiles are scaled rather than drawn again. Held
		 * at the exact scale instead, a zoom out needed more tiles than the window keeps at the first
		 * step, so every step started a new scale and drew every tile again (328 tiles at 22 scales
		 * for one pinch). At rest, the exact scale, so words are as sharp as the sheet drew them.
		 */
		const target = this.zooming ? 2 ** Math.floor(Math.log2(exact)) : Math.round(exact * 1000) / 1000;
		this.tileLevel = target;
		const level = this.tileLevel;
		const size = TILE / level;
		if (this.tileStale.length > 0) {
			const stale = this.tileStale.map((box) => ({ x: box.x - ITEM_REACH, y: box.y - ITEM_REACH, w: box.w + 2 * ITEM_REACH, h: box.h + 2 * ITEM_REACH }));
			this.tileStale = [];
			for (const key of [...this.tileDrawn]) {
				const [l, ix, iy] = key.split(":").map(Number) as [number, number, number];
				const s = TILE / l;
				const tile = { x: ix * s, y: iy * s, w: s, h: s };
				if (stale.some((box) => box.x < tile.x + tile.w && tile.x < box.x + box.w && box.y < tile.y + tile.h && tile.y < box.y + box.h)) this.tileDrawn.delete(key);
			}
		}
		// A drag's lifted items, once per drag, as one picture the page slides with the pointer (`layer.ts`).
		const slide = this.slide?.ready && (this.slide.carried || this.slide.carriedIds?.length) ? this.slide : undefined;
		if (slide && !slide.sent) {
			slide.sent = true;
			const cssW = Math.ceil(this.view.width * (1 + 2 * this.view.overscan));
			const cssH = Math.ceil(this.view.height * (1 + 2 * this.view.overscan));
			this.drawDpr = dpr;
			const only = this.native ? this.paintCarried(cssW, cssH, Math.max(1, Math.round(cssW * dpr)), Math.max(1, Math.round(cssH * dpr))) : this.paintGpu([], this.camera, cssW, cssH, Math.max(1, Math.round(cssW * dpr)), Math.max(1, Math.round(cssH * dpr)), true);
			if (only) {
				this.awaiting = true;
				const bitmap = await this.host.snapshot(only);
				this.awaiting = false;
				if (this.disposed) return bitmap.close();
				this.host.post({ type: "frame", bitmap: undefined, camera: this.camera, width: cssW, height: cssH, seen: this.seen, gpu: true, carried: { bitmap, boards: [] } }, [bitmap]);
			}
		}
		const { x, y, zoom } = this.camera;
		const halfW = this.view.width / zoom / 2 + size / 2;
		const halfH = this.view.height / zoom / 2 + size / 2;
		const wanted: Array<{ ix: number; iy: number; d: number; seen: boolean }> = [];
		const seenW = this.view.width / zoom / 2;
		const seenH = this.view.height / zoom / 2;
		for (let iy = Math.floor((y - halfH) / size); iy <= Math.floor((y + halfH) / size); iy++)
			for (let ix = Math.floor((x - halfW) / size); ix <= Math.floor((x + halfW) / size); ix++) {
				const cx = (ix + 0.5) * size - x;
				const cy = (iy + 0.5) * size - y;
				const seen = Math.abs(cx) < seenW + size / 2 && Math.abs(cy) < seenH + size / 2;
				wanted.push({ ix, iy, d: cx * cx + cy * cy, seen });
			}
		// The tiles the window touches first, nearest the middle first; then the border round it.
		wanted.sort((a, b) => Number(b.seen) - Number(a.seen) || a.d - b.d);
		/*
		 * The border round the window only as far as the page keeps tiles: the furthest would be let go of
		 * as soon as they arrived. Every tile the window touches is drawn, however many: cutting those at
		 * 48 left a large window's corners blank until a pan.
		 */
		const seenCount = wanted.filter((one) => one.seen).length;
		wanted.length = Math.min(wanted.length, Math.max(TILES_HELD, seenCount));
		const limit = this.cameraMoving ? TILES_PER_FRAME_MOVING : TILES_PER_FRAME;
		const ink = inkBounds(this.ink);
		let drawn = 0;
		let more = false;
		this.awaiting = true;
		try {
			for (const { ix, iy } of wanted) {
				const key = `${level}:${ix}:${iy}`;
				if (this.tileDrawn.has(key)) continue;
				// A newer change has arrived: take it first, since it may make these tiles stale anyway.
				if (drawn >= limit || (drawn > 0 && this.wanted)) {
					more = true;
					break;
				}
				const rect = { x: ix * size, y: iy * size, w: size, h: size };
				const reach = { x: rect.x - ITEM_REACH, y: rect.y - ITEM_REACH, w: rect.w + 2 * ITEM_REACH, h: rect.h + 2 * ITEM_REACH };
				const hits = (this.itemIndex?.search(reach) ?? []).sort((a, b) => a - b);
				const inked = !!ink && ink.x < rect.x + rect.w && rect.x < ink.x + ink.w && ink.y < rect.y + rect.h && rect.y < ink.y + ink.h;
				this.tileDrawn.add(key);
				if (hits.length === 0 && !inked) {
					this.host.post({ type: "tile", key, level, x: rect.x, y: rect.y, size });
					continue;
				}
				const bitmap = await this.paintTile(rect, level, hits, inked);
				if (this.disposed) {
					if (bitmap !== "wait") bitmap?.close();
					return;
				}
				/*
				 * Words whose font is still on its way: the tile is left as the page holds it and drawn once the
				 * fonts are in, rather than drawn without its words and drawn again a moment later.
				 */
				if (bitmap === "wait") {
					this.tileDrawn.delete(key);
					this.tilesWaiting = true;
					continue;
				}
				if (!bitmap) continue;
				this.host.post({ type: "tile", key, level, x: rect.x, y: rect.y, size, bitmap }, [bitmap]);
				drawn++;
			}
		} finally {
			this.awaiting = false;
		}
		if (more || this.wanted) {
			this.wanted = true;
			this.schedule();
		} else {
			if (this.tilesDoneLevel !== level || drawn > 0) {
				this.tilesDoneLevel = level;
				this.host.post({ type: "tiles-done", level });
			}
			this.sayTilesDrawn();
		}
	}

	/** One tile: the items over it, recorded once, replayed into a square at the level's scale. */
	/** Font requests not answered yet, and whether a tile is waiting for them (`drawTiles`). */
	private fontsPending = 0;
	private tilesWaiting = false;

	private async paintTile(rect: Frame, level: number, hits: number[], inked = false): Promise<ImageBitmap | undefined | "wait"> {
		// With the engine on, our own painter first (`@decks/engine`, `cpp/paint.cpp`); a tile holding
		// something it does not draw yet, or a pen's ink, is painted by CanvasKit below.
		if (cppLayout && this.cppPainter !== null) {
			if (!this.cppCanvas) {
				this.cppCanvas = this.host.canvas();
				this.cppCanvas.width = TILE;
				this.cppCanvas.height = TILE;
				this.cppPainter = cppLayout.painter(this.cppCanvas) ?? null;
				this.uploadPictures();
			}
			const slide = this.slide?.ready ? this.slide : undefined;
			/*
			 * Left out: what a drag carries on a picture of its own, and what is hidden while a delete is on its
			 * way to the server. The painter draws its whole scene, which still holds a hidden item; drawn here,
			 * the tile kept the item after the server's answer, since by then nothing marked the tile stale.
			 */
			const skip = slide && this.hidden.size > 0 ? new Set([...slide.ids, ...this.hidden]) : (slide?.ids ?? (this.hidden.size > 0 ? this.hidden : undefined));
			const drawn = this.cppPainter?.tile(rect.x, rect.y, rect.w, TILE, { dark: this.scheme === "dark", ...(skip ? { skip } : {}), holes: this.holes, mute: this.muted, scrolls: this.scrolls, ...(inked ? { overlay: inkOps(this.ink, this.doc ?? { version: "2.6", children: [] }, baseTheme(this.doc ?? { version: "2.6", children: [] }, this.scheme)) } : {}) });
			// Without CanvasKit there is nothing to fall back to: the engine's tile is the tile, all it could draw.
			if (this.cppPainter && (drawn || this.native)) {
				this.tilesBy.cpp++;
				if (!drawn && this.cppPainter.why === "words with no font" && this.fontsPending > 0) return "wait";
				if (!drawn) {
					this.tilesBy.short = (this.tilesBy.short ?? 0) + 1;
					const why = this.cppPainter.why || "?";
					(this.tilesBy.shortWhy ??= {})[why] = (this.tilesBy.shortWhy[why] ?? 0) + 1;
				}
				return await this.host.snapshot(this.cppCanvas);
			}
		}
		this.tilesBy.canvaskit++;
		const ck = this.ck!;
		if (!this.tileGpu) {
			const canvas = this.host.canvas();
			canvas.width = TILE;
			canvas.height = TILE;
			const handle = ck.GetWebGLContext(canvas as HTMLCanvasElement, { antialias: 0, preserveDrawingBuffer: 0, alpha: 1, premultipliedAlpha: 1 } as never);
			const gr = handle ? (ck.MakeWebGLContext(handle) ?? undefined) : undefined;
			const surface = (gr ? ck.MakeOnScreenGLSurface(gr, TILE, TILE, ck.ColorSpace.SRGB) : ck.MakeSWCanvasSurface(canvas as HTMLCanvasElement)) ?? undefined;
			if (!surface) return undefined;
			this.tileGpu = { canvas, surface };
		}
		const { canvas: element, surface } = this.tileGpu;
		const canvas = surface.getCanvas();
		canvas.clear(ck.TRANSPARENT);
		canvas.save();
		canvas.scale(level, level);
		canvas.translate(-rect.x, -rect.y);
		const slide = this.slide?.ready ? this.slide : undefined;
		for (const at of hits) {
			const item = this.items[at];
			// What a drag lifts is the carried picture's, not the tiles'.
			if (!item || slide?.ids.has(item.id)) continue;
			const picture = slide?.replaced?.get(item.id) ?? item.picture;
			if (picture) canvas.drawPicture(picture);
		}
		this.paintInkGpu(canvas);
		canvas.restore();
		surface.flush();
		return await this.host.snapshot(element);
	}

	/**
	 * Where every item is: with the engine on, the C++ scene works it out (`@decks/engine/scene`), the
	 * first of the drawing's work to move into the engine; until it has loaded, and with the engine
	 * off, the TypeScript it was ported from. The two agree on every saved stage (`layout-diff.mjs`).
	 */
	private layout(doc: PenDocument, nodes: readonly PenNode[], options: { theme: ThemeState; measure: MeasureText }): Map<string, Placed> {
		if (this.tiles && cppLayout && this.fonts) {
			this.layoutBy = "c++";
			const fonts = this.fonts;
			const scene = cppLayout;
			const decoder = new TextDecoder();
			// The C++ measures plain words itself, with the font files CanvasKit was given, in the order it got them.
			for (const file of fonts.files)
				if (file.bytes) {
					cppLayout.font(file.bytes, file.family);
					file.bytes = undefined;
				}
			// It can only if it has every file: fonts loaded before the engine came on were not kept, and then the page measures.
			const ownWords = fonts.files.length === fonts.loaded.length;
			this.wordsBy = ownWords ? "c++" : "canvaskit";
			// The scene keeps what words measured until this changes: a font or a card's picture arrived, or light and dark swapped.
			const card = (text: string, style: TextStyle, node: PenNode) => {
				const wire = encodeCard(text, style, { chain: (family) => fonts.chain(family), mono: MONO_FAMILY, scheme: fonts.scheme, image: (url) => {
					// The browser's copy, which the painter draws; or CanvasKit's, for its size, while CanvasKit draws.
					const picture = this.picture(url);
					if (picture) return { width: () => picture.width, height: () => picture.height, id: picture.id };
					const image = fonts.images?.(url);
					return image ? { width: () => image.width(), height: () => image.height() } : undefined;
				} }, node.textAlign ?? "left");
				// The formulas the card's words carry, for the scene to measure and draw (`math.ts`).
				handFormulas(decoder.decode(wire.pool), scene);
				return wire;
			};
			const scheme = this.scheme;
			// A text's formulas, as the characters they travel as, handed to the scene before it measures them.
			const words = (text: string) => {
				const shown = formulaText(text);
				handFormulas(shown, scene);
				return shown;
			};
			return cppLayout.layout(doc, nodes, { ...options, measureKey: `${fonts.generation}:${fonts.imageVersion}:${fonts.scheme}:${ownWords}`, ...(ownWords ? { chain: (family: string) => fonts.chain(family), words, card } : {}), paint: (node, theme) => paintRecord(doc, node, theme, scheme, { picture: (url) => this.picture(url) }), ops: (node, theme, box) => opsOf(doc, node, theme, scheme, box, { icon: (library, name, weight) => this.icons.get(library, name, weight) }) });
		}
		this.layoutBy = "typescript";
		return layout(doc, nodes, options);
	}
	/** The C++ painter's canvas and painter, once made; null when it could not be (no WebGL 2 in this worker). */
	private cppCanvas: OffscreenCanvas | HTMLCanvasElement | undefined;
	private cppPainter: Painter | null | undefined;
	/** Tiles painted by each painter, for the diagnostics. */
	private tilesBy: { cpp: number; canvaskit: number; short?: number; shortWhy?: Record<string, number> } = { cpp: 0, canvaskit: 0 };
	/**
	 * The engine draws everything, and CanvasKit is never loaded: tile mode, once the engine's module is
	 * here. The fonts are files for the engine, pictures are the browser's, and a card's links come from
	 * the engine's own layout of it.
	 */
	private get native(): boolean {
		return this.tiles && !this.ck && !this.off.has("native");
	}
	/** Which layout drew the last frame, and what measured its plain words, for the diagnostics. */
	private layoutBy: "c++" | "typescript" = "typescript";
	private wordsBy: "c++" | "canvaskit" = "canvaskit";

	/** The page hears that the tiles show everything it has sent so far, as a frame with no sheet. */
	private sayTilesDrawn(): void {
		if (this.tilesSaid === this.seen) return;
		this.tilesSaid = this.seen;
		this.host.post({ type: "frame", bitmap: undefined, camera: this.camera, width: 0, height: 0, seen: this.seen, gpu: !!this.ck, ...(this.slide?.sent ? { keepCarried: true as const } : {}) });
	}

	// --- the frame ------------------------------------------------------------------------

	private redraw(): void {
		this.dirty = this.allDirty = true;
		this.again();
	}

	private schedule(): void {
		if (this.timer !== undefined || this.awaiting || this.disposed) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			void this.frame();
		}, 0);
	}

	/** Once the camera has been still a moment: the pictures it now needs at a new size. */
	private settleLater(): void {
		clearTimeout(this.settle);
		this.settle = setTimeout(() => {
			this.settle = undefined;
			this.again();
		}, SETTLE_MS);
	}

	private drawingEmpty(): boolean {
		return !drawsAnything(this.doc);
	}

	private async frame(): Promise<void> {
		try {
			await this.drawFrame();
		} catch (error) {
			// Said once a second while debugging; otherwise the next change draws again.
			this.lastError = String((error as Error)?.message ?? error).slice(0, 200);
			this.awaiting = false;
		}
	}

	private async drawFrame(): Promise<void> {
		if (this.disposed || this.awaiting || !this.wanted) return;
		this.wanted = false;
		if (this.dirty) {
			this.dirty = false;
			if (this.tiles) this.rebuildMarkingTiles();
			else this.rebuild();
		}
		if (this.slide && !this.slide.ready) this.recordSlide();
		this.frameNo++;
		const { width, height, overscan } = this.view;
		if (width === 0 || height === 0) return;
		if (this.tiles) {
			await this.drawTiles();
			return;
		}
		// While zooming, larger and denser, so the next steps of the zoom are served by this frame (`covers`).
		const band = this.zooming ? ZOOM_BAND : 1;
		const dpr = this.view.dpr * band;
		this.drawDpr = dpr;
		const cssW = Math.ceil(width * (1 + 2 * overscan) * band);
		const cssH = Math.ceil(height * (1 + 2 * overscan) * band);
		const boards = this.boardsInView(cssW, cssH);
		// A moving camera asks which pictures it needs a few times a second, not every frame; a fetch that lands asks again itself.
		const now = performance.now();
		if (!this.cameraMoving || now - this.wantedAt >= WANT_EVERY_MS) {
			this.wantedAt = now;
			this.wantPictures(this.boardsNear(cssW, cssH));
		}
		const useGpu = !!this.ck && (!this.drawingEmpty() || this.ink.length > 0) && !this.off.has("gpu");
		// A board with no page is drawn here, as its picture or, until that comes, as its paper.
		const anyPicture = boards.some((b) => !b.live);
		this.reportPictured(boards);
		const anyNews = boards.some((b) => b.glow && b.news);
		// Carried boards, with a picture to carry: a board with none keeps its page, which the stage moves.
		const carriedBoards = boards.filter((b) => this.carryBoards.has(b.path) && this.hasPicture(b.path));
		const lifting = (!!this.slide?.ready && !!this.slide.carried) || carriedBoards.length > 0;
		if (!useGpu && !anyPicture && !anyNews && !lifting) {
			// Nothing to draw: the page hides the sheet rather than showing an empty one.
			if (!this.emptySent) {
				this.emptySent = true;
				this.host.post({ type: "frame", bitmap: undefined, camera: this.camera, width: cssW, height: cssH, seen: this.seen });
				this.shown = undefined;
			}
			return;
		}
		this.emptySent = false;
		const camera = this.camera;
		const pxW = Math.max(1, Math.round(cssW * dpr));
		const pxH = Math.max(1, Math.round(cssH * dpr));
		const lifted = new Set(carriedBoards.map((b) => b.path));
		const base = lifted.size ? boards.filter((b) => !lifted.has(b.path)) : boards;
		const canvas = useGpu ? this.paintGpu(base, camera, cssW, cssH, pxW, pxH) : this.paintFlat(base, camera, cssW, cssH, pxW, pxH);
		if (!canvas) return;
		this.drawnSince++;
		this.lastMode = useGpu ? "gpu" : "flat";
		this.lastSize = `${pxW}x${pxH}`;
		this.awaiting = true;
		const covered = this.sheetRect(cssW, cssH);
		const bitmap = await this.host.snapshot(canvas);
		let carried: { bitmap: ImageBitmap; boards: string[] } | undefined;
		if (lifting && !this.disposed) {
			// Drawn as live boards are not: each carried board is its picture, wherever its page is.
			const pictures = carriedBoards.map((b) => ({ ...b, live: false, glow: false, news: undefined }));
			const only = useGpu ? this.paintGpu(pictures, camera, cssW, cssH, pxW, pxH, true) : this.paintFlat(pictures, camera, cssW, cssH, pxW, pxH);
			if (only) carried = { bitmap: await this.host.snapshot(only), boards: [...lifted] };
		}
		if (this.disposed) {
			bitmap.close();
			carried?.bitmap.close();
			return;
		}
		this.host.post({ type: "frame", bitmap, camera, width: cssW, height: cssH, gpu: useGpu, seen: this.seen, ...(carried ? { carried } : {}) }, carried ? [bitmap, carried.bitmap] : [bitmap]);
		this.shown = { camera, rect: covered, headroom: band };
	}

	/**
	 * Whether the frame on screen still serves this camera: nothing changed since, the window inside
	 * it with a margin to spare (half the overscan), so a pan keeps showing drawn pixels while the
	 * next frame is made, and a zoom within the frame's band: no further in than it has pixels for,
	 * and no further out than `ZOOM_BAND`. A frame drawn at rest has no pixels to spare, so the first
	 * step of a zoom draws one that has.
	 */
	private covers(camera: Camera): boolean {
		const shown = this.shown;
		if (!shown || this.dirty || this.slide || this.moving?.size || this.ink.length > 0) return false;
		const ratio = camera.zoom / shown.camera.zoom;
		if (ratio > shown.headroom || ratio < 1 / ZOOM_BAND || (ratio !== 1 && shown.headroom === 1)) return false;
		const { width, height, overscan } = this.view;
		const spare = overscan / 2;
		const w = (width * (1 + 2 * spare)) / camera.zoom;
		const h = (height * (1 + 2 * spare)) / camera.zoom;
		const x = camera.x - w / 2;
		const y = camera.y - h / 2;
		const r = shown.rect;
		return x >= r.x && y >= r.y && x + w <= r.x + r.w && y + h <= r.y + r.h;
	}

	/** What the sheet covers, in stage px. */
	private sheetRect(cssW: number, cssH: number): Rect {
		const { x, y, zoom } = this.camera;
		return { x: x - cssW / 2 / zoom, y: y - cssH / 2 / zoom, w: cssW / zoom, h: cssH / zoom };
	}

	/**
	 * The boards within one sheet of the sheet on every side: their pictures are fetched and decoded
	 * ahead, so a board that comes into view during a zoom-out or a pan has its picture already. Read
	 * only for pictures, where a board coming in had been blank for the fetch and the decode, about
	 * 200 ms; nothing outside the sheet is drawn.
	 */
	private boardsNear(cssW: number, cssH: number): SceneBoard[] {
		const r = this.sheetRect(cssW, cssH);
		return (this.boardIndex?.search({ x: r.x - r.w, y: r.y - r.h, w: r.w * 3, h: r.h * 3 }) ?? []).map((at) => this.boards[at]!);
	}

	/** The boards the sheet covers, in their order: later ones are drawn over earlier ones. */
	private boardsInView(cssW: number, cssH: number): SceneBoard[] {
		return (this.boardIndex?.search(this.sheetRect(cssW, cssH)) ?? []).map((at) => this.boards[at]!);
	}

	private hasPicture(path: string): boolean {
		const entry = this.entries.get(path);
		return !!(entry?.bitmap || entry?.image);
	}

	private reportPictured(boards: SceneBoard[]): void {
		const paths = boards.filter((b) => !b.live && this.hasPicture(b.path)).map((b) => b.path);
		const key = paths.join("|");
		if (key === this.pictured) return;
		this.pictured = key;
		this.host.post({ type: "pictured", paths });
	}

	private paintFlat(boards: SceneBoard[], camera: Camera, cssW: number, cssH: number, pxW: number, pxH: number) {
		this.dropGpuImages();
		if (!this.flat) {
			const canvas = this.host.canvas();
			const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
			if (!ctx) return undefined;
			this.flat = { canvas, ctx };
		}
		const { canvas, ctx } = this.flat;
		if (canvas.width !== pxW || canvas.height !== pxH) {
			canvas.width = pxW;
			canvas.height = pxH;
		} else {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, pxW, pxH);
		}
		const dpr = this.drawDpr;
		const s = dpr * camera.zoom;
		ctx.setTransform(s, 0, 0, s, dpr * (cssW / 2 - camera.x * camera.zoom), dpr * (cssH / 2 - camera.y * camera.zoom));
		ctx.imageSmoothingQuality = "medium";
		const sharp = NOTE_RADIUS * camera.zoom * dpr >= 0.5;
		const paper = CARD_PALETTE[this.scheme].paper;
		for (const board of boards) {
			const entry = board.live ? undefined : this.entries.get(board.path);
			if (!board.live) {
				// As on CanvasKit (`paintBoardsGpu`): paper, the picture cut at the board's foot, a clip only for a corner that shows.
				if (sharp) {
					ctx.save();
					ctx.beginPath();
					if ("roundRect" in ctx) ctx.roundRect(board.x, board.y, board.w, board.h, NOTE_RADIUS);
					else (ctx as CanvasRenderingContext2D).rect(board.x, board.y, board.w, board.h);
					ctx.clip();
				}
				ctx.fillStyle = paper;
				ctx.fillRect(board.x, board.y, board.w, board.h);
				if (entry?.bitmap) {
					const h = (board.w * entry.h) / entry.w;
					const shown = Math.min(h, board.h);
					ctx.drawImage(entry.bitmap, 0, 0, entry.bitmap.width, (entry.bitmap.height * shown) / h, board.x, board.y, board.w, shown);
					entry.used = this.frameNo;
				}
				if (sharp) ctx.restore();
			} else {
				ctx.save();
				ctx.beginPath();
				if ("roundRect" in ctx) ctx.roundRect(board.x, board.y, board.w, board.h, NOTE_RADIUS);
				else (ctx as CanvasRenderingContext2D).rect(board.x, board.y, board.w, board.h);
				ctx.clip();
				ctx.clearRect(board.x - 1, board.y - 1, board.w + 2, board.h + 2);
				ctx.restore();
			}
		}
		// The news mark of each board with no page, as `paintNewsGpu` draws it.
		const width = NEWS_OUTLINE_PX / camera.zoom;
		for (const board of boards) {
			if (!board.glow || !board.news) continue;
			ctx.save();
			ctx.strokeStyle = board.news;
			ctx.globalAlpha = NEWS_OUTLINE_ALPHA;
			ctx.lineWidth = width;
			ctx.beginPath();
			const g = width / 2;
			if ("roundRect" in ctx) ctx.roundRect(board.x - g, board.y - g, board.w + width, board.h + width, NOTE_RADIUS + g);
			else (ctx as CanvasRenderingContext2D).rect(board.x - g, board.y - g, board.w + width, board.h + width);
			ctx.stroke();
			ctx.restore();
		}
		// A 2D canvas is only this scene's for the pictures, and the size matters for a small phone:
		// the other canvas is let go of while this one is in use.
		this.shrinkGpu();
		return canvas;
	}

	/** The sheet on CanvasKit; `carriedOnly` draws just what a drag carries, for the picture the page slides. */
	private paintGpu(boards: SceneBoard[], camera: Camera, cssW: number, cssH: number, pxW: number, pxH: number, carriedOnly = false) {
		const ck = this.ck!;
		this.shrinkFlat();
		if (!this.gpu) {
			const canvas = this.host.canvas();
			canvas.width = pxW;
			canvas.height = pxH;
			const handle = ck.GetWebGLContext(canvas as HTMLCanvasElement, { antialias: 0, preserveDrawingBuffer: 0, alpha: 1, premultipliedAlpha: 1 } as never);
			const gr = handle ? (ck.MakeWebGLContext(handle) ?? undefined) : undefined;
			this.gpu = { canvas, gr, surface: undefined, size: "" };
		}
		const gpu = this.gpu;
		const size = `${pxW}x${pxH}`;
		if (!gpu.surface || gpu.size !== size) {
			gpu.surface?.delete();
			gpu.canvas.width = pxW;
			gpu.canvas.height = pxH;
			gpu.surface = (gpu.gr ? ck.MakeOnScreenGLSurface(gpu.gr, pxW, pxH, ck.ColorSpace.SRGB) : ck.MakeSWCanvasSurface(gpu.canvas as HTMLCanvasElement)) ?? undefined;
			gpu.size = size;
			if (!gpu.surface) return undefined;
		}
		const surface = gpu.surface;
		this.clearPaint ??= (() => {
			const paint = new ck.Paint();
			paint.setBlendMode(ck.BlendMode.Clear);
			paint.setAntiAlias(true);
			return paint;
		})();
		this.boardPaint ??= new ck.Paint();
		const canvas = surface.getCanvas();
		canvas.clear(ck.TRANSPARENT);
		const place = () => {
			canvas.save();
			canvas.scale(this.drawDpr, this.drawDpr);
			canvas.translate(cssW / 2, cssH / 2);
			canvas.scale(camera.zoom, camera.zoom);
			canvas.translate(-camera.x, -camera.y);
		};
		place();
		const slide = this.slide?.ready && this.slide.carried ? this.slide : undefined;
		const sizing = !carriedOnly && !slide && this.sizing?.size ? this.sizing : undefined;
		if (!sizing && this.still) {
			this.still.image.delete();
			this.still = undefined;
		}
		if (sizing) {
			const inView = (this.itemIndex?.search(this.sheetRect(cssW, cssH)) ?? []).map((at) => this.items[at]!);
			const key = `${this.stillGen}|${camera.x},${camera.y},${camera.zoom}|${pxW}x${pxH}|${this.drawDpr}|${[...sizing].sort().join(",")}`;
			if (this.still?.key !== key) {
				this.still?.image.delete();
				this.still = undefined;
				this.paintBoardsGpu(canvas, boards, surface);
				this.paintNewsGpu(canvas, boards.filter((board) => board.glow && board.news), camera.zoom);
				for (const item of inView) if (!sizing.has(item.id) && item.picture) canvas.drawPicture(item.picture);
				canvas.restore();
				const image = surface.makeImageSnapshot();
				if (image) this.still = { key, image };
				place();
			} else {
				canvas.restore();
				canvas.drawImage(this.still.image, 0, 0);
				place();
			}
			// Over the rest while it is being sized, as a moved item is carried over everything.
			for (const item of inView) if (sizing.has(item.id) && item.picture) canvas.drawPicture(item.picture);
			this.paintInkGpu(canvas);
		} else if (carriedOnly) {
			// Carried boards under carried items, as they sit on the sheet.
			this.paintBoardsGpu(canvas, boards, surface);
			if (slide) canvas.drawPicture(slide.carried!);
		} else {
			const inView = (this.itemIndex?.search(this.sheetRect(cssW, cssH)) ?? []).map((at) => this.items[at]!);
			const draw = (item: DrawnItem) => {
				if (slide?.ids.has(item.id)) return;
				const picture = slide?.replaced?.get(item.id) ?? item.picture;
				if (picture) canvas.drawPicture(picture);
			};
			this.paintBoardsGpu(canvas, boards, surface);
			this.paintNewsGpu(canvas, boards.filter((board) => board.glow && board.news), camera.zoom);
			for (const item of inView) draw(item);
			this.paintInkGpu(canvas);
		}
		canvas.restore();
		surface.flush();
		return gpu.canvas;
	}

	private paintBoardsGpu(canvas: Canvas, boards: SceneBoard[], surface: Surface): void {
		const ck = this.ck!;
		const paper = ck.parseColorString(CARD_PALETTE[this.scheme].paper);
		const sharp = NOTE_RADIUS * this.camera.zoom * this.drawDpr >= 0.5;
		for (const board of boards) {
			const rect = ck.LTRBRect(board.x, board.y, board.x + board.w, board.y + board.h);
			const rrect = ck.RRectXY(rect, NOTE_RADIUS, NOTE_RADIUS);
			const entry = board.live ? undefined : this.entries.get(board.path);
			let image = entry?.image;
			if (entry && !image && entry.bitmap) {
				// Onto the GPU once, and the bitmap let go of: one copy of the picture, not two.
				image = (this.gpu?.gr ? surface.makeImageFromTextureSource(entry.bitmap, { width: entry.bitmap.width, height: entry.bitmap.height, alphaType: ck.AlphaType.Premul, colorType: ck.ColorType.RGBA_8888, colorSpace: ck.ColorSpace.SRGB }) : this.imageFromPixels(entry.bitmap)) ?? undefined;
				if (image) {
					entry.image = image;
					entry.bitmap.close();
					delete entry.bitmap;
				}
			}
			if (entry && image) {
				// A corner under half a pixel on screen is a square one: no clip, which is most of a board's cost at 2%.
				const round = sharp;
				if (round) {
					canvas.save();
					canvas.clipRRect(rrect, ck.ClipOp.Intersect, true);
				}
				this.boardPaint!.setColor(paper);
				canvas.drawRect(rect, this.boardPaint!);
				// A picture taller than its board is cut at the board's foot, by its source rather than a clip.
				const h = (board.w * entry.h) / entry.w;
				const shown = Math.min(h, board.h);
				canvas.drawImageRectOptions(image, ck.XYWHRect(0, 0, image.width(), (image.height() * shown) / h), ck.XYWHRect(board.x, board.y, board.w, shown), ck.FilterMode.Linear, ck.MipmapMode.None, null);
				if (round) canvas.restore();
				entry.used = this.frameNo;
			} else if (!board.live) {
				// No picture yet and no page: the board's paper, where its page element used to show through.
				this.boardPaint!.setColor(paper);
				if (sharp) canvas.drawRRect(rrect, this.boardPaint!);
				else canvas.drawRect(rect, this.boardPaint!);
			} else canvas.drawRRect(rrect, this.clearPaint!);
		}
	}

	/**
	 * The news mark of a board with no page (`SceneBoard.glow`): an outline in the writer's colour,
	 * just outside the board's edge and the same width on screen at every zoom. The page draws a
	 * soft glow that breathes; zoomed out, a blurred shadow per board cost a blur each frame and read
	 * as a smudge, and an outline says the same thing.
	 */
	private paintNewsGpu(canvas: Canvas, boards: SceneBoard[], zoom: number): void {
		if (boards.length === 0) return;
		const ck = this.ck!;
		const paint = new ck.Paint();
		paint.setAntiAlias(true);
		paint.setStyle(ck.PaintStyle.Stroke);
		const width = NEWS_OUTLINE_PX / zoom;
		paint.setStrokeWidth(width);
		const g = width / 2;
		for (const board of boards) {
			try {
				const colour = ck.parseColorString(board.news!);
				colour[3] = (colour[3] ?? 1) * NEWS_OUTLINE_ALPHA;
				paint.setColor(colour);
			} catch {
				continue;
			}
			canvas.drawRRect(ck.RRectXY(ck.LTRBRect(board.x - g, board.y - g, board.x + board.w + g, board.y + board.h + g), NOTE_RADIUS + g, NOTE_RADIUS + g), paint);
		}
		paint.delete();
	}

	/**
	 * The ink not yet in the drawing: the stroke under the pen, and a finished one until the stage's
	 * answer draws it as an item. Last, over everything, in stage pixels, as the pen item will be.
	 */
	private paintInkGpu(canvas: Canvas): void {
		if (this.ink.length === 0) return;
		const ck = this.ck!;
		for (const stroke of this.ink) {
			if (!stroke.d) continue;
			const path = ck.Path.MakeFromSVGString(stroke.d);
			if (!path) continue;
			const paint = new ck.Paint();
			paint.setAntiAlias(true);
			try {
				paint.setColor(ck.parseColorString(stroke.color));
			} catch {
				paint.setColor(ck.BLACK);
			}
			paint.setAlphaf(stroke.opacity);
			if (!stroke.filled) {
				paint.setStyle(ck.PaintStyle.Stroke);
				paint.setStrokeWidth(stroke.size);
				paint.setStrokeCap(ck.StrokeCap.Round);
				paint.setStrokeJoin(ck.StrokeJoin.Round);
			}
			canvas.drawPath(path, paint);
			paint.delete();
			path.delete();
		}
	}

	private shrinkFlat(): void {
		if (this.flat && this.flat.canvas.width > 1) {
			this.flat.canvas.width = 1;
			this.flat.canvas.height = 1;
		}
	}

	private shrinkGpu(): void {
		if (this.gpu?.surface) {
			this.gpu.surface.delete();
			this.gpu.surface = undefined;
			this.gpu.size = "";
			this.gpu.canvas.width = 1;
			this.gpu.canvas.height = 1;
		}
	}

	/**
	 * A picture for a software surface, where there is no WebGL to upload a texture to (a worker on
	 * a WebKit build without it): its pixels, read through a 2D canvas. Uploading it as a texture
	 * there threw, which lost every frame with a picture in it and left the boards blank.
	 */
	private imageFromPixels(bitmap: ImageBitmap): Image | null {
		const ck = this.ck!;
		const { width, height } = bitmap;
		const canvas = new OffscreenCanvas(width, height);
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		ctx.drawImage(bitmap, 0, 0);
		const pixels = ctx.getImageData(0, 0, width, height).data;
		return ck.MakeImage({ width, height, alphaType: ck.AlphaType.Unpremul, colorType: ck.ColorType.RGBA_8888, colorSpace: ck.ColorSpace.SRGB }, pixels, width * 4);
	}

	/** Pictures uploaded to the GPU are the GPU's; a 2D frame needs them decoded again. */
	private dropGpuImages(): void {
		for (const entry of this.entries.values()) {
			if (!entry.image) continue;
			entry.image.delete();
			delete entry.image;
			entry.level = 0;
		}
	}

	// --- the boards' pictures ---------------------------------------------------------------

	/** Fetch and decode what the boards on the sheet need, nearest the middle first. */
	private wantPictures(boards: SceneBoard[]): void {
		this.lastWanted = boards;
		const { zoom } = this.camera;
		const still = !this.cameraMoving && performance.now() - this.movedAt >= SETTLE_MS;
		const middle = { x: this.camera.x, y: this.camera.y };
		// Boards showing a picture first, then live boards whose picture is kept ready.
		const wanted = boards.filter((b) => (!b.live || b.ready) && b.picture).sort((a, b) => Number(a.live) - Number(b.live) || Math.hypot(a.x + a.w / 2 - middle.x, a.y + a.h / 2 - middle.y) - Math.hypot(b.x + b.w / 2 - middle.x, b.y + b.h / 2 - middle.y));
		// A phone stops at 1024 (`PICTURE_WIDEST` in `layer.ts`).
		const levels = this.off.has("small") ? LEVELS.slice(0, 2) : LEVELS.filter((one) => one <= this.view.widest);
		// One decode at a time in the `serial` debugging run.
		let busy = this.off.has("serial") && [...this.entries.values()].some((one) => one.decoding !== undefined);
		for (const board of wanted) {
			let entry = this.entries.get(board.path);
			if (!entry || entry.url !== board.picture) {
				this.letGo(entry);
				entry = { path: board.path, url: board.picture!, w: 0, h: 0, level: 0, used: this.frameNo };
				this.entries.set(board.path, entry);
			}
			if (entry.failed) continue;
			const need = board.w * zoom * this.view.dpr;
			const size = SMALL.find((one) => one >= need) ?? 0;
			if (!entry.blob) {
				if (!entry.fetching && this.fetching < (this.off.has("serial") ? 1 : FETCHES)) this.fetchPicture(entry, size);
				continue;
			}
			// A copy too small for the board on screen: a larger one once the camera has stopped, drawing this one until then.
			if (still && !entry.fetching && entry.size !== 0 && entry.size !== undefined && (size === 0 || size > entry.size) && this.fetching < FETCHES) this.fetchPicture(entry, size);
			const most = entry.natural ?? levels[levels.length - 1]!;
			const level = Math.min(levels.find((one) => one >= need) ?? levels[levels.length - 1]!, most);
			const has = entry.bitmap || entry.image ? entry.level : 0;
			// Decoded once as soon as it arrives; at a new size only when the camera has stopped.
			if (entry.decoding === undefined && !busy && (has === 0 || entry.redecode || (still && has !== level))) {
				this.decode(entry, level);
				busy = this.off.has("serial");
			}
		}
		// Only a decode adds pixels, so the budget is only checked after one.
		if (this.budgetDirty) {
			this.budgetDirty = false;
			this.keepToBudget(boards);
		}
	}

	private fetchPicture(entry: PictureEntry, size = entry.size ?? 0): void {
		/*
		 * A picture the page took of a live board as it went to sleep (`shots/adaptors.ts`) is a
		 * `blob:` address of its own, with one size: an address with a size added is no address at
		 * all, and the board was drawn blank after every zoom out from reading distance.
		 */
		if (!/^(https?:|\/)/.test(entry.url)) size = 0;
		entry.fetching = true;
		this.fetching++;
		const url = size ? `${entry.url}${entry.url.includes("?") ? "&" : "?"}w=${size}` : entry.url;
		void fetch(url, { credentials: "same-origin" })
			.then(async (response) => {
				if (!response.ok) throw new Error(String(response.status));
				const standIn = response.headers.get("X-Decks-Stand-In") === "1";
				const blob = await response.blob();
				if (this.disposed || this.entries.get(entry.path) !== entry) return;
				entry.natural = await pictureWidth(blob).catch(() => undefined);
				// A picture no wider than the copy asked for came whole: there is nothing larger to ask for.
				entry.size = size && entry.natural !== undefined && entry.natural < size ? 0 : size;
				if (entry.blob) entry.redecode = true;
				entry.blob = blob;
				if (standIn) this.askAgain(entry);
				else entry.standIn = undefined;
			})
			.catch(() => {
				// A retry that failed keeps the stand-in it has; only a board with nothing to draw has failed.
				if (!entry.blob) entry.failed = true;
				else if (entry.standIn) this.askAgain(entry);
			})
			.finally(() => {
				entry.fetching = false;
				this.fetching--;
				if (this.disposed) return;
				/*
				 * The next fetch, and this picture's decode, start now rather than with the next frame: a frame
				 * of a big sheet takes 150 to 250 ms, and asking only then let 83 pictures arrive four at a
				 * time over 5.7 seconds when the server answered each in 16 ms.
				 */
				this.wantPictures(this.lastWanted);
				this.again();
			});
	}

	private decode(entry: PictureEntry, level: number): void {
		const blob = entry.blob;
		if (!blob) return;
		entry.decoding = level;
		entry.redecode = false;
		void createImageBitmap(blob, { resizeWidth: level, resizeQuality: "high" } as ImageBitmapOptions)
			.then((bitmap) => {
				if (this.disposed || this.entries.get(entry.path) !== entry) {
					bitmap.close();
					return;
				}
				entry.bitmap?.close();
				entry.image?.delete();
				delete entry.image;
				entry.bitmap = bitmap;
				// The picture's own proportions, which say how tall the board is in it.
				entry.w = bitmap.width;
				entry.h = bitmap.height;
				entry.level = level;
				this.budgetDirty = true;
				this.again();
			})
			.catch(() => {
				entry.failed = true;
			})
			.finally(() => {
				delete entry.decoding;
			});
	}

	/** Pixels decoded, in all. Past the budget, what was drawn longest ago goes first. */
	private keepToBudget(onSheet: SceneBoard[]): void {
		const showing = new Set(onSheet.map((b) => b.path));
		const decoded = [...this.entries.entries()].filter(([, e]) => e.bitmap || e.image);
		let total = decoded.reduce((sum, [, e]) => sum + e.w * e.h, 0);
		if (total <= this.view.budget) return;
		decoded.sort((a, b) => Number(showing.has(a[0])) - Number(showing.has(b[0])) || a[1].used - b[1].used);
		for (const [path, entry] of decoded) {
			if (total <= this.view.budget || showing.has(path)) break;
			total -= entry.w * entry.h;
			entry.bitmap?.close();
			delete entry.bitmap;
			entry.image?.delete();
			delete entry.image;
			entry.level = 0;
		}
	}

	/** A stand-in is drawn; the real picture is asked for again a little later, a bounded number of times. */
	private askAgain(entry: PictureEntry): void {
		const tries = (entry.standIn?.tries ?? 0) + 1;
		if (tries > STAND_IN_TRIES) return;
		const timer = setTimeout(() => {
			if (this.disposed || this.entries.get(entry.path) !== entry || entry.fetching) return;
			this.fetchPicture(entry);
		}, STAND_IN_RETRY_MS);
		entry.standIn = { tries, timer };
	}

	private letGo(entry: PictureEntry | undefined): void {
		clearTimeout(entry?.standIn?.timer);
		entry?.bitmap?.close();
		entry?.image?.delete();
	}

	/** Boards that left the stage take their pictures with them. */
	private forgetGone(): void {
		const here = new Set(this.boards.map((b) => b.path));
		for (const [path, entry] of this.entries) {
			if (here.has(path)) continue;
			this.letGo(entry);
			this.entries.delete(path);
		}
	}

	// --- the drawing ------------------------------------------------------------------------

	private start(): Promise<void> {
		// With the engine drawing the tiles, CanvasKit is not loaded at all (unless `native` is switched off, to compare).
		if (this.tiles && !this.off.has("native"))
			this.starting ??= loadCppLayout().then((scene) => {
				if (this.disposed) return;
				if (!scene) {
					// The engine did not load: CanvasKit after all.
					this.starting = undefined;
					this.tiles = false;
					void this.start();
					return;
				}
				this.fonts = new PenFonts();
				this.fonts.keepFiles = true;
				this.fonts.scheme = this.scheme;
				this.redraw();
			});
		this.starting ??= canvasKit().then((ck) => {
			if (this.disposed) return;
			this.ck = ck;
			this.fonts = new PenFonts(ck);
			// With the engine on, the C++ scene is handed every font file too (`layout`).
			this.fonts.keepFiles = this.tiles;
			this.fonts.images = (url) => this.image(url);
			this.fonts.scheme = this.scheme;
			this.redraw();
		});
		return this.starting;
	}

	/**
	 * Draw items moved or resized by a gesture that has not been saved yet.
	 *
	 * A move is cheap on purpose: the first step records the drawing twice, once without the moving
	 * items and once with only them, and the frame draws the second on its own (`carried`), which the
	 * page slides with the pointer: a step after that draws nothing. A resize changes a shape, so it
	 * is laid out and recorded again. Returns whether anything is to be drawn again.
	 */
	private preview(moving: ReadonlyMap<string, PenPreview> | undefined): boolean {
		/*
		 * Slid only when nothing left behind has to change with it: an arrow joined to a carried item
		 * bends at every step, so a move that drags one along is laid out and drawn as a resize is. The
		 * page makes the same choice (`layer.ts`, `preview`), as it slides what the worker carries.
		 */
		const slide = !!moving?.size && [...moving.values()].every((change) => change.w === undefined && change.h === undefined && change.radius === undefined && change.set === undefined) && !(this.doc && bendsArrow(this.doc, new Set(moving.keys())));
		if (slide) {
			const key = [...moving!.keys()].sort().join("|");
			if (this.slide?.key === key) return false;
			this.dropSlide();
			this.slide = { key, ids: new Set(moving!.keys()) };
			return true;
		}
		if (!moving && !this.slide && !this.moving) return false;
		this.dropSlide();
		this.moving = moving;
		this.dirty = true;
		return true;
	}

	private dropSlide(): void {
		if (this.tiles && this.slide?.ready) {
			this.staleSlide(this.slide);
			// The window-sized surface the carried picture was drawn on is only for the drag.
			this.shrinkGpu();
		}
		this.slide?.carried?.delete();
		for (const picture of this.slide?.replaced?.values() ?? []) picture?.delete();
		this.slide = undefined;
	}

	private dropItems(): void {
		for (const item of this.items) item.picture?.delete();
		this.items = [];
		this.itemIndex = undefined;
	}

	private paintContext(doc: PenDocument, placed: Map<string, Placed>) {
		return { ck: this.ck!, fonts: this.fonts!, doc, placed, scheme: this.scheme, image: (url: string) => this.image(url), icon: (library: string, name: string, weight: number) => this.icons.get(library, name, weight), scroll: this.scrollOf };
	}

	private record(paint: (canvas: Canvas) => void): Picture {
		const ck = this.ck!;
		const recorder = new ck.PictureRecorder();
		paint(recorder.beginRecording(ck.LTRBRect(-1e7, -1e7, 1e7, 1e7)));
		const picture = recorder.finishRecordingAsPicture();
		recorder.delete();
		return picture;
	}

	private recordSlide(): void {
		const { ck, fonts, slide, painted } = this;
		if (this.native && fonts && slide && painted) {
			// Nothing recorded: the items holding what is lifted are only marked, so their tiles are drawn
			// again without it, and the engine draws what is lifted when it is sent (`paintCarried`).
			slide.replaced = new Map();
			for (const node of painted.nodes) {
				if (slide.ids.has(node.id)) continue;
				for (const inner of walk([node])) if (inner !== node && slide.ids.has(inner.id)) slide.replaced.set(node.id, undefined);
			}
			slide.carriedIds = [...slide.ids].filter((id) => painted.placed.has(id));
			slide.ready = true;
			if (slide.carriedIds.length) slide.carried = undefined;
			this.staleSlide(slide);
			return;
		}
		if (!ck || !fonts || !slide || !painted) return;
		// A live file being carried is carried as its hole: its element goes with the drag under the sheet.
		const ctx = { ...this.paintContext(painted.doc, painted.placed), holes: this.holes };
		slide.replaced = new Map();
		for (const node of painted.nodes) {
			if (slide.ids.has(node.id)) continue;
			let holds = false;
			for (const inner of walk([node])) if (inner !== node && slide.ids.has(inner.id)) holds = true;
			if (holds) slide.replaced.set(node.id, this.record((canvas) => paintDocument(canvas, [node], { ...ctx, skip: slide.ids })));
		}
		slide.ready = true;
		const carried = [...slide.ids].flatMap((id) => {
			const node = painted.placed.get(id)?.node;
			return node ? [node] : [];
		});
		// Carried over everything, so what you are dragging is never hidden under a board.
		slide.carried = this.record((canvas) => paintDocument(canvas, carried, ctx));
		// In tile mode the tiles under what is lifted are drawn again without it.
		if (this.tiles) this.staleSlide(slide);
	}

	/** The tiles over a drag's items and what holds them, drawn again when the drag starts or ends. */
	private staleSlide(slide: { ids: ReadonlySet<string>; replaced?: Map<string, Picture | undefined> }): void {
		for (const id of [...slide.ids, ...(slide.replaced?.keys() ?? [])]) {
			const box = this.bounds.get(id);
			if (box) this.tileStale.push(box);
		}
	}

	/**
	 * Boxes as the page should hold them during a move that is drawn rather than slid (one that bends an
	 * arrow): the carried items where they rest, since the page adds the drag's offset itself, for their
	 * outline and for snapping, as it does when the move is slid. Everything else, the arrows included,
	 * as laid out.
	 */
	private movedBack(): <T extends Frame | Placed>(entries: Array<[string, T]>) => Array<[string, T]> {
		const moving = this.moving;
		const shifts = new Map<string, { dx: number; dy: number }>();
		if (moving && this.doc)
			for (const node of walk(this.doc.children)) {
				const change = moving.get(node.id);
				if (!change || change.w !== undefined || change.h !== undefined || change.radius !== undefined || change.set !== undefined) continue;
				for (const inner of walk([node])) shifts.set(inner.id, { dx: change.dx, dy: change.dy });
			}
		return (entries) =>
			shifts.size === 0
				? entries
				: entries.map(([id, value]) => {
						const by = shifts.get(id);
						if (!by) return [id, value];
						const at = (box: Frame): Frame => ({ ...box, x: box.x - by.dx, y: box.y - by.dy });
						return [id, ("box" in value ? { ...value, box: at(value.box) } : at(value)) as typeof value];
					});
	}

	private sendLayout(cards: CardGeometry[], only?: ReadonlySet<string>): void {
		const back = this.movedBack();
		if (!only) {
			this.host.post({ type: "layout", seq: this.docSeq, placed: back([...this.placed]), bounds: back([...this.bounds]), cards });
			return;
		}
		// A step of a gesture: only the items drawn again, which the page lays over what it has.
		const placed = back([...this.placed].filter(([id]) => only.has(id)));
		const bounds = back([...this.bounds].filter(([id]) => only.has(id)));
		this.host.post({ type: "layout", seq: this.docSeq, placed, bounds, cards, partial: true });
	}

	/**
	 * A copy of `doc` in which the items named, and the items holding them, are new objects, and
	 * every other item is shared with `doc`. The items named are copied whole, since what is done
	 * to them reaches into their children (`fitShapes` redraws a shape's outline); the ones holding
	 * them only get a new list of children. A step of a resize used to copy the whole file, which
	 * on a drawing of 1,500 items was 4 ms a step before anything was drawn.
	 */
	private copyAlong(doc: PenDocument, ids: Iterable<string>): { doc: PenDocument; copies: Map<string, PenNode> } {
		const index = indexOf(doc);
		const root: PenDocument = { ...doc, children: [...doc.children] };
		const made = new Map<PenNode, PenNode>();
		const copies = new Map<string, PenNode>();
		const holder = (parent: PenNode | undefined): PenNode[] => {
			if (!parent) return root.children;
			return (shallow(parent).children ??= []);
		};
		const place = (original: PenNode, copy: PenNode) => {
			made.set(original, copy);
			const list = holder(index.get(original.id)?.parent);
			const at = list.indexOf(original);
			if (at !== -1) list[at] = copy;
		};
		const shallow = (node: PenNode): PenNode => {
			const known = made.get(node);
			if (known) return known;
			const copy: PenNode = { ...node, ...(node.children ? { children: [...node.children] } : {}) };
			place(node, copy);
			return copy;
		};
		// Outermost first, so an item inside another is found in its copy rather than copied apart from it.
		const depth = (id: string) => {
			let n = 0;
			for (let up = index.get(id)?.parent; up; up = index.get(up.id)?.parent) n++;
			return n;
		};
		for (const id of [...ids].sort((a, b) => depth(a) - depth(b))) {
			const found = index.get(id);
			if (!found || copies.has(id)) continue;
			// Inside an item already copied whole: its copy is in there, and is the one to change.
			let within: PenNode | undefined;
			for (let up = found.parent; up && !within; up = index.get(up.id)?.parent) within = copies.get(up.id);
			if (within) {
				for (const inner of walk([within])) if (inner.id === id) copies.set(id, inner);
				continue;
			}
			const was = made.get(found.node);
			// Copied whole, from the copy if it was already copied on the way to another.
			const copy = structuredClone(was ?? found.node);
			if (was) {
				const list = holder(found.parent);
				const at = list.indexOf(was);
				if (at !== -1) list[at] = copy;
				made.set(found.node, copy);
			} else place(found.node, copy);
			copies.set(id, copy);
		}
		return { doc: root, copies };
	}

	/**
	 * What an item draws, as words: itself, every box in it, and what about the stage changes how it is
	 * drawn (light or dark, its fonts and pictures, words being typed over, a file shown under it, a
	 * card's tables scrolled). Two equal signatures draw the same tiles.
	 */
	private signature(node: PenNode, placed: Map<string, Placed>, doc: PenDocument): string {
		const boxes: Array<[string, number, number, number, number]> = [];
		const flags: string[] = [];
		for (const inner of walk([node])) {
			const box = placed.get(inner.id)?.box;
			if (box) boxes.push([inner.id, box.x, box.y, box.w, box.h]);
			if (this.muted.has(inner.id)) flags.push(`m${inner.id}`);
			if (this.holes.has(inner.id)) flags.push(`h${inner.id}`);
		}
		for (const [key, offset] of this.scrolls) if (offset && boxes.some(([id]) => key.startsWith(`${id}:`))) flags.push(`${key}=${offset}`);
		void doc;
		return JSON.stringify([node, boxes, flags, this.scheme, this.fonts?.generation, this.fonts?.imageVersion]);
	}

	/** What a drag lifts, drawn by the engine alone over the window, for the page to slide (`carried`). */
	private paintCarried(cssW: number, cssH: number, pxW: number, pxH: number): OffscreenCanvas | HTMLCanvasElement | undefined {
		const ids = this.slide?.carriedIds;
		if (!cppLayout || !this.cppPainter || !this.cppCanvas || !ids?.length) return undefined;
		const rect = this.sheetRect(cssW, cssH);
		this.cppPainter.region(rect.x, rect.y, rect.w, rect.h, pxW, pxH, { dark: this.scheme === "dark", only: new Set(ids), holes: this.holes, mute: this.muted, scrolls: this.scrolls });
		return this.cppCanvas;
	}

	private rebuild(): void {
		/*
		 * Only the items a step changes are drawn again, when nothing else has changed since the last
		 * rebuild: the same document, scheme, fonts and pictures, and a preview or a board's move as
		 * the reason. Recording every item's picture again was three quarters of a resize step, and
		 * grew with the drawing rather than with what was being sized.
		 */
		const partial = !this.allDirty && this.painted !== undefined && this.painted.source === this.doc && this.items.length > 0;
		this.allDirty = false;
		const kept = partial ? new Map<string, Picture | string | undefined>(this.items.map((item) => [item.id, item.picture ?? item.sig])) : undefined;
		const keptPlaced = partial ? this.painted!.placed : undefined;
		if (partial) {
			this.items = [];
			this.itemIndex = undefined;
		} else this.dropItems();
		this.dropSlide();
		const { ck, fonts } = this;
		const source = this.doc;
		let doc = this.doc;
		const lastMoving = this.lastMoving;
		this.lastMoving = this.moving;
		if (!doc || doc.children.length === 0) {
			for (const picture of kept?.values() ?? []) if (typeof picture === "object") picture.delete();
			this.placed = new Map();
			this.bounds = new Map();
			this.painted = undefined;
			this.sendLayout([]);
			return;
		}
		// CanvasKit is still on its way: the layout comes with the first picture.
		if (!fonts || (!ck && !this.native)) {
			for (const picture of kept?.values() ?? []) if (typeof picture === "object") picture.delete();
			return;
		}
		// Without CanvasKit, words the engine does not measure itself are estimated; it measures them all once its fonts are here.
		const measure: MeasureText = this.native ? estimateText : fonts.measure;
		const theme = baseTheme(doc, this.scheme);
		/*
		 * Arrows are routed here as well as on the server: a file written by hand, or a board dragged
		 * a moment ago, has arrows whose geometry the server has not redrawn yet. The copy is only for
		 * drawing; the file is the server's to rewrite.
		 */
		if (this.moving?.size) {
			const { doc: copy, copies } = this.copyAlong(doc, this.moving.keys());
			for (const [id, change] of this.moving) {
				const node = copies.get(id);
				if (!node) continue;
				node.x = (typeof node.x === "number" ? node.x : 0) + change.dx;
				node.y = (typeof node.y === "number" ? node.y : 0) + change.dy;
				if (change.w !== undefined) node.width = change.w;
				if (change.h !== undefined && !(node.type === "text" && node.textGrowth !== "fixed-width-height")) node.height = change.h;
				/*
				 * How round the corners are. A shape from the library keeps it in its own metadata and
				 * has its outline rebuilt from it by `fitShapes` below; pen's rectangle and frame have a
				 * `cornerRadius` of their own.
				 */
				if (change.radius !== undefined) {
					if (shapeRadius(node) === undefined) node.cornerRadius = change.radius === null || change.radius <= 0 ? undefined : change.radius;
					else node.metadata = { type: "", ...node.metadata, radius: Math.max(0, change.radius ?? 0) };
				}
				if (change.w !== undefined && node.type === "text" && (node.textGrowth ?? "auto") === "auto") node.textGrowth = "fixed-width";
				// A field being changed in the properties panel, drawn before it is saved.
				for (const [field, value] of Object.entries(change.set ?? {})) (node as unknown as Record<string, unknown>)[field] = value === null ? undefined : value;
			}
			// A shape being sized draws its outline at the new size, as the saved edit will (`fitShapes`).
			fitShapes({ ...copy, children: [...copies.values()] });
			doc = copy;
		}
		const arrows: string[] = [];
		for (const node of walk(doc.children)) if (isArrow(node)) arrows.push(node.id);
		if (arrows.length > 0) {
			const { doc: copy } = this.copyAlong(doc, arrows);
			if (reroute(copy, this.layout(copy, expand(copy), { theme, measure }), (path) => this.boardFrames.get(path))) doc = copy;
		}
		const nodes = expand(doc);
		/*
		 * The fonts the words need, which a step that only moves, sizes or rounds an item cannot change:
		 * asking meant reading every card's markdown again at every step.
		 */
		const sameWords = partial && [...(this.moving?.values() ?? [])].every((change) => change.set === undefined);
		const generation = fonts.generation;
		if (!sameWords)
			this.fontsPending++;
			void fonts
				.need(fontNeeds(nodes, doc, theme))
				.then((fresh) => {
					// A font landed after this picture was drawn without it: lay out and draw again.
					if (fresh && fonts.generation !== generation && !this.disposed) this.redraw();
				})
				.finally(() => {
					this.fontsPending--;
					// Tiles held back for these fonts are drawn now, with them or, if none came, without.
					if (this.fontsPending === 0 && this.tilesWaiting && !this.disposed) {
						this.tilesWaiting = false;
						this.again();
					}
				});
		const placed = this.layout(doc, nodes, { theme, measure });
		this.placed = placed;
		this.bounds = boundsOf(placed);
		this.painted = { nodes, doc, placed, source };
		const ctx = this.native ? undefined : { ...this.paintContext(doc, placed), skip: this.hidden, mute: this.muted, holes: this.holes };
		/*
		 * Which items a partial rebuild draws again: the ones holding what is or was previewed, the
		 * ones holding an arrow (an end may have moved), and any whose box came out different.
		 */
		const again = new Set<string>();
		const ids = new Set<string>();
		if (partial) {
			const changed = new Set([...(this.moving?.keys() ?? []), ...(lastMoving?.keys() ?? [])]);
			const sameBox = (a: Frame | undefined, b: Frame | undefined) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
			for (const node of nodes) {
				let redo = !kept!.has(node.id) || !sameBox(placed.get(node.id)?.box, keptPlaced!.get(node.id)?.box);
				const inside: string[] = [];
				for (const inner of walk([node])) {
					inside.push(inner.id);
					if (!redo && (changed.has(inner.id) || isArrow(inner))) redo = true;
				}
				if (!redo) continue;
				again.add(node.id);
				for (const id of inside) ids.add(id);
			}
		}
		const covers: Rect[] = [];
		for (const node of nodes) {
			if (this.hidden.has(node.id)) continue;
			const old = kept?.get(node.id);
			if (old && !again.has(node.id)) {
				this.items.push(typeof old === "string" ? { id: node.id, sig: old } : { id: node.id, picture: old });
				kept!.delete(node.id);
			} else if (ctx) this.items.push({ id: node.id, picture: this.record((canvas) => paintDocument(canvas, [node], ctx)) });
			else this.items.push({ id: node.id, sig: this.signature(node, placed, doc) });
			// An item with no box of its own is drawn wherever the sheet is.
			const box = this.bounds.get(node.id) ?? placed.get(node.id)?.box;
			covers.push(box ? { x: box.x - ITEM_REACH, y: box.y - ITEM_REACH, w: box.w + 2 * ITEM_REACH, h: box.h + 2 * ITEM_REACH } : { x: -1e9, y: -1e9, w: 2e9, h: 2e9 });
		}
		for (const picture of kept?.values() ?? []) if (typeof picture === "object") picture.delete();
		this.itemIndex = new BoxIndex(covers);
		// The cards' links and wide tables, laid out as they were drawn, for the page's presses.
		const cards: CardGeometry[] = [];
		for (const one of placed.values()) {
			const { node, box } = one;
			const text = isMarkdownText(node);
			if (!isMarkdown(node) && !text) continue;
			const content = String(resolve(doc, node.content, withTheme(one.theme, node)) ?? "");
			const pad = text ? 0 : NOTE_PAD;
			if (this.native) {
				const laid = cppLayout?.cardGeometry(node.id, box.w - pad * 2);
				cards.push({ id: node.id, order: one.order, box, pad, links: laid?.links ?? [], scrollers: laid?.scrollers ?? [] });
				continue;
			}
			const laid = fonts.markdown(content, textStyleOf(doc, node, one.theme), { width: box.w - pad * 2, align: node.textAlign ?? "left" });
			cards.push({ id: node.id, order: one.order, box, pad, links: laid.links, scrollers: laid.scrollers });
		}
		this.sizing = partial && this.moving?.size ? again : undefined;
		this.sendLayout(cards, partial ? ids : undefined);
	}

	/** An image fill's picture, fetched once; the drawing is redone when it arrives. */
	private image(url: string): Image | undefined {
		const absolute = new URL(url, new URL(this.base || "/", this.host.origin)).href;
		const known = this.images.get(absolute);
		if (known === "loading" || known === "failed") return undefined;
		if (known) return known;
		this.images.set(absolute, "loading");
		void fetch(absolute)
			.then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
			.then(async (bytes) => {
				const image = this.ck?.MakeImageFromEncoded(new Uint8Array(bytes));
				this.images.set(absolute, image ?? "failed");
				// The same picture decoded by the browser, for the engine's painter (`cpp/paint.cpp`).
				if (cppLayout) {
					try {
						const bitmap = await createImageBitmap(new Blob([bytes]));
						this.pictures.set(absolute, { bitmap, width: bitmap.width, height: bitmap.height });
						this.uploadPictures();
					} catch {
						/* a format the browser does not read: CanvasKit's copy, if any, still draws it */
					}
				}
				if (this.fonts) this.fonts.imageVersion++;
				this.redraw();
			})
			.catch(() => this.images.set(absolute, "failed"));
		return undefined;
	}

	/** Pictures decoded by the browser, and their id with the engine's painter once handed to it. */
	private readonly pictures = new Map<string, { bitmap?: ImageBitmap; width: number; height: number; id?: number }>();
	/** A picture's id and size with the painter: undefined until it has arrived (and asks for it). */
	private picture(url: string): { id: number; width: number; height: number } | undefined {
		const absolute = new URL(url, new URL(this.base || "/", this.host.origin)).href;
		const known = this.pictures.get(absolute);
		if (!known) {
			this.image(url);
			return undefined;
		}
		return known.id === undefined ? undefined : { id: known.id, width: known.width, height: known.height };
	}
	/** Hand every decoded picture the painter has not had yet to it, and let go of the bitmap. */
	private uploadPictures(): void {
		if (!this.cppPainter) return;
		let handed = 0;
		for (const picture of this.pictures.values())
			if (picture.id === undefined && picture.bitmap) {
				picture.id = this.cppPainter.image(picture.bitmap, picture.width, picture.height);
				picture.bitmap.close();
				picture.bitmap = undefined;
				handed++;
			}
		// Records sent before the painter had them name no picture: lay out again so they do.
		if (handed && this.fonts) {
			this.fonts.imageVersion++;
			this.redraw();
		}
	}

	dispose(): void {
		this.disposed = true;
		clearTimeout(this.timer);
		clearInterval(this.statsTimer);
		clearTimeout(this.settle);
		this.dropSlide();
		this.dropItems();
		this.still?.image.delete();
		this.still = undefined;
		for (const entry of this.entries.values()) this.letGo(entry);
		this.entries.clear();
		for (const image of this.images.values()) if (typeof image === "object") image.delete();
		this.images.clear();
		this.gpu?.surface?.delete();
		this.clearPaint?.delete();
		this.boardPaint?.delete();
	}
}
