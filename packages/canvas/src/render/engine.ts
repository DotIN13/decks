import { knobs, probes } from "../base/debug.ts";
import renderWorkerUrl from "./render.worker.ts?worker&url";
/**
 * The stage's engine, on the page: the Rust page engine (`@decks/stage`) and its render worker.
 *
 * The page engine owns a copy of the drawing, kept on the server's revision by its edits
 * (`canvas.changed`), and answers what the stage asks of the drawing: where each item is, what is
 * under a point, what a marquee holds, a card's links. Each frame it draws two canvases in the same
 * call that moves the board pages (`frame`): under them, the boards' pictures; over them, the
 * worker's tiles, then what a gesture is moving and the stroke under the pen, drawn fresh.
 *
 * Fonts, pictures, icons and the markdown reader are the app's own, fetched here and handed to both
 * engines once each.
 */
import type { PageEngine } from "@decks/stage";
import { diff, type Frame, type PenDocument, type Placed } from "@decks/pen";
import type { Camera } from "@decks/protocol";
import { Recovery } from "./recovery.ts";
import { cardReader, mathTypesetter } from "./reader.ts";
import { setCanvasWords } from "./measure.ts";
import type { DocEdits } from "../model/drawing.ts";
import type { FromWorker, ToWorker } from "./types.ts";
import { detect, type Detected, type StageModule } from "./backends/detect.ts";
import { takeWarm, warmEngine } from "./warm.ts";
import { PICTURES, readGpuClass } from "./device.ts";
import { noticeFor } from "./backends/notice.ts";
import { EngineFaces } from "./engine-faces.ts";
import { EngineQuestions } from "./engine-questions.ts";
import { EnginePictures } from "./engine-pictures.ts";
import { EngineGlides } from "./engine-glides.ts";
import { EngineCards } from "./engine-cards.ts";
import { EnginePreviews } from "./engine-previews.ts";
import { EngineTiles, webKit } from "./engine-tiles.ts";
import { EMPTY, EngineLayout } from "./engine-layout.ts";
import { EngineFrames } from "./engine-frames.ts";

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
 * WebKit). `knobs.tilePixels` (`debug.ts`; true or false), set before the stage opens, says it instead.
 */
export function pixelsFirst(): boolean {
	const forced = knobs.tilePixels;
	if (typeof forced === "boolean") return forced;
	// `?tiles=bitmaps` or `?tiles=pixels` on the page's address (carried into the frame, `host.tsx`), for measuring one way on a device that takes the other.
	const asked = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("tiles");
	if (asked === "bitmaps") return false;
	if (asked === "pixels") return true;
	return webKit();
}

/** A zoom faster than this many doublings a second paints no new level (`zoomRate`), over this window of time; and is painted after this long still. */
const FAST_ZOOM = 1;
const ZOOM_RATE_MS = 100;
const FAST_HOLD_MS = 250;

/** The engine's compiled module, for the worker to start from (`boot`). */
function moduleOf(stage: StageModule): WebAssembly.Module | undefined {
	const module: unknown = stage.engineModule();
	return module instanceof WebAssembly.Module ? module : undefined;
}

/** How much of the window the sheet reaches past it on each side (`drawRect`): room for a scroll before it is drawn again. */
const SHEET_MARGIN = 0.25;

/**
 * The engine a canvas is drawn by (`view/CanvasView.tsx`). This class is its core: starting the two
 * engines and starting them again when the GPU is lost, the drawing they hold, the sheet they draw
 * on and where the camera is. The rest is in parts, each a file of its own beside this one and each
 * reaching this core through `of`:
 *
 * - `frames`: the frame loop, when to draw (`engine-frames.ts`)
 * - `layout`: where each item is (`engine-layout.ts`)
 * - `tiles`: the worker's tiles (`engine-tiles.ts`)
 * - `previews`: what a gesture is moving, the live stroke, what is hidden (`engine-previews.ts`)
 * - `cardLayer`: the cards, and those a drag carries (`engine-cards.ts`)
 * - `cardPictures`: the cards' pictures and their memory budget (`engine-pictures.ts`)
 * - `glides`: an item's glide to its new place (`engine-glides.ts`)
 * - `questions`: what is under a point (`engine-questions.ts`)
 * - `faces`: fonts and icons (`engine-faces.ts`)
 *
 * The fields a part reads are not marked private, since TypeScript has no way to say "this class's
 * parts only": outside `render/`, the engine is asked through its methods and its parts' methods.
 */
