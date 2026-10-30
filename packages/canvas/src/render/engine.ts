import renderWorkerUrl from "./render.worker.ts?worker&url";
/**
 * The stage's engine, on the page: the Rust page engine (`@decks/stage`) and its render worker.
 *
 * The page engine owns a copy of the drawing, kept on the server's revision by its edits
 * (`stage.pen.delta`), and answers what the stage asks of the drawing: where each item is, what is
 * under a point, what a marquee holds, a card's links. Each frame it draws two canvases in the same
 * call that moves the board pages (`frame`): under them, the boards' pictures; over them, the
 * worker's tiles, then what a gesture is moving and the stroke under the pen, drawn fresh.
 *
 * Fonts, pictures, icons and the markdown reader are the app's own, fetched here and handed to both
 * engines once each.
 */
import type { PageEngine } from "@decks/stage";
import { baseTheme, diff, isShape, pathBounds, shapeKind, shapeOutline, shapeRadius, type Frame, type PenDocument, type PenNode, type Placed, type ThemeState } from "@decks/pen";
import type { Camera } from "@decks/protocol";
import { fontFiles, isFallbackFamily, stageFontNeeds, textNeeds, type FontFile, type FontNeed } from "./font-files.ts";
import { iconUrl, parseIcon } from "./icons.ts";
import { pictureAddress } from "../host.ts";
import { Recovery } from "./recovery.ts";
import { snapMove, type Box, type Guide } from "../edit/snap.ts";
import { boundsOf } from "../model/bounds.ts";
import { docIndex, drawnNodes } from "../model/doc-index.ts";
import { BoxIndex, type Rect } from "./spatial.ts";
import { cardReader, mathTypesetter } from "./reader.ts";
import { setStageWords, type Words } from "./measure.ts";
import { GLIDE_MS, glideAt, glideShifts } from "../camera/glide.ts";
import type { CardGeometry, DocEdits, FromWorker, LiveInk, PenPreview, SceneBoard, TileFromWorker, ToWorker } from "./types.ts";
import { detect, type Detected, type StageModule } from "./backends/detect.ts";
import { PICTURES, readGpuClass } from "./device.ts";
import { noticeFor } from "./backends/notice.ts";

/** How far a press reaches a line, in screen pixels: wider for a finger. */
const BAND_PX = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 12 : 8;
/**
 * How long the camera rests before the pictures are held to their budget (`fitPictures`), and a
 * shrunk board near the screen gets its whole picture back (`wantBoardPictures`).
 */
const REST_MS = 250;

/**
 * A board picture compressed for the GPU, as the server sends it (`apps/server/src/boards/astc.ts`):
 * `DKA1`, width, height and the number of sizes, each size's length, then the sizes' ASTC blocks.
 * What `putCompressedPicture` takes: the bytes, and `[at, length, …]` of each size.
 */
export function readCompressed(data: Uint8Array): { data: Uint8Array; width: number; height: number; spans: Uint32Array; bytes: number } | undefined {
	if (data.length < 16 || String.fromCharCode(...data.subarray(0, 4)) !== "DKA1") return undefined;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const width = view.getUint32(4, true);
	const height = view.getUint32(8, true);
	const levels = view.getUint32(12, true);
	const spans = new Uint32Array(levels * 2);
	let at = 16 + 4 * levels;
	for (let n = 0; n < levels; n++) {
		const length = view.getUint32(16 + 4 * n, true);
		spans[n * 2] = at;
		spans[n * 2 + 1] = length;
		at += length;
	}
	if (at > data.length || levels === 0) return undefined;
	return { data, width, height, spans, bytes: at - (16 + 4 * levels) };
}
/** Pictures fetched at once, and a stand-in picture asked for again this often, this many times. */
const FETCHES = 6;
const STAND_IN_RETRY_MS = 1200;
const STAND_IN_TRIES = 50;
/** How long to wait before asking again for a picture that did not load, each time it fails again. */
const PICTURE_RETRY_MS = [2000, 5000, 15000, 30000, 60000];
/** A level whose tiles stop coming before they cover the window is shown anyway this long after the last. */
const SHOW_ANYWAY_MS = 2000;
/** Pictures from the worker that come within this long of the first are laid out for together. */
const PICTURES_BATCH_MS = 16;

/** What the stage last did, for checks and the crash recorder to read: the old sheet's counters, and the engine's. */
/**
 * `shown` counts the page's draws and `tiles` the worker's tiles that reached the page. `sharpAt` is
 * the `performance.now()` of the first draw at rest after a batch from a worker that had every
 * message the page sent it (the drawing, its fonts, pictures) and had nothing left to paint in the
 * window and its margin at the resting scale, with no font still being fetched: the first sharp frame.
 * Measured by `e2e/checks/render-perf.mjs`.
 *
 * `settledAt` is the latest draw after a batch (or the word that there is nothing to paint) from a
 * worker that had every message the page sent, cameras included, with no tile of the window missing
 * or at another scale than the one it has at rest, moving or not, and no font still being fetched:
 * the frame a pan has filled in (`fillAfterPanMs`).
 */
type SheetStats = Record<string, unknown> & { shown?: number; ink?: number; tiles?: number; pixelTiles?: number; sharpAt?: number; settledAt?: number };
const sheetStats = (): SheetStats => ((globalThis as { __decksSheet?: SheetStats }).__decksSheet ??= { shown: 0, tiles: 0 });

const EMPTY = '{"version":"2.14","children":[]}';
/** Board pictures copied to the GPU in one frame (`putPaced`). */
const PICTURES_PER_FRAME = 1;

type Font = { family: string; fallback: boolean; blob: Blob; bytes?: Uint8Array };

/**
 * Whether the worker hands its tiles to the page as their bytes rather than as pictures: under
 * WebKit (Safari, and every browser on iOS and iPadOS), whose copy of a worker's picture into a
 * texture (`copyExternalImageToTexture`) costs the page's thread about 2 ms a 512-pixel tile on an
 * iPad mini 6, against 0.17 ms to write its bytes (`writeTexture`): a pinch's tiles took 180 to 300
 * ms of it. Chromium copies a picture in about 0.04 ms at the median (now and then 12 ms, waiting
 * on the GPU process, which is why tiles are taken in outside the frame's callback: `takeTilesSoon`),
 * and keeps pictures: as bytes, zooming was as smooth (14 to 20 frames of 180 over 9 ms either
 * way), but a fast pan was filled in 17 to 48 ms instead of 7 to 8, every tile waiting for its read
 * back from the worker's device. WebKit is told by its user agent: AppleWebKit without Chrome's,
 * Chromium's or Edge's name (Chrome on a Mac says AppleWebKit too; Chrome on iOS says CriOS, and is
 * WebKit). `globalThis.__decksTilePixels` (true or false), set before the stage opens, says it instead.
 */
export function pixelsFirst(): boolean {
	const forced = (globalThis as { __decksTilePixels?: boolean }).__decksTilePixels;
	if (typeof forced === "boolean") return forced;
	return webKit();
}

/** WebKit (Safari, and every browser on iOS and iPadOS), by its user agent, as `pixelsFirst` tells it. */
function webKit(): boolean {
	const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
	return /AppleWebKit\//.test(agent) && !/(Chrome|Chromium|Edg|HeadlessChrome)\//.test(agent);
}

/**
 * How much of a frame the page spends taking the worker's tiles in (`takeTiles`): this many
 * milliseconds, and under WebKit, whose clock counts whole milliseconds, no more than `bytes` tiles
 * of bytes (about 0.3 ms each on an iPad mini) or `pictures` tiles of pictures (about 2 ms) a frame
 * either; what is left waits for the next frame, the window's tiles first. A pinch's tiles taken in
 * all at once held frames on an iPad mini for 40 to 100 ms. Three tiles of bytes a frame, tried
 * first, made a pinch's tiles take 300 ms to come in where all at once took 65 (WebKit as an iPad
 * mini on a Mac). `globalThis.__decksTileBudget` changes it, for measuring.
 */
const TILE_BUDGET = { ms: 4, bytes: 12, pictures: 2 };
/** A zoom faster than this many doublings a second paints no new level (`zoomRate`), over this window of time; and is painted after this long still. */
const FAST_ZOOM = 1;
const ZOOM_RATE_MS = 100;
const FAST_HOLD_MS = 250;
const tileBudget = (): typeof TILE_BUDGET => ({ ...TILE_BUDGET, ...(globalThis as { __decksTileBudget?: Partial<typeof TILE_BUDGET> }).__decksTileBudget });
/** A tile's place on the stage, `[x, y, side]`, from its key (`scale` is an `f32`'s bits). */
const tileScale = new DataView(new ArrayBuffer(4));
function tileArea(t: { scale: number; x: number; y: number }): [number, number, number] {
	tileScale.setUint32(0, t.scale);
	const side = TILE_SIDE / tileScale.getFloat32(0);
	return [t.x * side, t.y * side, side];
}
const TILE_SIDE = 512;

/** The engine's compiled module, for the worker to start from (`boot`). */
function moduleOf(stage: StageModule): WebAssembly.Module | undefined {
	const module: unknown = stage.engineModule();
	return module instanceof WebAssembly.Module ? module : undefined;
}

/** What the page engine laid out again since it was last asked (`Page::layout_changes`). */
type LayoutChanges = {
	all: boolean;
	/** With `all`: every top-level item, its first paint order and how many items it holds. */
	tops?: Array<[string, number, number]>;
	roots: Array<{ id: string; base: number; items: Array<[string, number, number, number, number, string | null, number, ThemeState]>; cards: RootCard[] }>;
	removed: string[];
	bases: Array<[string, number]>;
};
/** A card as the engine sends it with its top-level item: its place in that item's tree (`i`) rather than its paint order. */
type RootCard = Omit<CardGeometry, "order"> & { i: number };
type RootLaid = { base: number; items: Array<[string, number]>; cards: RootCard[] };

/**
 * The stage's drawing for `Stage.tsx`, with the same calls the CanvasKit sheet had (`canvas/pen/layer.ts`)
 * so the stage chooses between the two by one setting while this one is proved.
 */
/** How much of the window the sheet reaches past it on each side (`drawRect`): room for a scroll before it is drawn again. */
const SHEET_MARGIN = 0.25;

export class StageEngine {
	private page: PageEngine | undefined;
	private worker: Worker | undefined;
	private disposed = false;
	private camera: Camera = { x: 0, y: 0, zoom: 1 };
	private view = { width: 0, height: 0 };
	private scheme: "light" | "dark" = "light";
	private moving = false;
	/** The zoom has changed since the camera started moving: tiles are wanted at the power of two under it (`scaleFor`), not the exact scale. */
	private zooming = false;
	/** The drawing as both engines hold it, and the address its pictures are relative to. */
	private doc: PenDocument | undefined;
	private base = "";
	private over: HTMLCanvasElement | undefined;
	private hits: SVGSVGElement | undefined;
	private hitWindow: Rect | undefined;
	private bandZoom = 0;
	private boardIndex = new BoxIndex([]);
	/** The boards `boardIndex` answers for, in its order: `boards` when it is up to date with them. */
	private indexed: readonly SceneBoard[] = [];
	private boardBoxes = "";
	private size = { w: 0, h: 0 };
	/** The stage rectangle the canvas was last drawn for: the window's, at the camera then. */
	private drawnAt: { x: number; y: number; zoom: number } | undefined;
	private boards: readonly SceneBoard[] = [];
	private boardKey = "";
	private viewState: { hidden: string[]; mute: string[]; holes: string[]; scrolls: Record<string, number>; writer?: { name?: string; color: string } } = { hidden: [], mute: [], holes: [], scrolls: {} };
	private viewKey = "";
	private fontsAsked = new Set<string>();
	/**
	 * Pictures fetched, by key: the address fetched (a board's may carry a size), the board's own
	 * address for it, stand-in retries, and for a board's the copy's width (0: the whole picture).
	 */
	private picturesAsked = new Map<string, { url: string; source: string; tries: number; size?: number; failed?: number }>();
	/** Fonts loaded, kept to give an engine started again after its device was lost. */
	/**
	 * The font files fetched, kept for an engine started again as the file (`blob`); `bytes` until
	 * both engines have them, then handed (transferred, not copied) to the worker.
	 */
	private fonts: Font[] = [];
	private iconsAsked = new Set<string>();
	private fetching = 0;
	private lifted = new Set<string>();
	private sent = 0;
	private shownSeen = 0;
	/** Messages posted to the worker that is running now, and that count when the last one that changes what it paints was posted. */
	private posted = 0;
	private postedContent = 0;
	/** Font files asked for and not yet given to the engines. */
	private fontsPending = 0;
	/** Font files settled, by key: given to the engines, or not to be had. */
	private fontsSettled = new Set<string>();
	/**
	 * Words measured by the page's engine (`measure.ts`), kept as the server keeps them: by the fonts
	 * there were (`wordsGeneration`, counted up as fonts are given), kind, width, style and words.
	 */
	private wordSizes = new Map<string, { w: number; h: number }>();
	private wordsGeneration = 0;
	/**
	 * Words measured as the server measures them: the engine's own fonts once every file the words
	 * need has settled, else nothing (the estimate, `measure.ts`), and the files are sent for.
	 */
	private readonly words: Words = (text, style, maxWidth, markdown, align) => {
		if (!this.page) return undefined;
		const key = JSON.stringify([this.wordsGeneration, markdown, align, Math.round(maxWidth * 10), style, text]);
		const known = this.wordSizes.get(key);
		if (known) return known;
		const files = fontFiles(textNeeds(text, style, markdown));
		if (files.some((file) => !this.fontsSettled.has(file.key))) {
			this.fetchFonts(files);
			return undefined;
		}
		const [w = 0, h = 0] = this.page.measure(text, JSON.stringify(style), maxWidth, markdown, align);
		if (this.wordSizes.size >= 8192) this.wordSizes.delete(this.wordSizes.keys().next().value!);
		const size = { w, h };
		this.wordSizes.set(key, size);
		return size;
	};
	/** A batch came from a worker with nothing left to paint: the next draw at rest is a sharp one (`sharpAt`). */
	private sharpNext = false;
	/** As `sharpNext`, for `settledAt`: the next draw at rest shows the window filled in. */
	private settledNext = false;
	/** A stage engine that could not start: the stage shows these words (`backends/notice.ts`) rather than drawing nothing silently. */
	failed: ((notice: string) => void) | undefined;
	/** After each new layout, so the stage can redraw a selection round what moved. */
	drawn: (() => void) | undefined;
	/** After each frame is on screen. */
	presented: (() => void) | undefined;
	/** The boards drawn as their picture, when that changes. */
	pictured: ((paths: ReadonlySet<string>) => void) | undefined;
	/** The live boards a drag carries as their picture, whose pages wait unseen. */
	carrying: ((paths: ReadonlySet<string>) => void) | undefined;
	private picturedKey = "";
	private carryingKey = "";
	/** The engine's `boardMarks` when `pictured` and `carrying` were last read: read again only when it moves. */
	private marksSeen = -1;

	/** Every item as laid out, by id, with its node; and what each item covers. */
	placed: ReadonlyMap<string, Placed> = new Map<string, Placed>();
	bounds: ReadonlyMap<string, Frame> = new Map<string, Frame>();
	/** The document the layout was made from. */
	drawnDoc: PenDocument | undefined;
	private scrolls = new Map<string, number>();
	private penHit?: CanvasRenderingContext2D;
	/** Not used by this engine: kept so the stage can treat both alike. */
	drewDrawing = true;
	onCarryPending: ((pending: boolean) => void) | undefined;
	/**
	 * Each frame of a drop's glide (`startGlide`): how far each item that glides is still drawn from
	 * where it lands, so the outlines round them ride along; undefined when the glide ends or a new
	 * gesture cancels it.
	 */
	onGlide: ((shifts: ReadonlyMap<string, { dx: number; dy: number }> | undefined) => void) | undefined;

	/**
	 * The canvas, once the stage has made it: among the board pages, after them. The boards'
	 * pictures, the drawing and what a gesture moves are all drawn on it.
	 */
	attachCanvas(canvas: HTMLCanvasElement): void {
		this.over = canvas;
		if (!this.started) {
			this.started = true;
			void this.start(canvas).catch((error: unknown) => this.fail(error));
		}
	}
	private started = false;
	private lastOps = 0;
	/** The graphics API the stage draws with, `"webgpu"` or `"webgl2"`, once open. */
	private backend = "";
	/** The worker's, which it opens the page's first. */
	private workerBackend = "";
	/** The widest and tallest a picture is kept (the device's limit, or 4096): bigger ones are resized. */
	private maxPicture = 4096;
	/**
	 * Board pictures, by this device's GPU (`device.ts`, `readGpuClass`): each board's is fetched at
	 * one width, copied to the GPU once, and drawn at any zoom from the smaller sizes the GPU makes of
	 * it. Big until the adapter has been asked.
	 */
	private pictures = PICTURES.big;
	/** What this browser draws with (`backends/detect.ts`), found once. */
	private detected: Detected | undefined;
	/** Stops watching for the device to be lost. */
	private unwatch: (() => void) | undefined;
	/** The device is gone and nothing is drawn until the engine has started again. */
	private paused = false;
	private restarting = false;
	/** Times the engine started again after its device was lost (WebGPU) or its context (WebGL 2). */
	private restarts = 0;
	/** The pictures put on the page engine, of boards and of fills: for checks. */
	private picturesPut = 0;

	/** Restarts after an engine error, capped (`recovery.ts`). */
	private recovery = new Recovery();

	/**
	 * An error out of an engine: it cannot be trusted to draw again, so both are started again, as
	 * after a lost GPU. The drawing, boards, camera and fonts are held here and given back to them.
	 */
	private recover(error: unknown, where: string): void {
		const message = String((error as Error)?.message ?? error);
		if (this.recovery.note() === "stop") {
			console.error(`stage engine: ${where} failed again (${message}); stopped`);
			this.lose();
			this.fail(new Error(`The stage kept failing (${message}). Reload the page to draw it again.`));
			return;
		}
		console.error(`stage engine: ${where} failed (${message}); starting the engines again`);
		void this.restart();
	}

	private fail(error: unknown): void {
		console.error(`stage engine: ${String((error as Error)?.message ?? error)}`);
		this.failed?.(noticeFor(error));
	}

	private async start(over: HTMLCanvasElement): Promise<void> {
		try {
			await this.open(over);
		} catch (error) {
			// A worker started for an engine that did not come up is let go with it.
			if (!this.page) {
				this.worker?.terminate();
				this.worker = undefined;
			}
			throw error;
		}
	}

	/**
	 * Start both engines, side by side: the worker is made first, so its script loads while the page
	 * finds its backend and compiles the engine; it is then handed the compiled module (`boot`) and
	 * opens its device while the page opens its own, and it makes its engine when the drawing comes
	 * (`init`). Each used to wait for the one before.
	 */
	private async open(over: HTMLCanvasElement): Promise<void> {
		this.prefetchFonts();
		this.worker = startWorker(renderWorkerUrl);
		this.posted = 0;
		this.postedContent = 0;
		this.worker.onmessage = ({ data }: MessageEvent<FromWorker>) => this.receive(data);
		const found = (this.detected ??= await detect());
		const stage = await found.backend.load();
		if (this.disposed) return;
		this.stageModule = stage;
		this.post({ type: "boot", backend: found.backend.name, lowMemory: found.lowMemory, module: moduleOf(stage) });
		this.fitCanvases();
		const gpu = await stage.openStage(over, over.width, over.height, found.backend.name, found.lowMemory);
		this.lowMemory = !!found.lowMemory;
		// Fonts already handed to an engine before (this is a restart) are read from their files again.
		await Promise.all(this.fonts.map(async (font) => (font.bytes ??= new Uint8Array(await font.blob.arrayBuffer()))));
		if (this.disposed) return gpu.free();
		this.backend = gpu.backend();
		this.maxPicture = gpu.maxPictureSize();
		this.pictures = PICTURES[await readGpuClass()];
		if (this.disposed) return gpu.free();
		const doc = this.doc ? JSON.stringify(this.doc) : EMPTY;
		(globalThis as { __decksRust?: unknown }).__decksRust = this;
		const self = this;
		(globalThis as { __decksEngine?: unknown }).__decksEngine = {
			stats: () => ({ tiles: this.page?.tileCount() ?? 0, drawn: [this.lastOps, this.lastOps], engine: "rust", backend: this.backend, workerBackend: this.workerBackend, maxPicture: this.maxPicture, restarts: this.restarts, pictures: this.picturesPut, paused: this.paused }),
			/** The boards a drag carries as their picture, and by how far. */
			get carried() {
				// Live pages carried as their picture, and boards already drawn as pictures that the drag moves.
				const drawn = new Set([...(JSON.parse(self.page?.carrying() ?? "[]") as string[]), ...self.carriedPaths.filter((path) => (JSON.parse(self.page?.pictured() ?? "[]") as string[]).includes(path))]);
				return { paths: drawn, ...self.carriedBy };
			},
		};
		// Made empty and given its readers first, then the drawing: each reader given lays the drawing out again.
		this.page = new stage.PageEngine(EMPTY, this.scheme === "dark", `s${Math.random().toString(36).slice(2, 7)}`);
		this.warmed = false;
		this.page.setGpu(gpu);
		this.page.setMarkdownReader(cardReader(this.scheme));
		this.page.setMath(mathTypesetter());
		if (doc !== EMPTY) this.page.setDocument(doc);
		this.paused = false;
		// Fonts already here go to both engines now; those still coming (asked for before the engine
		// was up, `prefetchFonts`, or by its first layout) the worker waits for before it paints.
		this.giveFonts(this.fonts, false);
		setStageWords(this.words);
		this.needFonts();
		this.post({ type: "init", doc, dark: this.scheme === "dark", backend: this.backend, lowMemory: found.lowMemory, fontsDue: this.fontsPending > 0, docDue: !this.doc, pixels: pixelsFirst() });
		this.postFonts(this.fonts);
		// The camera now, not when the worker says it is ready: a page busy laying out fonts heard that late.
		this.sendCamera();
		this.unwatch = found.backend.watch(over, { lost: () => this.lose(), restored: () => void this.restart(), isLost: () => this.page?.lost() ?? false });
		this.viewKey = "";
		this.sendView();
		this.boardKey = "";
		this.setBoards(this.boards);
		this.laidOut();
		this.draw();
	}

	/**
	 * The device is gone (`backends/webgpu.ts`, `backends/webgl.ts`), or the worker's: nothing more
	 * is drawn, and the engines are let go while their context is lost, so what they free is freed
	 * on nothing. The drawing, the boards, the camera and the fonts stay here for `restart`.
	 */
	private lose(): void {
		if (this.paused) return;
		this.paused = true;
		this.dropTileQueue();
		this.worker?.terminate();
		this.worker = undefined;
		setStageWords(undefined, this.words);
		this.page?.free();
		this.page = undefined;
		this.picturesAsked.clear();
		this.iconsAsked.clear();
		this.lifted.clear();
		this.picturedKey = "";
		this.carryingKey = "";
		this.marksSeen = -1;
		this.drawnAt = undefined;
		this.shown = undefined;
	}

	/** Start both engines again on the same canvas, once its context is back. */
	private async restart(): Promise<void> {
		if (this.disposed || this.restarting || !this.over) return;
		this.lose();
		// The new engine watches its own device (`start`).
		this.unwatch?.();
		this.unwatch = undefined;
		this.restarting = true;
		this.restarts++;
		try {
			await this.start(this.over);
		} catch (error) {
			this.fail(error);
		} finally {
			this.restarting = false;
		}
	}