export class CanvasEngine {
	readonly frames = new EngineFrames(this);
	readonly layout = new EngineLayout(this);
	readonly tiles = new EngineTiles(this);
	readonly previews = new EnginePreviews(this);
	readonly cardLayer = new EngineCards(this);
	readonly cardPictures = new EnginePictures(this);
	readonly glides = new EngineGlides(this);
	readonly questions = new EngineQuestions(this);
	readonly faces = new EngineFaces(this);

	page: PageEngine | undefined;
	worker: Worker | undefined;
	disposed = false;
	camera: Camera = { x: 0, y: 0, zoom: 1 };
	view = { width: 0, height: 0 };
	scheme: "light" | "dark" = "light";
	moving = false;
	/** The zoom has changed since the camera started moving: tiles are wanted at the power of two under it (`scaleFor`), not the exact scale. */
	private zooming = false;
	/** The drawing as both engines hold it, and the address its pictures are relative to. */
	doc: PenDocument | undefined;
	base = "";
	over: HTMLCanvasElement | undefined;
	private size = { w: 0, h: 0 };
	/** The stage rectangle the canvas was last drawn for: the window's, at the camera then. */
	drawnAt: { x: number; y: number; zoom: number } | undefined;
	/** A batch came from a worker with nothing left to paint: the next draw at rest is a sharp one (`sharpAt`). */
	sharpNext = false;
	/** As `sharpNext`, for `settledAt`: the next draw at rest shows the window filled in. */
	settledNext = false;
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

	/** Every item as laid out, by id, with its node; and what each item covers. */
	placed: ReadonlyMap<string, Placed> = new Map<string, Placed>();
	bounds: ReadonlyMap<string, Frame> = new Map<string, Frame>();
	/** The document the layout was made from. */
	drawnDoc: PenDocument | undefined;
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
	lastOps = 0;
	/** The graphics API the stage draws with, `"webgpu"` or `"webgl2"`, once open. */
	private backend = "";
	/** The worker's, which it opens the page's first. */
	private workerBackend = "";
	/** What this browser draws with (`backends/detect.ts`), found once. */
	private detected: Detected | undefined;
	/** Stops watching for the device to be lost. */
	private unwatch: (() => void) | undefined;
	/** The device is gone and nothing is drawn until the engine has started again. */
	paused = false;
	private restarting = false;
	/** Times the engine started again after its device was lost (WebGPU) or its context (WebGL 2). */
	private restarts = 0;

	/** Restarts after an engine error, capped (`recovery.ts`). */
	private recovery = new Recovery();