	/** Tiles from now on as their bytes (`pixelsFirst`), or as pictures: for measures to switch in one page. */
	tilePixels(on: boolean): void {
		this.post({ type: "pixels", on });
	}

	/** How long after a camera change the worker paints one tile a batch (`AFTER_MOVE_MS` in `render.worker.ts`): for measures to switch in one page. */
	afterMove(ms: number): void {
		this.post({ type: "afterMove", ms });
	}

	private post(message: ToWorker, transfer: Transferable[] = []): void {
		if (this.worker) {
			this.worker.postMessage(message, transfer);
			this.posted++;
			if (message.type !== "camera" && message.type !== "dropped") this.postedContent = this.posted;
		}
		this.sent++;
	}

	private receive(message: FromWorker): void {
		if (this.disposed || !this.page) {
			if (message.type === "tiles") for (const t of message.tiles) t.bitmap?.close();
			return;
		}
		switch (message.type) {
			case "tiles":
				// Nothing painted (the worker says it has nothing left for this camera) and nothing waiting: the frame on screen, or the one coming, is filled in.
				if (!message.tiles.length && !this.tileQueue.length) {
					this.settledNext = (message.rest ?? message.left) === 0 && message.got >= this.posted && this.fontsPending === 0;
					if (this.settledNext && !this.dirty) {
						this.settledNext = false;
						sheetStats().settledAt = performance.now();
					}
					break;
				}
				if (message.overview !== undefined) this.overviewScale = message.overview;
				// Taken in at the next frames, a few a frame (`takeTiles`); a tile painted again replaces the one waiting.
				// One of a scale the zoom has left since it was asked for is let go of at once.
				const unwanted: Array<[number, number, number]> = [];
				for (const t of message.tiles) {
					if (!this.wanted(t)) {
						t.bitmap?.close();
						unwanted.push([t.scale, t.x, t.y]);
						continue;
					}
					const key = `${t.scale},${t.x},${t.y}`;
					const i = this.tileQueue.findIndex((q) => q.key === key);
					if (i >= 0) this.tileQueue.splice(i, 1)[0]?.tile.bitmap?.close();
					this.tileQueue.push({ key, tile: t });
				}
				if (unwanted.length) this.post({ type: "dropped", keys: unwanted });
				// What the worker says of the latest batch holds once every tile before it is in.
				this.tileBatch = { left: message.left, rest: message.rest ?? message.left, got: message.got, sent: this.sent };
				this.takeTilesSoon();
				break;
			case "discarded":
				if (this.tileQueue.length) {
					const gone = new Set(message.keys.map(([sc, x, y]) => `${sc},${x},${y}`));
					this.tileQueue = this.tileQueue.filter((q) => !gone.has(q.key) || void q.tile.bitmap?.close());
				}
				this.page.forgetTiles(JSON.stringify(message.keys));
				this.drawSoon();
				break;
			case "landed":
				this.page.landed(JSON.stringify(message.ids));
				for (const id of message.ids) this.lifted.delete(id);
				this.draw();
				break;
			case "wanted":
				this.wantPictures(message.urls);
				break;
			case "picture":
				// Asked for before the engines started again, or for an address since let go: not wanted.
				if (!this.picturesAsked.has(message.url)) {
					message.bitmap.close();
					break;
				}
				try {
					this.page.putPicture(message.url, message.bitmap, message.width, message.height, true);
				} catch (error) {
					message.bitmap.close();
					this.recover(error, `the picture ${message.url}`);
					break;
				}
				this.picturesPut++;
				this.layOutPicturesSoon();
				break;
			case "resync":
				this.post({ type: "doc", doc: this.doc ? JSON.stringify(this.doc) : EMPTY, dark: this.scheme === "dark" });
				break;
			case "error":
				// The worker's engine failed (a tile, a picture): it paints nothing more until both start again.
				this.recover(new Error(message.message), "the render worker");
				break;
			case "failed":
				this.fail(message.message);
				break;
			case "lost":
				// The worker's device went: both start again, so the tiles and the page agree.
				void this.restart();
				break;
			case "ready":
				this.workerBackend = message.backend;
				break;
		}
	}

	/**
	 * The drawing to show: the server's, or a copy with words being typed. What changed from the one
	 * held is applied to both engines in place: `edits` when they are from the drawing held (the
	 * server's delta, a mounted canvas's own edit), else what `diff` finds; edits they cannot apply,
	 * and the drawing goes whole.
	 */
	setDoc(doc: PenDocument | undefined, base: string, edits?: DocEdits): void {
		if (doc === this.doc && base === this.base) return;
		const before = this.doc;
		this.doc = doc;
		this.base = base;
		/*
		 * What a delete hid while it waited is the drawing's business again: the answer has it gone, or,
		 * after an undo, back. The engines are told (below, after the drawing), or they went on hiding a
		 * restored item until the page was loaded again.
		 */
		const unhide = this.viewState.hidden.length > 0;
		this.viewState.hidden = [];
		if (!this.page) {
			this.prefetchFonts();
			return;
		}
		/*
		 * A drawing that arrives ends any preview: whatever a drag was showing is now the drawing itself.
		 * The page applies a preview to its own copy and takes it back after, so it is taken back before
		 * the edits rather than over them. Lifted items stay lifted, drawn where the drawing now has them,
		 * until the stage puts the gesture down.
		 */
		this.page.setPreview("null");
		this.shown = undefined;
		if (!doc) this.whole(undefined);
		else if (!before) this.whole(doc);
		else {
			const changes = edits && edits.from === before ? edits.edits : diff(before, doc);
			if (changes.length) {
				const text = JSON.stringify(changes);
				try {
					this.page.applyEdits(text);
					this.post({ type: "edits", edits: text });
				} catch {
					this.whole(doc);
				}
			}
		}
		if (unhide) this.sendView();
		this.laidOut();
		this.needFonts();
		// A drop that moved things glides them in from where they were let go, from this very frame.
		const gliding = this.settling && this.startGlide();
		if (!gliding) this.draw();
		// A drag of boards alone that was let go: its arrows are now the drawing's own, routed where the boards landed.
		if (this.boardsOnly && !this.carriedCount) this.landBoards();
		else if (this.boardsOnly) this.boardsAnswered = true;
		// A gesture let go: the drawing that answers it is here, so what it lifted goes back into the tiles.
		if (this.settling) {
			this.settling = false;
			this.landing = undefined;
			if (this.lifted.size && !this.boardsOnly) this.post({ type: "drop", ids: [...this.lifted] });
		}
	}

	/**
	 * Where what a drop can move was let go (`settle`), and the glide in hand: each item's shift from
	 * where it lands, and when it began.
	 */
	private landing: ReadonlyMap<string, Frame> | undefined;
	private glide: { shifts: ReadonlyMap<string, { dx: number; dy: number }>; start: number; frame: number } | undefined;

	/**
	 * The drawing that answers a drop is laid out: everything that moved glides from where it was let
	 * go to where it is now (`editor/core/glide.ts`), drawn lifted with a shrinking offset for
	 * `GLIDE_MS`, then put down. Shown before this drawing's first frame, so nothing is drawn where it
	 * lands before it has glided there. False when nothing moved.
	 */
	private startGlide(): boolean {
		const landing = this.landing;
		this.landing = undefined;
		if (!landing || !this.page) return false;
		const shifts = glideShifts(landing, (id) => this.placed.get(id)?.box, (id) => this.placed.get(id)?.parent);
		if (!shifts.size) return false;
		this.settling = false;
		const start = performance.now();
		const first = glideAt(shifts, 0);
		this.showPreview(first);
		this.onGlide?.(first);
		const step = () => {
			const glide = this.glide;
			if (!glide || this.disposed) return;
			const elapsed = performance.now() - glide.start;
			if (elapsed >= GLIDE_MS) {
				this.glide = undefined;
				this.showPreview(undefined);
				this.onGlide?.(undefined);
				return;
			}
			const now = glideAt(glide.shifts, elapsed);
			this.showPreview(now);
			this.onGlide?.(now);
			glide.frame = requestAnimationFrame(step);
		};
		this.glide = { shifts, start, frame: requestAnimationFrame(step) };
		return true;
	}

	/**
	 * A gesture was let go and its edit sent (`Stage.tsx`, `settleGesture`). When the drawing that
	 * answers it arrives, what it lifted is put down: painted back into the worker's tiles, and drawn
	 * here until they come (`landed`). Without this an item stayed lifted after its drop, drawn by
	 * the page every frame and holding the worker to the screen's tiles. A new gesture first cancels it.
	 */
	settle(landing?: ReadonlyMap<string, Frame>): void {
		this.settling = true;
		this.landing = landing;
	}
	private settling = false;


	private whole(doc: PenDocument | undefined): void {
		const text = doc ? JSON.stringify(doc) : EMPTY;
		this.page?.setDocument(text);
		// The fonts its words name are asked for first, so a worker still to paint its first view hears
		// they are coming before it has the drawing, and waits for them rather than paint it twice.
		this.needFonts();
		this.post({ type: "doc", doc: text, dark: this.scheme === "dark" });
	}

	/**
	 * Take in what the page engine laid out again since the last time (`layoutChanges`): each item's box
	 * with its node, what it covers, the cards. Only the top-level items it re-laid are read, so a
	 * drag's step (the arrows it bends) and an edit (what it reached) cost what they changed, not the
	 * canvas. `placed` stays in paint order.
	 *
	 * `quiet` (a drag's step that only moves things, `showPreview`): the click shapes over boards and
	 * the stage's readers of the layout (`drawn`) wait for the gesture's end, since nothing they read
	 * changed but the arrows the drag bends.
	 */
	private laidOut(quiet = false): void {
		if (!this.page) return;
		const doc = this.doc;
		const changes = JSON.parse(this.page.layoutChanges()) as LayoutChanges;
		const nodes = doc ? drawnNodes(doc) : new Map<string, PenNode>();
		const placed = this.placed as Map<string, Placed>;
		const bounds = this.bounds as Map<string, Frame>;
		const forget = (root: RootLaid) => {
			for (const [id] of root.items) {
				placed.delete(id);
				bounds.delete(id);
			}
		};
		if (changes.all) return this.laidOutWhole(changes.tops ?? [], nodes, quiet);
		// Whether the map is still in paint order after the changes: items set again keep their place, new ones go last.
		let inOrder = changes.bases.length === 0;
		let last = -1;
		for (const root of this.laid.values()) last = Math.max(last, root.base);
		for (const id of changes.removed) {
			const root = this.laid.get(id);
			if (!root) continue;
			forget(root);
			this.laid.delete(id);
		}
		for (const [id, base] of changes.bases) {
			const root = this.laid.get(id);
			if (!root) continue;
			root.base = base;
			for (const [item, i] of root.items) {
				const was = placed.get(item);
				if (was) placed.set(item, { ...was, order: base + i + 1 });
			}
		}
		for (const { id, base, items, cards } of changes.roots) {
			const was = this.laid.get(id);
			const subset = new Map<string, Placed>();
			const ids: Array<[string, number]> = [];
			for (const [item, x, y, w, h, parent, i, theme] of items) {
				const node = nodes.get(item);
				if (!node) continue;
				subset.set(item, { node, box: { x, y, w, h }, parent: parent ?? undefined, theme, order: base + i + 1 });
				ids.push([item, i]);
			}
			if (was) {
				const same = was.items.length === ids.length && was.items.every(([item], at) => item === ids[at]![0]);
				if (!same) {
					forget(was);
					inOrder = false;
				}
			} else if (base < last) inOrder = false;
			for (const [item, one] of subset) placed.set(item, one);
			for (const [item, frame] of boundsOf(subset)) bounds.set(item, frame);
			this.laid.set(id, { base, items: ids, cards });
		}
		if (!inOrder) {
			// Put back in paint order: an item came inside a top-level one, or the top level changed order.
			const all = [...placed.values()].sort((a, b) => a.order - b.order);
			placed.clear();
			for (const one of all) placed.set(one.node.id, one);
		}
		if (changes.all || changes.roots.length || changes.removed.length || changes.bases.length) {
			this.cardList = undefined;
			this.placedList = undefined;
			this.placedIndex = undefined;
		}
		this.drawnDoc = doc;
		if (quiet) return;
		this.writeHits();
		this.drawn?.();
	}
	/** Everything laid out again (a new drawing, the scheme, a font): read whole, in one list and one of cards. */
	private laidOutWhole(tops: Array<[string, number, number]>, nodes: Map<string, PenNode>, quiet: boolean): void {
		if (!this.page) return;
		const placed = new Map<string, Placed>();
		this.laid.clear();
		const roots = tops.map(([id, base, count]) => {
			const root: RootLaid = { base, items: [], cards: [] };
			this.laid.set(id, root);
			return { root, end: base + count };
		});
		let at = 0;
		const rootFor = (order: number) => {
			while (at < roots.length && order > roots[at]!.end) at++;
			return roots[at]?.root;
		};
		for (const [id, x, y, w, h, parent, order, theme] of JSON.parse(this.page.layout()) as Array<[string, number, number, number, number, string | null, number, ThemeState]>) {
			const node = nodes.get(id);
			if (!node) continue;
			placed.set(id, { node, box: { x, y, w, h }, parent: parent ?? undefined, theme, order });
			const root = rootFor(order);
			root?.items.push([id, order - root.base - 1]);
		}
		at = 0;
		for (const { order, ...card } of JSON.parse(this.page.cards()) as CardGeometry[]) {
			const root = rootFor(order);
			root?.cards.push({ ...card, i: order - root.base - 1 });
		}
		this.placed = placed;
		this.bounds = boundsOf(placed);
		this.cardList = undefined;
		this.placedList = undefined;
		this.placedIndex = undefined;
		this.drawnDoc = this.doc;
		if (quiet) return;
		this.writeHits();
		this.drawn?.();
	}
	/** Each top-level item as last laid out: its first paint order, its items with their place in it, its cards. */
	private laid = new Map<string, RootLaid>();
	private cardList: CardGeometry[] | undefined;
	/** The markdown cards, in paint order, made from `laid` when first asked for after a change. */
	private cards(): CardGeometry[] {
		if (this.cardList) return this.cardList;
		const list: CardGeometry[] = [];
		for (const root of this.laid.values()) for (const { i, ...card } of root.cards) list.push({ ...card, order: root.base + i + 1 });
		return (this.cardList = list);
	}