	/**
	 * An error out of an engine: it cannot be trusted to draw again, so both are started again, as
	 * after a lost GPU. The drawing, boards, camera and fonts are held here and given back to them.
	 */
	recover(error: unknown, where: string): void {
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
		this.faces.prefetchFonts();
		// An engine started ahead of any canvas, in a frame its page kept spare (`warm.ts`): its worker has loaded and booted already.
		const warmed = await takeWarm();
		if (this.disposed) return void warmed?.worker.terminate();
		this.worker = warmed?.worker ?? startWorker(renderWorkerUrl);
		this.tiles.posted = 0;
		this.tiles.postedContent = 0;
		this.worker.onmessage = ({ data }: MessageEvent<FromWorker>) => this.receive(data);
		const found = (this.detected ??= warmed?.detected ?? (await detect()));
		const stage = warmed?.stage ?? (await found.backend.load());
		if (this.disposed) return;
		this.stageModule = stage;
		if (!warmed) this.post({ type: "boot", backend: found.backend.name, lowMemory: found.lowMemory, module: moduleOf(stage) });
		this.fitCanvases();
		const gpu = await stage.openStage(over, over.width, over.height, found.backend.name, found.lowMemory);
		this.lowMemory = !!found.lowMemory;
		// Fonts already handed to an engine before (this is a restart) are read from their files again.
		await Promise.all(this.faces.fonts.map(async (font) => (font.bytes ??= new Uint8Array(await font.blob.arrayBuffer()))));
		if (this.disposed) return gpu.free();
		this.backend = gpu.backend();
		this.cardPictures.maxPicture = gpu.maxPictureSize();
		this.cardPictures.pictures = PICTURES[await readGpuClass()];
		if (this.disposed) return gpu.free();
		const doc = this.doc ? JSON.stringify(this.doc) : EMPTY;
		probes.rust = this;
		const self = this;
		probes.engine = {
			stats: () => ({ tiles: this.page?.tileCount() ?? 0, drawn: [this.lastOps, this.lastOps], engine: "rust", backend: this.backend, workerBackend: this.workerBackend, maxPicture: this.cardPictures.maxPicture, restarts: this.restarts, pictures: this.cardPictures.picturesPut, paused: this.paused, cardsSent: { ...this.cardLayer.cardsSent } }),
			/** The boards a drag carries as their picture, and by how far. */
			get carried() {
				// Live pages carried as their picture, and boards already drawn as pictures that the drag moves.
				const drawn = new Set([...(JSON.parse(self.page?.carrying() ?? "[]") as string[]), ...self.cardLayer.carriedPaths.filter((path) => (JSON.parse(self.page?.pictured() ?? "[]") as string[]).includes(path))]);
				return { paths: drawn, ...self.cardLayer.carriedBy };
			},
		};
		// Made empty and given its readers first, then the drawing: each reader given lays the drawing out again.
		this.page = new stage.PageEngine(EMPTY, this.scheme === "dark", `s${Math.random().toString(36).slice(2, 7)}`);
		this.tiles.warmed = false;
		this.page.setGpu(gpu);
		this.page.setMarkdownReader(cardReader(this.scheme));
		this.page.setMath(mathTypesetter());
		// Fonts already here go to both engines now, before the drawing, so it is laid out once with
		// them (given after, they laid it all out a second time); those still coming (asked for before
		// the engine was up, `prefetchFonts`, or by its first layout) the worker waits for before it paints.
		this.faces.giveFonts(this.faces.fonts, false);
		if (doc !== EMPTY) this.page.setDocument(doc);
		this.paused = false;
		setCanvasWords(this.layout.words);
		this.faces.needFonts();
		this.post({ type: "init", doc, dark: this.scheme === "dark", backend: this.backend, lowMemory: found.lowMemory, fontsDue: this.faces.fontsPending > 0, docDue: !this.doc, pixels: pixelsFirst() });
		this.faces.postFonts(this.faces.fonts);
		// The camera now, not when the worker says it is ready: a page busy laying out fonts heard that late.
		this.sendCamera();
		this.unwatch = found.backend.watch(over, { lost: () => this.lose(), restored: () => void this.restart(), isLost: () => this.page?.lost() ?? false });
		this.previews.viewKey = "";
		this.previews.sendView();
		this.cardLayer.cardKey = "";
		this.cardLayer.liveKey = "";
		this.cardLayer.setCards(this.cardLayer.placedCards);
		this.layout.laidOut();
		this.frames.draw();
	}

	/**
	 * The device is gone (`backends/webgpu.ts`, `backends/webgl.ts`), or the worker's: nothing more
	 * is drawn, and the engines are let go while their context is lost, so what they free is freed
	 * on nothing. The drawing, the boards, the camera and the fonts stay here for `restart`.
	 */
	private lose(): void {
		if (this.paused) return;
		this.paused = true;
		this.tiles.dropTileQueue();
		this.worker?.terminate();
		this.worker = undefined;
		setCanvasWords(undefined, this.layout.words);
		this.page?.free();
		this.page = undefined;
		this.cardPictures.picturesAsked.clear();
		for (const key of this.cardPictures.cardByKey.keys()) this.cardPictures.unpictured.add(key);
		// What the GPU held went with the context: the cards' pictures are fetched again from the bottom rung.
		this.cardPictures.pictureBytes.clear();
		this.cardPictures.heldWidth.clear();
		this.cardPictures.compressedSize.clear();
		this.faces.iconsAsked.clear();
		this.cardLayer.lifted.clear();
		this.cardLayer.picturedKey = "";
		this.cardLayer.carryingKey = "";
		this.tiles.marksSeen = -1;
		this.drawnAt = undefined;
		this.cardLayer.shown = undefined;
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

	/** How long after a camera change the worker paints one tile a batch (`AFTER_MOVE_MS` in `render.worker.ts`): for measures to switch in one page. */
	afterMove(ms: number): void {
		this.post({ type: "afterMove", ms });
	}

	post(message: ToWorker, transfer: Transferable[] = []): void {
		if (this.worker) {
			this.worker.postMessage(message, transfer);
			this.tiles.posted++;
			if (message.type !== "camera" && message.type !== "dropped") this.tiles.postedContent = this.tiles.posted;
		}
		this.tiles.sent++;
	}

	private receive(message: FromWorker): void {
		if (this.disposed || !this.page) {
			if (message.type === "tiles") for (const t of message.tiles) t.bitmap?.close();
			return;
		}
		switch (message.type) {
			case "tiles":
				// Nothing painted (the worker says it has nothing left for this camera) and nothing waiting: the frame on screen, or the one coming, is filled in.
				if (!message.tiles.length && !this.tiles.tileQueue.length) {
					this.settledNext = (message.rest ?? message.left) === 0 && message.got >= this.tiles.posted && this.faces.fontsPending === 0;
					if (this.settledNext && !this.frames.dirty) {
						this.settledNext = false;
						probes.sheet.settledAt = performance.now();
					}
					break;
				}
				if (message.overview !== undefined) this.tiles.overviewScale = message.overview;
				// Taken in at the next frames, a few a frame (`takeTiles`); a tile painted again replaces the one waiting.
				// One of a scale the zoom has left since it was asked for is let go of at once.
				const unwanted: Array<[number, number, number]> = [];
				for (const t of message.tiles) {
					if (!this.tiles.wanted(t)) {
						t.bitmap?.close();
						unwanted.push([t.scale, t.x, t.y]);
						continue;
					}
					const key = `${t.scale},${t.x},${t.y}`;
					const i = this.tiles.tileQueue.findIndex((q) => q.key === key);
					if (i >= 0) this.tiles.tileQueue.splice(i, 1)[0]?.tile.bitmap?.close();
					this.tiles.tileQueue.push({ key, tile: t });
				}
				if (unwanted.length) this.post({ type: "dropped", keys: unwanted });
				// What the worker says of the latest batch holds once every tile before it is in.
				this.tiles.tileBatch = { left: message.left, rest: message.rest ?? message.left, got: message.got, sent: this.tiles.sent };
				this.tiles.takeTilesSoon();
				break;
			case "discarded":
				if (this.tiles.tileQueue.length) {
					const gone = new Set(message.keys.map(([sc, x, y]) => `${sc},${x},${y}`));
					this.tiles.tileQueue = this.tiles.tileQueue.filter((q) => !gone.has(q.key) || void q.tile.bitmap?.close());
				}
				this.page.forgetTiles(JSON.stringify(message.keys));
				this.frames.drawSoon();
				break;
			case "landed":
				this.page.landed(JSON.stringify(message.ids));
				for (const id of message.ids) this.cardLayer.lifted.delete(id);
				this.frames.draw();
				break;
			case "wanted":
				this.cardPictures.wantPictures(message.urls);
				break;
			case "picture":
				// Asked for before the engines started again, or for an address since let go: not wanted.
				if (!this.cardPictures.picturesAsked.has(message.url)) {
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
				this.cardPictures.picturesPut++;
				this.cardPictures.layOutPicturesSoon();
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
	setDoc(doc: PenDocument | undefined, base: string, edits?: DocEdits, own = false): void {
		if (doc === this.doc && base === this.base) return;
		const before = this.doc;
		this.doc = doc;
		this.base = base;
		/*
		 * What a delete hid while it waited is the drawing's business again: the answer has it gone, or,
		 * after an undo, back. The engines are told (below, after the drawing), or they went on hiding a
		 * restored item until the page was loaded again.
		 */
		const unhide = this.previews.viewState.hidden.length > 0;
		this.previews.viewState.hidden = [];
		if (!this.page) {
			this.faces.prefetchFonts();
			return;
		}
		// Where everything is drawn now, glide included: what this drawing's changes glide from.
		// The person's own edit (a key, a field) was drawn by their hand as it was made: nothing to glide.
		const drawnBefore = this.glides.settling || own ? undefined : this.glides.drawnBoxes();
		/*
		 * A drawing that arrives ends any preview: whatever a drag was showing is now the drawing itself.
		 * The page applies a preview to its own copy and takes it back after, so it is taken back before
		 * the edits rather than over them. Lifted items stay lifted, drawn where the drawing now has them,
		 * until the stage puts the gesture down.
		 */
		this.page.setPreview("null");
		this.cardLayer.shown = undefined;
		if (!doc) this.layout.whole(undefined);
		else if (!before) this.layout.whole(doc);
		else {
			const changes = edits && edits.from === before ? edits.edits : diff(before, doc);
			if (changes.length) {
				const text = JSON.stringify(changes);
				try {
					this.page.applyEdits(text);
					this.post({ type: "edits", edits: text });
				} catch {
					this.layout.whole(doc);
				}
			}
		}
		if (unhide) this.previews.sendView();
		this.layout.laidOut();
		this.faces.needFonts();
		// A drop that moved things glides them in from where they were let go, and any other change from where it was drawn, from this very frame.
		const gliding = this.glides.settling ? this.glides.startGlide() : this.glides.glideFrom(drawnBefore);
		if (!gliding) this.frames.draw();
		// A drag of boards alone that was let go: its arrows are now the drawing's own, routed where the boards landed.
		if (this.cardLayer.cardsOnly && !this.cardLayer.carriedCount) this.cardLayer.landCards();
		else if (this.cardLayer.cardsOnly) this.cardLayer.cardsAnswered = true;
		// A gesture let go: the drawing that answers it is here, so what it lifted goes back into the tiles.
		if (this.glides.settling) {
			this.glides.settling = false;
			this.glides.landing = undefined;
			if (this.cardLayer.lifted.size && !this.cardLayer.cardsOnly) this.post({ type: "drop", ids: [...this.cardLayer.lifted] });
		}
	}


	setView(view: { width: number; height: number }): void {
		this.sheet = undefined;
		this.view = view;
		this.fitCanvases();
		this.sendCamera();
		this.questions.writeHits();
		this.frames.draw();
	}

	/**
	 * The canvas the window's size, in device pixels; the engine's
	 * surface follows in `frame`. It is drawn again for every camera, as one cheap draw of the tiles
	 * and pictures as textured quads, and placed over the window wherever the world has moved
	 * (`place`), as the old engine's was: a canvas a margin bigger than the window, slid during a
	 * pan rather than drawn, made the worker paint that margin too (120 tiles at rest, not 50).
	 */
	private fitCanvases(): void {
		/*
		 * Not before there is a canvas to size: a view set first (the shot page sets it before it attaches the
		 * canvas) recorded the size with nothing sized, so the canvas, attached later, was taken as sized and
		 * kept its own CSS size, its backing's in CSS pixels: at a density of 2 the drawing came out twice as big.
		 */
		if (!this.over) return;
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
	drawRect(): { x: number; y: number; zoom: number; width: number; height: number } {
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
	 * The canvas sits in the world (`CanvasView.tsx`), after the board pages, so it is placed in stage
	 * units at the rectangle it was drawn for and scaled by one over the zoom: the world's transform
	 * undone, so it covers exactly the window.
	 */
	/**
	 * Hold the canvas where it is while the scale moves (`CanvasView`, `holdStill`): the stage leaves the world
	 * where it is too, so the canvas keeps covering the window, and every frame draws the window at the
	 * camera into it as before. Setting its transform at each step, even on a promised layer, made
	 * Chromium rebuild its paint property tree and assign every layer on the page again, a frame's
	 * worth of style and layer work per zoom step (a quarter of a zoom's main thread over 100 cards).
	 */
	holdStill(on: boolean): void {
		if (on === this.still) return;
		this.still = on;
		if (!on) this.frames.draw();
	}
	private still = false;

	place(): boolean {
		const at = this.drawnAt;
		if (!this.over || !at || this.still) return false;
		const transform = `translate(${at.x}px, ${at.y}px) scale(${1 / at.zoom})`;
		// Compared with the one set, not the style's, which the browser writes back rounded.
		if (transform === this.placedAs) return false;
		this.placedAs = transform;
		this.over.style.transform = transform;
		return true;
	}
	private placedAs = "";
	webKit: boolean | undefined;

	setScheme(scheme: "light" | "dark"): void {
		if (scheme === this.scheme) return;
		this.scheme = scheme;
		if (this.page) {
			// The stage is drawn again in the other scheme: cards' colours, papers, ink.
			this.page.setMarkdownReader(cardReader(scheme));
			this.page.setDark(scheme === "dark");
			this.layout.whole(this.doc);
			this.layout.laidOut();
		}
		this.frames.draw();
	}

	/** In the call that moves the board pages, and drawn there, so the two land in one frame. */
	setCamera(camera: Camera): void {
		// Zooming once the zoom changes while the camera moves, until it rests (`setMoving`): a pan at one zoom keeps the exact scale.
		if (this.moving && camera.zoom !== this.camera.zoom) this.zooming = true;
		this.camera = camera;
		this.fastZoom = this.moving && this.zooming && this.zoomRate(performance.now(), camera.zoom) > FAST_ZOOM && knobs.skipLevels;
		clearTimeout(this.fastTimer);
		// Fingers that stop moving but stay down: painted once the zoom has been still a while.
		if (this.fastZoom)
			this.fastTimer = setTimeout(() => {
				this.fastZoom = false;
				this.sendCamera();
			}, FAST_HOLD_MS);
		// A pan inside the sheet: the browser has scrolled it with the world, and there is nothing to draw (`drawRect`).
		if (!this.windowInSheet()) {
			this.sheet = undefined;
			this.frames.draw();
			this.sendCamera();
		}
		/*
		 * The pictures wanted, once a frame: a pinch's two fingers and a trackpad's wheel move the camera
		 * two or three times a frame, and each asked the index and sorted the cards near the window again
		 * (a tenth of a zoom's script time at 100 cards, for a list that could not have changed in between).
		 */
		this.cardPictures.picturesSoon = true;
		this.frames.tickSoon();
		// The click shapes' reach round a line is a screen width: written again once the zoom has drifted far from the one they were made at.
		if (this.placed.size && this.questions.bandZoom > 0 && (camera.zoom > this.questions.bandZoom * 1.25 || camera.zoom < this.questions.bandZoom * 0.8)) this.questions.writeHits();
	}

	/** The editor's overlay as the engine paints it (`edit/core/overlay-json.ts`); the same string again changes nothing. True once the engine has it. */
	private overlayJson: string | undefined;
	setOverlay(json: string): boolean {
		if (!this.page) return false;
		if (json === this.overlayJson) return true;
		this.overlayJson = json;
		this.page.setOverlay(json);
		this.frames.draw();
		return true;
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
			this.cardPictures.wantCardPictures();
			// Drawn again where the camera came to rest, at the tiles' resting scale.
			this.frames.draw();
			// And, a moment later, the pictures held to the budget, after a pan as after a zoom (`fitPictures`).
			this.cardPictures.fitSoon();
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
	 * slows or rests. `knobs.skipLevels = false` paints every level, for measuring.
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
	corner(): { x: number; y: number } {
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
		 * keeps the exact scale. `knobs.halfZoom = false` paints them sharp, for measuring.
		 */
		const half = this.zooming && knobs.halfZoom;
		const sent = { zoom, dpr: half ? dpr / 2 : dpr, moving: this.moving, zooming: this.zooming, fast: this.fastZoom };
		this.post({ type: "camera", x, y, width, height, ...sent });
		const want = this.stageModule?.scaleFor(sent.zoom * sent.dpr, sent.zooming);
		if (want !== undefined && want !== this.tiles.wantScale) {
			this.tiles.wantScale = want;
			this.tiles.dropUnwanted();
		}
	}
	/** The engine's module, for `scaleFor`. */
	private stageModule: StageModule | undefined;


	lowMemory = false;

	// --- cards ---------------------------------------------------------------------------------

	// --- pictures, fonts, icons -----------------------------------------------------------------

	// --- gestures --------------------------------------------------------------------------------


	// --- questions ------------------------------------------------------------------------------

	dispose(): void {
		this.disposed = true;
		cancelAnimationFrame(this.tiles.fadeFrame);
		cancelAnimationFrame(this.frames.tickFrame);
		// Pictures still waiting for the GPU let go of their bitmaps (each sees the engine is gone).
		cancelAnimationFrame(this.cardPictures.putFrame);
		for (const put of this.cardPictures.putQueue.splice(0)) put();
		this.tiles.takeChannel?.port1.close();
		this.tiles.dropTileQueue();
		this.unwatch?.();
		clearTimeout(this.cardPictures.fitTimer);
		clearTimeout(this.tiles.showAnyway);
		clearTimeout(this.fastTimer);
		this.worker?.terminate();
		this.worker = undefined;
		setCanvasWords(undefined, this.layout.words);
		this.page?.free();
		this.page = undefined;
		this.questions.hits?.replaceChildren();
	}
}

/**
 * A module worker at its address, or, where the page may not start one from there, from a script of
 * its own that imports it. The canvas frame is sandboxed with an origin of its own, and a page may start
 * a worker only from its own origin; a worker made from a `blob:` the page wrote is its own, and its
 * `import` of the real script crosses with CORS like any other module (`frame/`).
 */
/** Start the engine ahead of any canvas (`warm.ts`): what a frame kept spare does while nothing waits for it. */
export const warmCanvasEngine = (): void => warmEngine(() => startWorker(renderWorkerUrl), moduleOf);

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