	setView(view: { width: number; height: number }): void {
		this.sheet = undefined;
		this.view = view;
		this.fitCanvases();
		this.sendCamera();
		this.writeHits();
		this.draw();
	}

	/**
	 * The canvas the window's size, in device pixels; the engine's
	 * surface follows in `frame`. It is drawn again for every camera, as one cheap draw of the tiles
	 * and pictures as textured quads, and placed over the window wherever the world has moved
	 * (`place`), as the old engine's was: a canvas a margin bigger than the window, slid during a
	 * pan rather than drawn, made the worker paint that margin too (120 tiles at rest, not 50).
	 */
	private fitCanvases(): void {
		const dpr = Math.min(2, devicePixelRatio || 1);
		// The sheet: the window and a margin round it (`drawRect`).
		const cssW = Math.round(this.view.width * (1 + 2 * SHEET_MARGIN));
		const cssH = Math.round(this.view.height * (1 + 2 * SHEET_MARGIN));
		const w = Math.max(1, Math.round(cssW * dpr));
		const h = Math.max(1, Math.round(cssH * dpr));
		if (w === this.size.w && h === this.size.h) return;
		this.size = { w, h };
		this.drawnAt = undefined;
		for (const canvas of [this.over]) {
			if (!canvas) continue;
			canvas.width = w;
			canvas.height = h;
			canvas.style.width = `${cssW}px`;
			canvas.style.height = `${cssH}px`;
		}
	}

	/**
	 * The stage rectangle the canvas covers: the sheet, the window and `SHEET_MARGIN` of it on each
	 * side, placed round the camera and left there while the window stays inside it.
	 *
	 * The stage scrolls (`camera/scroll-area.ts`): a pan is the browser moving the world, and this
	 * canvas with it, on its compositor. So the canvas is not drawn again for each step of a pan, which
	 * would put our code back in every frame; it is drawn round the camera once, with room on each
	 * side, and again only when the window reaches its edge (`setCamera`), the zoom changes, or the
	 * camera rests (`setMoving`), where it is centred again.
	 */
	private drawRect(): { x: number; y: number; zoom: number; width: number; height: number } {
		const width = Math.round(this.view.width * (1 + 2 * SHEET_MARGIN));
		const height = Math.round(this.view.height * (1 + 2 * SHEET_MARGIN));
		if (!this.sheet || this.sheet.zoom !== this.camera.zoom) {
			const zoom = this.camera.zoom;
			this.sheet = { x: this.camera.x - width / 2 / zoom, y: this.camera.y - height / 2 / zoom, zoom };
		}
		return { x: this.sheet.x, y: this.sheet.y, zoom: this.sheet.zoom, width, height };
	}
	/** Where the sheet is (`drawRect`); undefined to place it round the camera at the next draw. */
	private sheet: { x: number; y: number; zoom: number } | undefined;
	/** Whether the window, at the camera now, is still inside the sheet. */
	private windowInSheet(): boolean {
		const at = this.sheet;
		if (!at || at.zoom !== this.camera.zoom || !this.view.width) return false;
		const w = Math.round(this.view.width * (1 + 2 * SHEET_MARGIN)) / at.zoom;
		const h = Math.round(this.view.height * (1 + 2 * SHEET_MARGIN)) / at.zoom;
		const c = this.corner();
		return c.x >= at.x && c.y >= at.y && c.x + this.view.width / at.zoom <= at.x + w && c.y + this.view.height / at.zoom <= at.y + h;
	}

	/**
	 * The canvas sits in the world (`Stage.tsx`), after the board pages, so it is placed in stage
	 * units at the rectangle it was drawn for and scaled by one over the zoom: the world's transform
	 * undone, so it covers exactly the window.
	 */
	private place(): boolean {
		const at = this.drawnAt;
		if (!this.over || !at) return false;
		const transform = `translate(${at.x}px, ${at.y}px) scale(${1 / at.zoom})`;
		// Compared with the one set, not the style's, which the browser writes back rounded.
		if (transform === this.placedAs) return false;
		this.placedAs = transform;
		this.over.style.transform = transform;
		return true;
	}
	private placedAs = "";
	private webKit: boolean | undefined;

	setScheme(scheme: "light" | "dark"): void {
		if (scheme === this.scheme) return;
		this.scheme = scheme;
		if (this.page) {
			// The stage is drawn again in the other scheme: cards' colours, papers, ink.
			this.page.setMarkdownReader(cardReader(scheme));
			this.page.setDark(scheme === "dark");
			this.whole(this.doc);
			this.laidOut();
		}
		this.draw();
	}

	/** In the call that moves the board pages, and drawn there, so the two land in one frame. */
	setCamera(camera: Camera): void {
		// Zooming once the zoom changes while the camera moves, until it rests (`setMoving`): a pan at one zoom keeps the exact scale.
		if (this.moving && camera.zoom !== this.camera.zoom) this.zooming = true;
		this.camera = camera;
		this.fastZoom = this.moving && this.zooming && this.zoomRate(performance.now(), camera.zoom) > FAST_ZOOM && (globalThis as { __decksSkipLevels?: boolean }).__decksSkipLevels !== false;
		clearTimeout(this.fastTimer);
		// Fingers that stop moving but stay down: painted once the zoom has been still a while.
		if (this.fastZoom)
			this.fastTimer = setTimeout(() => {
				this.fastZoom = false;
				this.sendCamera();
			}, FAST_HOLD_MS);
		// A pan inside the sheet: the browser has scrolled it with the world, and there is nothing to draw (`drawRect`).
		if (this.windowInSheet()) {
			this.wantBoardPictures();
		} else {
			this.sheet = undefined;
			this.draw();
			this.sendCamera();
			this.wantBoardPictures();
		}
		// The click shapes follow the window: written again once it leaves the area they cover.
		const w = this.hitWindow;
		if (w && this.placed.size) {
			const seen = this.windowRect(0);
			const drifted = this.bandZoom > 0 && (camera.zoom > this.bandZoom * 1.25 || camera.zoom < this.bandZoom * 0.8);
			if (drifted || seen.x < w.x || seen.y < w.y || seen.x + seen.w > w.x + w.w || seen.y + seen.h > w.y + w.h) this.writeHits();
		}
	}

	setMoving(moving: boolean): void {
		if (moving === this.moving) return;
		this.moving = moving;
		if (!moving) {
			this.zooming = false;
			this.fastZoom = false;
			clearTimeout(this.fastTimer);
		}
		// At rest, the sheet is placed round the camera again, with its margin on every side.
		if (!moving) this.sheet = undefined;
		this.sendCamera();
		if (!moving) {
			this.wantBoardPictures();
			// Drawn again where the camera came to rest, at the tiles' resting scale.
			this.draw();
			// And, a moment later, the pictures held to the budget, after a pan as after a zoom (`fitPictures`).
			this.fitSoon();
		}
	}

	/**
	 * How fast the zoom changes, in doublings a second: its change since the first camera of the
	 * last `ZOOM_RATE_MS`, over the time between them; not known yet, as fast, until they are 16
	 * ms apart (a zoom's first two frames, whose events may come two in a frame). A slow pinch is under one doubling a second, a wheel's or a fast
	 * pinch's several, and while that lasts (`fastZoom`) the worker paints no new level, which
	 * the zoom would leave before the level covered the window (its first frames painted 15 to
	 * 20 tiles of a level a frame): the page shows the levels it holds stretched or shrunk, the
	 * overview under any edge they leave bare, and the current level is painted once the zoom
	 * slows or rests. `__decksSkipLevels = false` paints every level, for measuring.
	 */
	private zoomRate(now: number, zoom: number): number {
		const trail = this.zoomTrail;
		const level = Math.log2(zoom);
		while (trail.length && trail[0]![0] < now - ZOOM_RATE_MS) trail.shift();
		trail.push([now, level]);
		const from = trail[0]!;
		if (now - from[0] < 16) return Infinity;
		return (Math.abs(level - from[1]) * 1000) / (now - from[0]);
	}
	private zoomTrail: Array<[number, number]> = [];
	private fastZoom = false;
	private fastTimer: ReturnType<typeof setTimeout> | undefined;

	/** The stage point at the window's top-left, from the camera's centre. */
	private corner(): { x: number; y: number } {
		return { x: this.camera.x - this.view.width / 2 / this.camera.zoom, y: this.camera.y - this.view.height / 2 / this.camera.zoom };
	}

	private sendCamera(): void {
		if (!this.view.width) return;
		const { x, y, zoom, width, height } = this.drawRect();
		const dpr = Math.min(2, devicePixelRatio || 1);
		/*
		 * While the zoom changes, by any means (fingers, a trackpad, the wheel, keys, a glide), tiles at
		 * half the screen's density: a quarter of the pixels a tile, and the sharp ones once the zoom
		 * rests. A pinch on an iPad mini asked for 35 to 135 tiles, each about 2 ms of the worker's time
		 * and a copy into the page's texture; text is soft only while the zoom moves. A pan at one zoom
		 * keeps the exact scale. `__decksHalfZoom = false` paints them sharp, for measuring.
		 */
		const half = this.zooming && (globalThis as { __decksHalfZoom?: boolean }).__decksHalfZoom !== false;
		const sent = { zoom, dpr: half ? dpr / 2 : dpr, moving: this.moving, zooming: this.zooming, fast: this.fastZoom };
		this.post({ type: "camera", x, y, width, height, ...sent });
		const want = this.stageModule?.scaleFor(sent.zoom * sent.dpr, sent.zooming);
		if (want !== undefined && want !== this.wantScale) {
			this.wantScale = want;
			this.dropUnwanted();
		}
	}
	/** The engine's module, for `scaleFor`. */
	private stageModule: StageModule | undefined;
	/** The scale the worker's latest camera wants its tiles at (`scaleFor`, an `f32`'s bits), and the overview's (`overviewScale`). */
	private wantScale: number | undefined;
	private overviewScale = 0;

	/** Whether a tile is still wanted: at the scale the latest camera wants, or the overview's. Tiles of a scale the zoom has left are not taken in. */
	private wanted(t: { scale: number }): boolean {
		return this.wantScale === undefined || t.scale === this.wantScale || t.scale === this.overviewScale;
	}

	/** Let go of the tiles waiting to be taken in that the latest camera no longer wants, and tell the worker, which paints them again if they are wanted again. */
	private dropUnwanted(): void {
		if (!this.tileQueue.length) return;
		const gone: Array<[number, number, number]> = [];
		this.tileQueue = this.tileQueue.filter((q) => {
			if (this.wanted(q.tile)) return true;
			q.tile.bitmap?.close();
			gone.push([q.tile.scale, q.tile.x, q.tile.y]);
			return false;
		});
		if (gone.length) this.post({ type: "dropped", keys: gone });
	}


	/**
	 * The frame's one draw. Cameras, tiles from the worker and every other change only mark the canvas
	 * to be drawn (`draw`); it is drawn once, in the next animation frame's callback (`tick`), which
	 * runs before the browser paints, so the drawing still lands in the same frame as the board pages
	 * the world's transform moved. A pinch's two fingers move the camera twice a frame, a wheel or a
	 * trackpad may too, and tiles come in bursts: each drew the canvas again (2 draws a frame for a
	 * two-event pinch, 1.2 for a wheel zoom).
	 */
	private dirty = false;
	private tickFrame = 0;
	private tickSoon(): void {
		if (this.tickFrame || this.disposed) return;
		this.tickFrame = requestAnimationFrame(() => this.tick());
	}
	private tick(): void {
		this.tickFrame = 0;
		if (this.disposed) return;
		if (this.dirty) this.drawNow();
		// A new frame's share of taking tiles in, spent after its draw (`takeTilesSoon`).
		this.frameTaken = { ms: 0, bytes: 0, pictures: 0 };
		if (this.tileQueue.length) this.takeTilesSoon();
	}

	/** Draw the canvas at the next frame (`tick`), once however many changes come before it. */
	draw(): void {
		this.dirty = true;
		this.tickSoon();
	}

	/**
	 * Draw now what is marked to be drawn: for a caller already in an animation frame's callback (a
	 * glide's or a coast's step, which move the camera), whose change would otherwise be drawn a frame
	 * after the world moved.
	 */
	flush(): void {
		if (this.dirty) this.drawNow();
	}
	private drawSoon(): void {
		this.draw();
	}

	/** Tiles from the worker not yet taken in, oldest first, and what it said with the latest batch. */
	private tileQueue: Array<{ key: string; tile: TileFromWorker }> = [];
	private tileBatch: { left: number; rest: number; got: number; sent: number } | undefined;
	private coarseClock: boolean | undefined;

	/**
	 * Take tiles in soon, in a task of their own (`takeTiles`), and draw them at the next frame
	 * (`tick`): never in the frame's callback before its draw, where a copy that waited on the GPU
	 * process (12 ms once, in Chromium) made that frame late, and the draw after it too. A frame's
	 * share (`TILE_BUDGET`) is spent once, in one or more tasks after its draw; what is left waits
	 * for the next frame's.
	 */
	private takeTilesSoon(): void {
		if (this.takePosted || this.disposed || !this.tileQueue.length) return;
		const budget = tileBudget();
		if (this.frameTaken.ms >= budget.ms) return void this.tickSoon();
		this.takePosted = true;
		if (!this.takeChannel) {
			this.takeChannel = new MessageChannel();
			this.takeChannel.port1.onmessage = () => {
				this.takePosted = false;
				if (!this.disposed) this.takeTiles();
			};
		}
		this.takeChannel.port2.postMessage(0);
	}
	private takeChannel: MessageChannel | undefined;
	private takePosted = false;
	/** What taking tiles in has spent of this frame's share since its draw. */
	private frameTaken = { ms: 0, bytes: 0, pictures: 0 };

	/**
	 * Take in the tiles waiting, the window's first, until this frame's share (`TILE_BUDGET`) is
	 * spent, and draw them at the next frame; what is left is taken after that frame's draw. When none is left, what the worker
	 * said with its latest batch holds: the window sharp (`sharpAt`), or filled in (`settledAt`).
	 */
	private takeTiles(): void {
		const page = this.page;
		if (!page || this.paused) return this.dropTileQueue();
		const queue = this.tileQueue;
		if (!queue.length) return;
		const budget = tileBudget();
		// Counted too where the clock is coarse (WebKit, where tiles come as bytes).
		const coarse = (this.coarseClock ??= webKit());
		// The window's tiles first, in the order they came.
		if (queue.length > 1) {
			const { x, y } = this.corner();
			const w = this.view.width / this.camera.zoom;
			const h = this.view.height / this.camera.zoom;
			const seen = (t: TileFromWorker) => {
				const [tx, ty, side] = tileArea(t);
				return tx < x + w && tx + side > x && ty < y + h && ty + side > y;
			};
			const inView = queue.filter((q) => seen(q.tile));
			if (inView.length && inView.length < queue.length) this.tileQueue = [...inView, ...queue.filter((q) => !seen(q.tile))];
		}
		const start = performance.now();
		const spent = this.frameTaken;
		let { bytes, pictures } = spent;
		let taken = 0;
		for (let first = this.tileQueue[0]; first; first = this.tileQueue[0]) {
			const next = first.tile;
			// At least one a frame, however long the last frame's took.
			if (taken > 0 || spent.bytes + spent.pictures > 0) {
				if (spent.ms + performance.now() - start >= budget.ms) break;
				if (coarse && (next.bitmap ? pictures >= budget.pictures : bytes >= budget.bytes)) break;
			}
			this.tileQueue.shift();
			// A tile of a level not shown yet: it is shown once its level covers the window, or once its tiles stop coming for `SHOW_ANYWAY_MS`.
			if (next.scale !== this.overviewScale && next.scale !== page.shownScale()) this.showAnywaySoon();
			if (next.bitmap) {
				page.putTile(next.scale, next.x, next.y, next.bitmap);
				pictures++;
			} else {
				page.putTilePixels(next.scale, next.x, next.y, new Uint8Array(next.pixels), next.stride);
				sheetStats().pixelTiles = (sheetStats().pixelTiles ?? 0) + 1;
				bytes++;
			}
			taken++;
		}
		this.frameTaken = { ms: spent.ms + performance.now() - start, bytes, pictures };
		sheetStats().tiles = (sheetStats().tiles ?? 0) + taken;
		const batch = this.tileBatch;
		if (!this.tileQueue.length && batch) {
			this.tileBatch = undefined;
			this.settledNext = batch.rest === 0 && batch.got >= this.posted && this.fontsPending === 0;
			if (batch.left === 0 && batch.got >= this.postedContent && this.fontsPending === 0) this.sharpNext = true;
			this.seenAtDraw = batch.sent;
		}
		// Drawn in the next frame's one draw (`tick`), which takes what is left after it.
		if (taken) this.draw();
		else this.tickSoon();
	}

	/**
	 * Once the stage is first sharp, in idle time before any gesture, both engines make what a
	 * first zoom or drag would otherwise make in its first frames (`PageEngine::warm`,
	 * `WorkerEngine::warm`): every pipeline they draw with, the glyph textures, spare tile textures
	 * (not on a device short of memory).
	 * Again after the engines start again (a lost device). `__decksWarm = false` leaves it out, for measuring.
	 */
	private warmSoon(): void {
		if (this.warmed || (globalThis as { __decksWarm?: boolean }).__decksWarm === false) return;
		this.warmed = true;
		const idle = (globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
		const warm = () => {
			if (this.disposed || !this.page) return;
			this.page.warm(!this.lowMemory);
			this.post({ type: "warm" });
		};
		if (idle) idle(warm, { timeout: 500 });
		else setTimeout(warm, 50);
	}
	private warmed = false;
	private lowMemory = false;

	/**
	 * Show the level wanted in `SHOW_ANYWAY_MS` whether it covers the window or not, unless another of
	 * its tiles comes first: the old engine's word that a level was whole could fail to come, and so
	 * can a tile here.
	 */
	private showAnywaySoon(): void {
		clearTimeout(this.showAnyway);
		this.showAnyway = setTimeout(() => {
			if (this.disposed || !this.page) return;
			this.page.showWanted();
			this.draw();
		}, SHOW_ANYWAY_MS);
	}
	private showAnyway: ReturnType<typeof setTimeout> | undefined;

	/** Let go of the tiles waiting: the engine they were for is gone. */
	private dropTileQueue(): void {
		for (const q of this.tileQueue) q.tile.bitmap?.close();
		this.tileQueue = [];
		this.tileBatch = undefined;
	}
	/** What had been sent when the tiles that arrived last were asked for: shown once they are drawn. */
	private seenAtDraw = 0;

	/** Draw the canvas now, for the window: the frame's one draw (`tick`), or one that cannot wait (`flush`, `cutFromCarried`). */
	private drawNow(): void {
		this.dirty = false;
		if (!this.page || !this.view.width || this.paused) return;
		try {
			this.drawUnguarded();
		} catch (error) {
			this.recover(error, "a frame");
		}
	}

	private drawUnguarded(): void {
		if (!this.page) return;
		this.shownSeen = Math.max(this.shownSeen, this.seenAtDraw);
		const at = this.drawRect();
		// At the scale the worker's latest camera wants: shown once its tiles cover the window (`Page::frame`).
		const ops = this.page.frame(at.x, at.y, at.zoom, Math.min(2, devicePixelRatio || 1), at.width, at.height, this.wantScale ?? 0);
		// The tiles let go of: past the budget, or of the level a new one replaced.
		const gone = this.page.evict();
		if (gone !== "[]") this.post({ type: "dropped", keys: JSON.parse(gone) as Array<[number, number, number]> });
		this.drawnAt = { x: at.x, y: at.y, zoom: at.zoom };
		/*
		 * Moved as well as drawn, under WebKit: drawn once more at the next frame, where the camera
		 * stops. WebKit can show a canvas whose place changed with the picture it had before (a
		 * screenshot at rest after a zoom showed the step before it until anything drew again); a draw
		 * with the place unchanged shows the last one. While the camera moves, the next frame draws anyway.
		 */
		if (this.place() && (this.webKit ??= webKit())) this.draw();
		this.lastOps = ops;
		sheetStats().shown = (sheetStats().shown ?? 0) + 1;
		if (this.sharpNext && !this.moving) {
			this.sharpNext = false;
			sheetStats().sharpAt ??= performance.now();
			this.warmSoon();
		}
		if (this.settledNext) {
			this.settledNext = false;
			sheetStats().settledAt = performance.now();
		}
		// Asked for in JSON only when the engine says they changed: most frames, nothing did.
		const marks = this.page.boardMarks();
		if (marks !== this.marksSeen) {
			this.marksSeen = marks;
			const pictured = this.page.pictured();
			if (pictured !== this.picturedKey) {
				this.picturedKey = pictured;
				this.pictured?.(new Set(JSON.parse(pictured) as string[]));
			}
			const carrying = this.page.carrying();
			if (carrying !== this.carryingKey) {
				this.carryingKey = carrying;
				this.carrying?.(new Set(JSON.parse(carrying) as string[]));
			}
		}
		if (this.page.hasWanted()) this.wantPictures(JSON.parse(this.page.wantedPictures()) as string[]);
		this.presented?.();
	}

	// --- boards --------------------------------------------------------------------------------

	setBoards(boards: readonly SceneBoard[]): void {
		const was = this.boards;
		this.boards = boards;
		const key = JSON.stringify(boards.map((b) => [b.path, b.x, b.y, b.w, b.h, b.live, b.news, b.glow, b.picture]));
		if (key === this.boardKey || !this.page) {
			// The same boxes as the ones the index was made for: it answers for these too.
			if (key === this.boardKey && this.indexed === was) this.indexed = boards;
			return;
		}
		this.boardKey = key;
		this.page.setBoards(JSON.stringify(boards.map((b) => ({ path: b.path, x: b.x, y: b.y, w: b.w, h: b.h, live: b.live, news: b.news, glow: b.glow }))));
		const boxes = boards.map((b) => `${b.x},${b.y},${b.w},${b.h}`).join("|");
		if (boxes !== this.boardBoxes) {
			this.boardBoxes = boxes;
			this.boardIndex = new BoxIndex(boards.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })));
			this.writeHits();
		}
		this.indexed = boards;
		/*
		 * A board whose picture changed is asked for again, against the board's own address: the one
		 * fetched carries a size (`&w=480`), and comparing that one forgot every server picture on each
		 * change of the boards, such as the zoom crossing the live zoom, so each board went white until
		 * it was fetched again. The old picture stays drawn until the new one replaces it.
		 */
		for (const board of boards) {
			const asked = this.picturesAsked.get(`board:${board.path}`);
			if (asked && board.picture && asked.source !== board.picture) this.picturesAsked.delete(`board:${board.path}`);
		}
		// A board taken off the canvas lets go of its picture on the GPU: nothing else ever did.
		if (this.pictureBytes.size > 0) {
			const here = new Set(boards.map((board) => `board:${board.path}`));
			for (const key of [...this.pictureBytes.keys()]) {
				if (here.has(key)) continue;
				this.pictureBytes.delete(key);
				this.wholeBytes.delete(key);
				this.shrunk.delete(key);
				this.picturesAsked.delete(key);
				this.page?.forgetPicture(key);
			}
		}
		this.wantBoardPictures();
		this.draw();
	}

	private carriedBy = { dx: 0, dy: 0 };
	/**
	 * The boards a drag carries, and how far. An arrow with an end on one bends with it: the gesture's
	 * preview is sent again with the boards where they are now, or, when only boards are dragged, a
	 * preview of nothing but them. Such a drag's arrows stay as last routed when it is let go, until
	 * the server's drawing comes back routed to where the boards landed (`setDoc`), or two seconds pass.
	 */
	carry(paths: readonly string[], offset: { dx: number; dy: number }): void {
		this.carriedBy = { dx: offset.dx, dy: offset.dy };
		this.carriedCount = paths.length;
		this.carriedPaths = [...paths];
		if (!this.page) return;
		this.page.carry(JSON.stringify(paths), offset.dx, offset.dy);
		if (paths.length) {
			this.boardsAnswered = false;
			if (this.shown === undefined) {
				this.boardsOnly = true;
				clearTimeout(this.boardsLanding);
			}
			this.lift(this.page.setPreview(this.shown ?? "[]"));
			this.laidOut(this.shown === undefined || this.moveOnly);
		} else if (this.boardsOnly && this.shown === undefined) {
			clearTimeout(this.boardsLanding);
			// The drawing that answers the drop came while the boards were held where they were dropped (`editor/core/gesture.ts`, `holdBoards`): its arrows are routed already.
			if (this.boardsAnswered) this.landBoards();
			else this.boardsLanding = setTimeout(() => this.landBoards(), 2000);
		}
		this.draw();
	}
	/** The preview a gesture on drawn items is showing, as sent to the engine; undefined when none. */
	private shown: string | undefined;
	private carriedCount = 0;
	/** The boards the last `carry` names (`__decksEngine.carried`). */
	private carriedPaths: string[] = [];
	/** A drag of boards alone is showing its arrows, or has let go and waits for the drawing. */
	private boardsOnly = false;
	/** A drawing came since the boards were last carried a step: the one that answers their drop, if they are let go of now. */
	private boardsAnswered = false;
	private boardsLanding: ReturnType<typeof setTimeout> | undefined;
	private landBoards(): void {
		clearTimeout(this.boardsLanding);
		if (!this.boardsOnly) return;
		this.boardsOnly = false;
		if (this.shown !== undefined || !this.page) return;
		this.page.setPreview("null");
		if (this.lifted.size) this.post({ type: "drop", ids: [...this.lifted] });
		this.laidOut();
		this.draw();
	}
	/**
	 * What `setPreview` newly lifted (its answer): the arrows it bent, and a shape's outline resized
	 * with it. The worker leaves them out of its tiles too, and they are put down with the rest.
	 */
	private lift(answer: string): void {
		const bent = JSON.parse(answer) as string[];
		if (!bent.length) return;
		for (const id of bent) this.lifted.add(id);
		this.post({ type: "lift", ids: bent });
	}

	/**
	 * Fetch the pictures of the boards near the window that have none, each once, at this device's one
	 * width (`pictures`): the GPU makes its smaller sizes, so no zoom fetches or copies one again. At
	 * rest, a board near the window that was shrunk to fit the budget (`fitPictures`) gets its whole
	 * picture back.
	 */
	private wantBoardPictures(): void {
		if (!this.page || !this.view.width) return;
		const w = this.view.width / this.camera.zoom;
		const h = this.view.height / this.camera.zoom;
		const left = this.camera.x - w;
		const top = this.camera.y - h;
		// The boards near the window, from the index `setBoards` keeps (built from these boards, in their order).
		const near = this.indexed !== this.boards ? this.boards : this.boardIndex.search({ x: left, y: top, w: w * 2, h: h * 2 }).map((at) => this.boards[at]!);
		for (const board of near) {
			if (!board.picture || (board.live && !board.ready)) continue;
			if (board.x + board.w < left || board.x > left + w * 2 || board.y + board.h < top || board.y > top + h * 2) continue;
			const key = `board:${board.path}`;
			if (this.picturesAsked.has(key)) {
				// Whole again only if it fits: else the next rest would shrink it again, and copy it in at every rest.
				if (this.moving || !this.shrunk.has(key) || this.heldBytes() - this.pictureBytes.get(key)! + this.wholeBytes.get(key)! > this.budgetBytes()) continue;
				this.picturesAsked.delete(key);
				this.shrunk.delete(key);
			}
			const size = /^(https?:|\/)/.test(board.picture) ? this.pictures.width : 0;
			// Compressed for the GPU where it takes them (`putCompressedPicture`): written as it comes, a quarter of the memory.
			const astc = size && this.page.compressedPictures() ? "&astc=1" : "";
			const url = size ? `${board.picture}${board.picture.includes("?") ? "&" : "?"}w=${size}${astc}` : board.picture;
			this.fetchPicture(key, url, true, board.picture, size);
		}
	}

	/** Each board picture on the GPU: its bytes, its smaller sizes included (`fitPictures`). */
	private pictureBytes = new Map<string, number>();
	/** Each board picture's bytes as it was copied in, before any shrinking. */
	private wholeBytes = new Map<string, number>();
	private heldBytes(): number {
		let total = 0;
		for (const bytes of this.pictureBytes.values()) total += bytes;
		return total;
	}
	/** `__decksPictureMB` changes it, for measuring. */
	private budgetBytes(): number {
		return ((globalThis as { __decksPictureMB?: number }).__decksPictureMB ?? this.pictures.budgetMB) * 2 ** 20;
	}
	/** Board pictures put compressed (`putCompressedPicture`), for checks. */
	private compressedPut = 0;
	/** Each compressed board picture's width and height, for checks. */
	private compressedSize = new Map<string, [number, number]>();
	/** Boards whose picture was shrunk on the GPU to fit the budget, to get back whole when near the window again. */
	private shrunk = new Set<string>();

	/**
	 * Board pictures within this device's budget (`device.ts`, `PICTURES`), at rest. Over it, the
	 * pictures of the boards farthest from the window are shrunk on the GPU to their next size down,
	 * a quarter of the memory each time, with no fetch and no copy from the page; boards in the window
	 * only once every other is as small as it goes. Every board keeps a picture, so one coming back into
	 * view shows at once.
	 */
	private fitPictures(): void {
		if (!this.view.width || !this.page) return;
		const budget = this.budgetBytes();
		let total = this.heldBytes();
		if (total <= budget) return;
		const w = this.view.width / this.camera.zoom;
		const h = this.view.height / this.camera.zoom;
		const left = this.camera.x - w / 2;
		const top = this.camera.y - h / 2;
		const far = (board: SceneBoard) => Math.hypot(Math.max(board.x - this.camera.x, 0, this.camera.x - (board.x + board.w)), Math.max(board.y - this.camera.y, 0, this.camera.y - (board.y + board.h)));
		const seen = (board: SceneBoard) => board.x < left + w && board.x + board.w > left && board.y < top + h && board.y + board.h > top;
		const held = this.boards.filter((board) => this.pictureBytes.has(`board:${board.path}`));
		held.sort((a, b) => Number(seen(a)) - Number(seen(b)) || far(b) - far(a));
		// Round after round, each a size down, until the total fits or nothing has a smaller size.
		for (let shrank = true; total > budget && shrank; ) {
			shrank = false;
			for (const board of held) {
				if (total <= budget) break;
				const key = `board:${board.path}`;
				const size = this.page.shrinkPicture(key);
				if (!size) continue;
				const now = Math.round(size[0]! * size[1]! * 4 * (4 / 3));
				total -= this.pictureBytes.get(key)! - now;
				this.pictureBytes.set(key, now);
				this.shrunk.add(key);
				shrank = true;
			}
		}
		if (this.shrunk.size) this.draw();
	}

	/** `fitPictures` once the camera has rested `REST_MS`: a pan collects pictures as a zoom does. */
	private fitSoon(): void {
		clearTimeout(this.fitTimer);
		this.fitTimer = setTimeout(() => {
			if (this.disposed || this.moving) return;
			this.fitPictures();
		}, REST_MS);
	}
	private fitTimer: ReturnType<typeof setTimeout> | undefined;

	// --- pictures, fonts, icons -----------------------------------------------------------------

	/** Image fills and card pictures by their address, and icons (`icon:<key>`): fetched once for both engines. */
	private wantPictures(urls: readonly string[]): void {
		for (const url of urls) {
			if (url.startsWith("icon:")) this.fetchIcon(url.slice(5));
			else if (!this.picturesAsked.has(url)) {
				const address = pictureAddress(url, this.base || location.href);
				// `__picturesOnPage`: fetched and decoded here, twice, as before, for measuring the two in one page.
				if ((globalThis as { __picturesOnPage?: boolean }).__picturesOnPage || !this.worker) this.fetchPicture(url, address, false);
				else {
					// The worker fetches and decodes it, and hands it here (`picture`, `receive`).
					this.picturesAsked.set(url, { url: address, source: url, tries: 0 });
					this.post({ type: "fetchPicture", url, address: new URL(address, location.href).href, max: this.maxPicture });
				}
			}
		}
	}

	/**
	 * Board pictures waiting to be copied to the GPU, `PICTURES_PER_FRAME` a frame. Copying one is done
	 * on the page's thread (`copyExternalImageToTexture`), about 2 ms on an iPad mini, and a pan below
	 * the live zoom that brought a dozen boards in copied them all in one frame: the top cost of that pan.
	 */
	private putQueue: Array<() => void> = [];
	private putFrame = 0;
	private putPaced(put: () => void): void {
		this.putQueue.push(put);
		this.putFrame ||= requestAnimationFrame(this.putSome);
	}
	private putSome = (): void => {
		this.putFrame = 0;
		// `__decksPicturesPerFrame` changes it, for measuring.
		const most = (globalThis as { __decksPicturesPerFrame?: number }).__decksPicturesPerFrame ?? PICTURES_PER_FRAME;
		for (let i = 0; i < most && this.putQueue.length > 0; i++) this.putQueue.shift()!();
		if (this.putQueue.length > 0 && !this.disposed) this.putFrame = requestAnimationFrame(this.putSome);
	};

	/** Ask again for a picture the server answered with a stand-in while it makes it. */
	private retryStandIn(key: string, url: string, board: boolean, asked: { source: string; size?: number | undefined }): void {
		if (this.disposed || this.picturesAsked.get(key) !== asked) return;
		this.fetchPicture(key, url, board, asked.source, asked.size);
	}

	private fetchPicture(key: string, url: string, board: boolean, source = url, size?: number): void {
		const asked = this.picturesAsked.get(key) ?? { url, source, tries: 0, size };
		this.picturesAsked.set(key, asked);
		if (this.fetching >= FETCHES) {
			setTimeout(() => {
				if (this.picturesAsked.get(key) !== asked) return;
				this.picturesAsked.delete(key);
				// A board's is asked for again with the boards in view; an image fill's by its address
				// (the worker's asking again for it may have come while this one waited, and been let go).
				if (board) this.wantBoardPictures();
				else this.wantPictures([key]);
			}, 200);
			return;
		}
		this.fetching++;
		void fetch(url, { credentials: "same-origin" })
			.then(async (response) => {
				if (!response.ok) throw new Error(String(response.status));
				const standIn = response.headers.get("X-Decks-Stand-In") === "1";
				if (board && response.headers.get("Content-Type")?.startsWith("application/vnd.decks.astc")) {
					const packed = readCompressed(new Uint8Array(await response.arrayBuffer()));
					if (!packed || this.disposed || !this.page || this.picturesAsked.get(key) !== asked) return;
					this.putPaced(() => {
						if (this.disposed || !this.page || this.picturesAsked.get(key) !== asked) return;
						if (!this.page.putCompressedPicture(key, packed.data, packed.width, packed.height, packed.spans)) return;
						this.pictureBytes.set(key, packed.bytes);
						this.wholeBytes.set(key, packed.bytes);
						this.shrunk.delete(key);
						this.picturesPut++;
						this.compressedPut++;
						this.compressedSize.set(key, [packed.width, packed.height]);
						this.draw();
					});
					return;
				}
				const blob = await response.blob();
				const { bitmap: forPage, width, height } = await this.picture(blob);
				// Asked again since (a sharper copy, an engine started again): this one is not wanted.
				const wanted = () => !this.disposed && !!this.page && this.picturesAsked.get(key) === asked;
				if (!wanted()) return forPage.close();
				const put = () => {
					if (!wanted()) return forPage.close();
					// What it holds on the GPU, read before the engine closes the bitmap (`fitPictures`).
					if (board) {
						// With its smaller sizes, a third again.
						const bytes = Math.round(forPage.width * forPage.height * 4 * (4 / 3));
						this.pictureBytes.set(key, bytes);
						this.wholeBytes.set(key, bytes);
						this.shrunk.delete(key);
					}
					try {
						this.page!.putPicture(key, forPage, width, height);
					} catch (error) {
						// The engine's, not the network's: asking again would fail the same way.
						forPage.close();
						return this.recover(error, `the picture ${key}`);
					}
					this.picturesPut++;
					this.draw();
				};
				// A board's picture waits its turn to the GPU (`putPaced`); an image fill is needed by the worker's tiles now.
				if (board) {
					this.putPaced(put);
					if (standIn && asked.tries++ < STAND_IN_TRIES) setTimeout(() => this.retryStandIn(key, url, board, asked), STAND_IN_RETRY_MS);
					return;
				}
				put();
				// An image fill is drawn by the worker's tiles too.
				const { bitmap: forWorker } = await this.picture(blob);
				this.post({ type: "picture", url: key, bitmap: forWorker, width, height }, [forWorker]);
				this.laidOut();
				if (standIn && asked.tries++ < STAND_IN_TRIES) setTimeout(() => this.retryStandIn(key, url, board, asked), STAND_IN_RETRY_MS);
			})
			.catch(() => {
				// Not reachable now (a shot that failed, the network): drawn without it, as an empty place,
				// and asked again later, a little longer each time, while nothing newer has been asked for.
				const wait = PICTURE_RETRY_MS[asked.failed ?? 0];
				if (wait === undefined) return;
				asked.failed = (asked.failed ?? 0) + 1;
				setTimeout(() => {
					if (!this.disposed && this.picturesAsked.get(key) === asked) this.fetchPicture(key, url, board, asked.source, asked.size);
				}, wait);
			})
			.finally(() => {
				this.fetching--;
			});
	}

	/**
	 * The drawing laid out for the pictures the worker handed over, once for those that came close
	 * together: each one laid the whole drawing out again and read it back (3 ms and more on 2,000 items).
	 */
	private layOutPicturesSoon(): void {
		if (this.picturesTimer !== undefined) return;
		this.picturesTimer = setTimeout(() => {
			this.picturesTimer = undefined;
			if (this.disposed || !this.page) return;
			if (this.page.layOutPictures()) this.laidOut();
			this.draw();
		}, PICTURES_BATCH_MS);
	}
	private picturesTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * A picture's bitmap, premultiplied, no bigger across than the device keeps one, and its own size
	 * (`width` × `height`, which lays it out).
	 */
	private async picture(blob: Blob): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
		const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "premultiply" });
		const { width, height } = bitmap;
		const fit = Math.min(1, this.maxPicture / Math.max(width, height, 1));
		if (fit >= 1) return { bitmap, width, height };
		const resizeWidth = Math.max(1, Math.floor(width * fit));
		const resizeHeight = Math.max(1, Math.floor(height * fit));
		// From the file again, not from `bitmap`: WebKit's WebGL takes a bitmap made from a bitmap as
		// straight and premultiplies it a second time (every partly clear pixel too dark).
		bitmap.close();
		const smaller = await createImageBitmap(blob, { premultiplyAlpha: "premultiply", resizeWidth, resizeHeight, resizeQuality: "high" });
		return { bitmap: smaller, width, height };
	}

	private fetchIcon(key: string): void {
		if (this.iconsAsked.has(key)) return;
		this.iconsAsked.add(key);
		const [library = "lucide", name = "", weight = "400"] = key.split("|");
		const url = iconUrl(library, name, Number(weight));
		if (!url) return;
		void fetch(url)
			.then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
			.then((svg) => {
				const shape = parseIcon(svg, Number(weight));
				if (!shape || !this.page) return;
				const json = JSON.stringify(shape);
				this.page.putIcon(key, json);
				this.post({ type: "icon", key, shape: json });
				this.draw();
			})
			.catch(() => {
				/* An icon that does not load is not drawn. */
			});
	}

	/** Fetch the font files the stage's words need (`font-files.ts`), and hand each to both engines in the chain's order. */
	private needFonts(): void {
		if (!this.page) return;
		// The words of what was laid out again since the last time: a change brings only its own.
		this.fetchFonts(fontFiles(JSON.parse(this.page.fontNeedsChanged()) as FontNeed[]));
	}

	/**
	 * Before the engine is up: the files the drawing's words name, read from the drawing here, so
	 * they are on their way while the engine loads and lays out rather than asked for after. What
	 * the engine's own reading (`needFonts`) finds besides is fetched then.
	 */
	private prefetchFonts(): void {
		if (this.page || this.prefetched || !this.doc) return;
		this.prefetched = true;
		const doc = this.doc;
		const files = fontFiles(stageFontNeeds(doc.children ?? [], doc, baseTheme(doc, this.scheme === "dark" ? "dark" : "light")));
		this.fetchFonts(files);
	}
	private prefetched = false;

	private fetchFonts(wanted: readonly FontFile[]): void {
		const files = wanted.filter((file) => !this.fontsAsked.has(file.key));
		if (!files.length) return;
		for (const file of files) this.fontsAsked.add(file.key);
		this.fontsPending += files.length;
		// A worker still painting its first view waits for them (up to 300 ms) rather than paint it twice.
		if (this.worker) this.post({ type: "fontsDue" });
		void Promise.all(
			files.map(async (file) => {
				for (const url of [file.url, file.fallback].filter(Boolean) as string[]) {
					try {
						const response = await fetch(url);
						if (!response.ok) continue;
						const blob = await response.blob();
						return { file, blob, bytes: new Uint8Array(await blob.arrayBuffer()) };
					} catch {
						/* the next address */
					}
				}
				return undefined;
			}),
		).then((loaded) => {
			this.fontsPending -= files.length;
			for (const file of files) this.fontsSettled.add(file.key);
			// Kept first: an engine started (or started again) is given them from here.
			const fonts: Font[] = loaded.filter((one) => one !== undefined).map((one) => ({ family: one.file.family, blob: one.blob, bytes: one.bytes, fallback: isFallbackFamily(one.file.family) }));
			this.fonts.push(...fonts);
			if (!this.page || this.disposed) return;
			this.giveFonts(fonts, true);
			this.postFonts(fonts);
		});
	}

	/**
	 * Fonts to the page's engine, in the order the chain lists them (so fallbacks are tried in the
	 * app's order), laid out once for all of them; `show` lays the stage out for the stage and draws.
	 */
	private giveFonts(fonts: readonly Font[], show: boolean): void {
		if (!this.page || !fonts.length) return;
		for (const { family, bytes, fallback } of fonts) if (bytes) this.page.addFont(family, bytes, fallback, true);
		this.page.layOut();
		this.wordsGeneration++;
		if (!show) return;
		this.laidOut();
		this.draw();
	}

	/**
	 * The same fonts to the worker, in one message (none, when every file failed: it hears how many
	 * are still due): it lays out and paints once for all of them. Their bytes are transferred, not
	 * copied (the page's engine has copied them already); the files are kept.
	 */
	private postFonts(fonts: readonly Font[]): void {
		const sent = fonts.filter((font): font is Font & { bytes: Uint8Array } => !!font.bytes);
		this.post({ type: "fonts", fonts: sent.map(({ family, bytes, fallback }) => ({ name: family, bytes, fallback })), due: this.fontsPending }, sent.map((font) => font.bytes.buffer as ArrayBuffer));
		for (const font of sent) delete (font as Font).bytes;
	}

	// --- gestures --------------------------------------------------------------------------------

	/**
	 * Items a gesture is moving or reshaping: lifted out of the worker's tiles and drawn here each
	 * frame, moved and with the fields shown, until the gesture ends (`undefined`) and the saved
	 * drawing has been painted into the tiles again.
	 */
	preview(moving: ReadonlyMap<string, PenPreview> | undefined): void {
		// A gesture's own preview ends a glide still in hand: what it shows is where things are now.
		if (this.glide) {
			cancelAnimationFrame(this.glide.frame);
			this.glide = undefined;
			this.onGlide?.(undefined);
		}
		this.showPreview(moving);
	}

	private showPreview(moving: ReadonlyMap<string, PenPreview> | undefined): void {
		if (!this.page) return;
		// Only moved: nothing the stage reads of the layout changes but the arrows bent, so it is told at the end.
		this.moveOnly = !!moving?.size && [...moving.values()].every((one) => one.w === undefined && one.h === undefined && one.radius === undefined && (!one.set || Object.keys(one.set).length === 0));
		if (moving?.size) {
			const fresh = [...moving.keys()].filter((id) => !this.lifted.has(id));
			if (fresh.length) {
				for (const id of fresh) this.lifted.add(id);
				this.page.lift(JSON.stringify(fresh));
				this.post({ type: "lift", ids: fresh });
			}
			const first = moving.values().next().value;
			this.offset = { dx: first?.dx ?? 0, dy: first?.dy ?? 0 };
			// The arrows joined to what moves bend with it, routed by the page's engine: lifted out of the tiles too.
			this.shown = JSON.stringify(this.withOutlines(moving));
			this.boardsOnly = false;
			this.settling = false;
			this.lift(this.page.setPreview(this.shown));
		} else {
			this.shown = undefined;
			this.boardsOnly = false;
			this.page.setPreview("null");
			this.offset = { dx: 0, dy: 0 };
			if (this.lifted.size) this.post({ type: "drop", ids: [...this.lifted] });
		}
		this.laidOut(this.moveOnly);
		this.draw();
	}
	/** The gesture shown only moves what it carries (`showPreview`). */
	private moveOnly = false;

	/**
	 * A library shape being resized or rounded shows its outline as the saved drawing will have it
	 * (`fitShapes`): sized to the shape, and built at that size by its kind (`build`) so a curve stays
	 * a circle, rather than left at its old size. Its radius is the shape's own, not a frame corner.
	 */
	private withOutlines(moving: ReadonlyMap<string, PenPreview>): Array<[string, PenPreview]> {
		const list = [...moving];
		if (!this.doc) return list;
		for (const [at, [id, change]] of list.entries()) {
			if (change.w === undefined && change.h === undefined && change.radius === undefined) continue;
			const node = docIndex(this.doc).get(id)?.node;
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
	ink(strokes: readonly LiveInk[], _warm?: boolean): void {
		sheetStats().ink = strokes.length;
		this.page?.setInk(JSON.stringify(strokes));
		this.drawSoon();
	}

	hide(ids: ReadonlySet<string> | undefined): void {
		this.viewState.hidden = [...(ids ?? [])];
		this.sendView();
	}

	muteText(ids: ReadonlySet<string> | undefined): void {
		this.viewState.mute = [...(ids ?? [])];
		this.sendView();
	}

	holes(ids: ReadonlySet<string>): void {
		this.viewState.holes = [...ids];
		this.sendView();
	}

	/**
	 * Who last wrote the drawing: its placeholder frames (`placeholder: true`) are drawn unfinished,
	 * a dashed outline in `color` (a CSS colour the engine reads: hex, rgb() or hsl(), not a `var()`)
	 * with `name` on a tag in their top-left corner. None: the accent, no name.
	 */
	setWriter(writer: { name?: string; color: string } | undefined): void {
		if (writer) this.viewState.writer = writer.name ? { name: writer.name, color: writer.color } : { color: writer.color };
		else delete this.viewState.writer;
		this.sendView();
	}

	/**
	 * A picture of what a drag carries, for the ghost a drag over a card shows (`Stage.tsx`): the lifted
	 * items drawn alone for one frame and copied off the canvas in the same task, then the stage drawn
	 * whole again. `rect` is where they lay on screen before the drag; they are now the drag's offset on.
	 */
	cutFromCarried(rect: { left: number; top: number; width: number; height: number }): HTMLCanvasElement | undefined {
		const canvas = this.over;
		if (!this.page || !canvas || !this.lifted.size || rect.width < 1 || rect.height < 1) return undefined;
		const drawn = this.drawRect();
		this.page.frameLifted(drawn.x, drawn.y, drawn.zoom, Math.min(2, devicePixelRatio || 1), drawn.width, drawn.height);
		this.drawnAt = { x: drawn.x, y: drawn.y, zoom: drawn.zoom };
		this.place();
		const at = canvas.getBoundingClientRect();
		if (!at.width || !at.height) {
			this.drawNow();
			return undefined;
		}
		const sx = canvas.width / at.width;
		const sy = canvas.height / at.height;
		const left = rect.left + this.offset.dx * this.camera.zoom - at.left;
		const top = rect.top + this.offset.dy * this.camera.zoom - at.top;
		const out = document.createElement("canvas");
		out.width = Math.max(1, Math.round(rect.width * sx));
		out.height = Math.max(1, Math.round(rect.height * sy));
		out.getContext("2d")?.drawImage(canvas, left * sx, top * sy, rect.width * sx, rect.height * sy, 0, 0, out.width, out.height);
		// Drawn whole again before the browser paints, whatever frame this is.
		this.drawNow();
		return out;
	}
	/** The lifted items drawn or not, while a ghost of them stands in. */
	showCarriedLayer(on: boolean): void {
		this.page?.showLifted(on);
		this.draw();
	}
	/** How far the drag has moved what it carries. */
	private offset = { dx: 0, dy: 0 };
	/** The old sheet's tile hand-off, which this engine does not use. */
	setTiles(_sink: unknown): void {}
	forgetTile(_key: string): void {}
	attach(_sheet: HTMLCanvasElement): void {}

	/** The SVG of invisible shapes that take a press on a drawn item from the board page under it. */
	attachHits(svg: SVGSVGElement): void {
		this.hits = svg;
		this.writeHits();
	}

	/** `placed` as a list, and an index of what each covers, made when first asked for after a change. */
	private placedList: Placed[] | undefined;
	private placedIndex: BoxIndex | undefined;
	private list(): Placed[] {
		return (this.placedList ??= [...this.placed.values()]);
	}
	private index(): BoxIndex {
		return (this.placedIndex ??= new BoxIndex(this.list().map((one) => this.bounds.get(one.node.id) ?? one.box)));
	}

	/** The window on the stage, grown by `more` windows on each side. */
	private windowRect(more: number): Rect {
		const { x, y, zoom } = this.camera;
		const w = this.view.width / zoom;
		const h = this.view.height / zoom;
		return { x: x - w / 2 - more * w, y: y - h / 2 - more * h, w: w * (1 + 2 * more), h: h * (1 + 2 * more) };
	}

	/**
	 * One invisible shape per drawn item over a board, near the window: a press on it is the drawing's,
	 * and one beside it reaches the board. On bare canvas the stage has the press and the editor's pick (`editor/core/pick.ts`) answers.
	 */
	private writeHits(): void {
		const svg = this.hits;
		if (!svg) return;
		const NS = "http://www.w3.org/2000/svg";
		const band = (2 * BAND_PX) / this.camera.zoom;
		this.bandZoom = this.camera.zoom;
		const shapes: SVGElement[] = [];
		const reach = this.view.width > 0 ? this.windowRect(1) : undefined;
		this.hitWindow = reach;
		const list = this.list();
		const near = reach ? this.index().search(reach).map((at) => list[at]!) : list;
		for (const placed of near) {
			const { node, box } = placed;
			if (node.type === "group" || isShape(node) || (node.type === "browser" && ["decks.board", "decks.card", "decks.document", "decks.app"].includes(String(node.metadata?.type)))) continue;
			let top = placed;
			while (top.parent) top = this.placed.get(top.parent) ?? top;
			if (top.parent) continue;
			const bounds = this.bounds.get(node.id) ?? box;
			if (this.boardIndex.search(bounds).length === 0) continue;
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

	private sendView(): void {
		this.viewState.scrolls = Object.fromEntries(this.scrolls);
		const key = JSON.stringify(this.viewState);
		if (key === this.viewKey) return;
		this.viewKey = key;
		this.page?.setView(key);
		this.post({ type: "view", view: key });
		this.draw();
	}

	/** Tiles the page holds: none until the worker's first ones arrive. */
	tileCount(): number {
		return this.page?.tileCount() ?? 0;
	}

	/** A mark for what has been sent so far: `shows(mark)` once a frame painted after all of it is on screen. */
	mark(): number {
		return this.sent;
	}
	shows(mark: number): boolean {
		return this.shownSeen >= mark;
	}

	// --- questions ------------------------------------------------------------------------------

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
		ctx.lineWidth = Math.max(drawn, (2 * BAND_PX) / this.camera.zoom) / Math.max(sx, sy);
		const filled = node.fill !== undefined && node.fill !== null;
		return ctx.isPointInStroke(path, px, py) || (filled && ctx.isPointInPath(path, px, py));
	}

	/**
	 * Every item under a stage point, topmost first, with a press's reach round each so a thin line
	 * can be hit: raw geometry, unfiltered. Which of them a press means is the editor's
	 * (`canvas/editor/core/pick.ts`). Boards' own items are among them; nothing before a page.
	 */
	pickAll(point: { x: number; y: number }): string[] {
		if (!this.page) return [];
		return JSON.parse(this.page.pickAll(point.x, point.y, (2 * BAND_PX) / this.camera.zoom)) as string[];
	}

	/** Whether a stage point is on what a path item draws (`onPath`); `undefined` for an item not placed or with no geometry. */
	onLine(id: string, point: { x: number; y: number }): boolean | undefined {
		const placed = this.placed.get(id);
		return placed ? this.onPath(placed, point) : undefined;
	}

	private cardAt(point: { x: number; y: number }) {
		let found: CardGeometry | undefined;
		for (const card of this.cards()) {
			const { box } = card;
			if (this.viewState.hidden.includes(card.id) || (found && card.order < found.order)) continue;
			if (point.x < box.x || point.x > box.x + box.w || point.y < box.y || point.y > box.y + box.h) continue;
			found = card;
		}
		return found ? { card: found, x: point.x - found.box.x - found.pad, y: point.y - found.box.y - found.pad } : undefined;
	}

	/** The link under a stage point, in a markdown card. */
	linkAt(point: { x: number; y: number }): string | undefined {
		const found = this.cardAt(point);
		if (!found) return undefined;
		const { card, x, y } = found;
		return card.links.find((l) => {
			let lx = l.x;
			if (l.scroller !== null && l.scroller !== undefined) {
				const view = card.scrollers[l.scroller];
				if (!view || x < view.x || x > view.x + view.w) return false;
				lx -= this.scrolls.get(`${card.id}:${l.scroller}`) ?? 0;
			}
			return x >= lx && x <= lx + l.w && y >= l.y && y <= l.y + l.h;
		})?.href;
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
			this.sendView();
		}
		return true;
	}

	snapMove(moving: Box, targets: readonly Box[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
		return snapMove(moving, targets, threshold);
	}

	dispose(): void {
		this.disposed = true;
		cancelAnimationFrame(this.tickFrame);
		// Pictures still waiting for the GPU let go of their bitmaps (each sees the engine is gone).
		cancelAnimationFrame(this.putFrame);
		for (const put of this.putQueue.splice(0)) put();
		this.takeChannel?.port1.close();
		this.dropTileQueue();
		this.unwatch?.();
		clearTimeout(this.fitTimer);
		clearTimeout(this.showAnyway);
		clearTimeout(this.fastTimer);
		this.worker?.terminate();
		this.worker = undefined;
		setStageWords(undefined, this.words);
		this.page?.free();
		this.page = undefined;
		this.hits?.replaceChildren();
	}
}

/**
 * A module worker at its address, or, where the page may not start one from there, from a script of
 * its own that imports it. The canvas frame is sandboxed with an origin of its own, and a page may start
 * a worker only from its own origin; a worker made from a `blob:` the page wrote is its own, and its
 * `import` of the real script crosses with CORS like any other module (`frame/`).
 */
function startWorker(url: string): Worker {
	/*
	 * A page of opaque origin (the canvas frame's sandbox) may not start a worker from its server's
	 * address, and a `blob:` worker made there fails to load its import too; a `data:` module worker,
	 * which takes an origin of its own, imports the real file as any cross-origin module. Chrome throws
	 * at the first; Safari makes the worker and fails it a moment later with an `error` event, so an
	 * opaque origin goes to the `data:` worker without trying.
	 */
	const opaque = (globalThis as { origin?: string }).origin === "null";
	if (!opaque) {
		try {
			return new Worker(url, { type: "module" });
		} catch {
			/* below */
		}
	}
	const absolute = new URL(url, location.href).href;
	return new Worker(`data:text/javascript,${encodeURIComponent(`import ${JSON.stringify(absolute)};`)}`, { type: "module" });
}
