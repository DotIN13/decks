/**
 * The canvas engine's life: attaching its canvases, opening the Rust page engine and its render
 * worker, the worker's messages, and losing, restarting and disposing of them.
 */
import type { StageEngine as Engine } from "./engine.ts";
import { knobs, probes } from "../debug.ts";
import { detect, type StageModule } from "./backends/detect.ts";
import { noticeFor } from "./backends/notice.ts";
import renderWorkerUrl from "./render.worker.ts?worker&url";
import type { FromWorker, ToWorker } from "./types.ts";
import type { PageEngine } from "@decks/engine";
import { ENGINE, PICTURES, readGpuClass } from "./device.ts";
import { cardReader, mathTypesetter } from "./reader.ts";
import { setStageWords } from "./measure.ts";

/** The empty drawing: what both engines hold before the server's comes. */
export const EMPTY = '{"version":"2.14","children":[]}';
/** WebKit (Safari, and every browser on iOS and iPadOS), as `render/device.ts` tells it. */
export function webKit(): boolean {
	return ENGINE === "webkit";
}

// Opening: the canvases, the Rust page engine and its worker, and how tiles cross.
/**
 * The canvas, once the stage has made it: among the board pages, after them. The boards'
 * pictures, the drawing and what a gesture moves are all drawn on it.
 */
export function attachCanvas(e: Engine, canvas: HTMLCanvasElement): void {
	e.over = canvas;
	if (!e.started) {
		e.started = true;
		void e.start(canvas).catch((error: unknown) => e.fail(error));
	}
}

export async function start(e: Engine, over: HTMLCanvasElement): Promise<void> {
	try {
		await e.open(over);
	} catch (error) {
		// A worker started for an engine that did not come up is let go with it.
		if (!e.page) {
			e.worker?.terminate();
			e.worker = undefined;
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
export async function open(e: Engine, over: HTMLCanvasElement): Promise<void> {
	e.prefetchFonts();
	e.worker = startWorker(renderWorkerUrl);
	e.posted = 0;
	e.postedContent = 0;
	e.worker.onmessage = ({ data }: MessageEvent<FromWorker>) => e.receive(data);
	const found = (e.detected ??= await detect());
	const stage = await found.backend.load();
	if (e.disposed) return;
	e.stageModule = stage;
	e.post({ type: "boot", backend: found.backend.name, lowMemory: found.lowMemory, module: moduleOf(stage) });
	e.fitCanvases();
	const gpu = await stage.openStage(over, over.width, over.height, found.backend.name, found.lowMemory);
	e.lowMemory = !!found.lowMemory;
	// Fonts already handed to an engine before (this is a restart) are read from their files again.
	await Promise.all(e.fonts.map(async (font) => (font.bytes ??= new Uint8Array(await font.blob.arrayBuffer()))));
	if (e.disposed) return gpu.free();
	e.backend = gpu.backend();
	e.maxPicture = gpu.maxPictureSize();
	e.pictures = PICTURES[await readGpuClass()];
	if (e.disposed) return gpu.free();
	const doc = e.doc ? JSON.stringify(e.doc) : EMPTY;
	probes.rust = e;
	const self = e;
	probes.engine = {
		stats: () => ({ tiles: e.page?.tileCount() ?? 0, drawn: [e.lastOps, e.lastOps], engine: "rust", backend: e.backend, workerBackend: e.workerBackend, maxPicture: e.maxPicture, restarts: e.restarts, pictures: e.picturesPut, paused: e.paused, cardsSent: { ...e.cardsSent } }),
		/** The boards a drag carries as their picture, and by how far. */
		get carried() {
			// Live pages carried as their picture, and boards already drawn as pictures that the drag moves.
			const drawn = new Set([...(JSON.parse(self.page?.carrying() ?? "[]") as string[]), ...self.carriedPaths.filter((path) => (JSON.parse(self.page?.pictured() ?? "[]") as string[]).includes(path))]);
			return { paths: drawn, ...self.carriedBy };
		},
	};
	// Made empty and given its readers first, then the drawing: each reader given lays the drawing out again.
	e.page = new stage.PageEngine(EMPTY, e.scheme === "dark", `s${Math.random().toString(36).slice(2, 7)}`);
	e.warmed = false;
	e.page.setGpu(gpu);
	e.page.setMarkdownReader(cardReader(e.scheme));
	e.page.setMath(mathTypesetter());
	if (doc !== EMPTY) e.page.setDocument(doc);
	e.paused = false;
	// Fonts already here go to both engines now; those still coming (asked for before the engine
	// was up, `prefetchFonts`, or by its first layout) the worker waits for before it paints.
	e.giveFonts(e.fonts, false);
	setStageWords(e.words);
	e.needFonts();
	e.post({ type: "init", doc, dark: e.scheme === "dark", backend: e.backend, lowMemory: found.lowMemory, fontsDue: e.fontsPending > 0, docDue: !e.doc, pixels: pixelsFirst() });
	e.postFonts(e.fonts);
	// The camera now, not when the worker says it is ready: a page busy laying out fonts heard that late.
	e.sendCamera();
	e.unwatch = found.backend.watch(over, { lost: () => e.lose(), restored: () => void e.restart(), isLost: () => e.page?.lost() ?? false });
	e.viewKey = "";
	e.sendView();
	e.cardKey = "";
	e.liveKey = "";
	e.setCards(e.placedCards);
	e.laidOut();
	e.draw();
}

/** The engine's compiled module, for the worker to start from (`boot`). */
export function moduleOf(stage: StageModule): WebAssembly.Module | undefined {
	const module: unknown = stage.engineModule();
	return module instanceof WebAssembly.Module ? module : undefined;
}

/**
 * A module worker at its address, or, where the page may not start one from there, from a script of
 * its own that imports it. The canvas frame is sandboxed with an origin of its own, and a page may start
 * a worker only from its own origin; a worker made from a `blob:` the page wrote is its own, and its
 * `import` of the real script crosses with CORS like any other module (`frame/`).
 */
export function startWorker(url: string): Worker {
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
	// `?tiles=bitmaps` or `?tiles=pixels` on the page's address (carried into the frame, `framed-editor.tsx`), for measuring one way on a device that takes the other.
	const asked = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("tiles");
	if (asked === "bitmaps") return false;
	if (asked === "pixels") return true;
	return webKit();
}

/** Tiles from now on as their bytes (`pixelsFirst`), or as pictures: for measures to switch in one page. */
export function tilePixels(e: Engine, on: boolean): void {
	e.post({ type: "pixels", on });
}

/** How long after a camera change the worker paints one tile a batch (`AFTER_MOVE_MS` in `render.worker.ts`): for measures to switch in one page. */
export function afterMove(e: Engine, ms: number): void {
	e.post({ type: "afterMove", ms });
}

// When something fails: recovering, losing the device, restarting; and disposing.
/**
 * An error out of an engine: it cannot be trusted to draw again, so both are started again, as
 * after a lost GPU. The drawing, boards, camera and fonts are held here and given back to them.
 */
export function recover(e: Engine, error: unknown, where: string): void {
	const message = String((error as Error)?.message ?? error);
	if (e.recovery.note() === "stop") {
		console.error(`stage engine: ${where} failed again (${message}); stopped`);
		e.lose();
		e.fail(new Error(`The stage kept failing (${message}). Reload the page to draw it again.`));
		return;
	}
	console.error(`stage engine: ${where} failed (${message}); starting the engines again`);
	void e.restart();
}

export function fail(e: Engine, error: unknown): void {
	console.error(`stage engine: ${String((error as Error)?.message ?? error)}`);
	e.failed?.(noticeFor(error));
}

/**
 * The device is gone (`backends/webgpu.ts`, `backends/webgl.ts`), or the worker's: nothing more
 * is drawn, and the engines are let go while their context is lost, so what they free is freed
 * on nothing. The drawing, the boards, the camera and the fonts stay here for `restart`.
 */
export function lose(e: Engine): void {
	if (e.paused) return;
	e.paused = true;
	e.dropTileQueue();
	e.worker?.terminate();
	e.worker = undefined;
	setStageWords(undefined, e.words);
	e.page?.free();
	e.page = undefined;
	e.picturesAsked.clear();
	for (const key of e.cardByKey.keys()) e.unpictured.add(key);
	// What the GPU held went with the context: the cards' pictures are fetched again from the bottom rung.
	e.pictureBytes.clear();
	e.heldWidth.clear();
	e.compressedSize.clear();
	e.iconsAsked.clear();
	e.lifted.clear();
	e.picturedKey = "";
	e.carryingKey = "";
	e.marksSeen = -1;
	e.drawnAt = undefined;
	e.shown = undefined;
}

/** Start both engines again on the same canvas, once its context is back. */
export async function restart(e: Engine): Promise<void> {
	if (e.disposed || e.restarting || !e.over) return;
	e.lose();
	// The new engine watches its own device (`start`).
	e.unwatch?.();
	e.unwatch = undefined;
	e.restarting = true;
	e.restarts++;
	try {
		await e.start(e.over);
	} catch (error) {
		e.fail(error);
	} finally {
		e.restarting = false;
	}
}

export function dispose(e: Engine): void {
	e.disposed = true;
	cancelAnimationFrame(e.fadeFrame);
	cancelAnimationFrame(e.tickFrame);
	// Pictures still waiting for the GPU let go of their bitmaps (each sees the engine is gone).
	cancelAnimationFrame(e.putFrame);
	for (const put of e.putQueue.splice(0)) put();
	e.takeChannel?.port1.close();
	e.dropTileQueue();
	e.unwatch?.();
	clearTimeout(e.fitTimer);
	clearTimeout(e.showAnyway);
	clearTimeout(e.fastTimer);
	e.worker?.terminate();
	e.worker = undefined;
	setStageWords(undefined, e.words);
	e.page?.free();
	e.page = undefined;
	e.hits?.replaceChildren();
}

// The worker's messages.
export function post(e: Engine, message: ToWorker, transfer: Transferable[] = []): void {
	if (e.worker) {
		e.worker.postMessage(message, transfer);
		e.posted++;
		if (message.type !== "camera" && message.type !== "dropped") e.postedContent = e.posted;
	}
	e.sent++;
}

export function receive(e: Engine, message: FromWorker): void {
	if (e.disposed || !e.page) {
		if (message.type === "tiles") for (const t of message.tiles) t.bitmap?.close();
		return;
	}
	switch (message.type) {
		case "tiles":
			receiveTiles(e, message);
			break;
		case "discarded":
			if (e.tileQueue.length) {
				const gone = new Set(message.keys.map(([sc, x, y]) => `${sc},${x},${y}`));
				e.tileQueue = e.tileQueue.filter((q) => !gone.has(q.key) || void q.tile.bitmap?.close());
			}
			e.page.forgetTiles(JSON.stringify(message.keys));
			e.drawSoon();
			break;
		case "landed":
			e.page.landed(JSON.stringify(message.ids));
			for (const id of message.ids) e.lifted.delete(id);
			e.draw();
			break;
		case "wanted":
			e.wantPictures(message.urls);
			break;
		case "picture":
			receivePicture(e, e.page, message);
			break;
		case "resync":
			e.post({ type: "doc", doc: e.doc ? JSON.stringify(e.doc) : EMPTY, dark: e.scheme === "dark" });
			break;
		case "error":
			// The worker's engine failed (a tile, a picture): it paints nothing more until both start again.
			e.recover(new Error(message.message), "the render worker");
			break;
		case "failed":
			e.fail(message.message);
			break;
		case "lost":
			// The worker's device went: both start again, so the tiles and the page agree.
			void e.restart();
			break;
		case "ready":
			e.workerBackend = message.backend;
			break;
	}
}

/** Tiles from the worker: queued to be taken in a few a frame, or the word that the window is filled in. */
function receiveTiles(e: Engine, message: Extract<FromWorker, { type: "tiles" }>): void {
	// Nothing painted (the worker says it has nothing left for this camera) and nothing waiting: the frame on screen, or the one coming, is filled in.
	if (!message.tiles.length && !e.tileQueue.length) {
		e.settledNext = (message.rest ?? message.left) === 0 && message.got >= e.posted && e.fontsPending === 0;
		if (e.settledNext && !e.dirty) {
			e.settledNext = false;
			probes.sheet.settledAt = performance.now();
		}
		return;
	}
	if (message.overview !== undefined) e.overviewScale = message.overview;
	// Taken in at the next frames, a few a frame (`takeTiles`); a tile painted again replaces the one waiting.
	// One of a scale the zoom has left since it was asked for is let go of at once.
	const unwanted: Array<[number, number, number]> = [];
	for (const t of message.tiles) {
		if (!e.wanted(t)) {
			t.bitmap?.close();
			unwanted.push([t.scale, t.x, t.y]);
			continue;
		}
		const key = `${t.scale},${t.x},${t.y}`;
		const i = e.tileQueue.findIndex((q) => q.key === key);
		if (i >= 0) e.tileQueue.splice(i, 1)[0]?.tile.bitmap?.close();
		e.tileQueue.push({ key, tile: t });
	}
	if (unwanted.length) e.post({ type: "dropped", keys: unwanted });
	// What the worker says of the latest batch holds once every tile before it is in.
	e.tileBatch = { left: message.left, rest: message.rest ?? message.left, got: message.got, sent: e.sent };
	e.takeTilesSoon();
}

/** A picture the worker fetched, put into the page engine if it is still wanted. */
function receivePicture(e: Engine, page: PageEngine, message: Extract<FromWorker, { type: "picture" }>): void {
	// Asked for before the engines started again, or for an address since let go: not wanted.
	if (!e.picturesAsked.has(message.url)) {
		message.bitmap.close();
		return;
	}
	try {
		page.putPicture(message.url, message.bitmap, message.width, message.height, true);
	} catch (error) {
		message.bitmap.close();
		e.recover(error, `the picture ${message.url}`);
		return;
	}
	e.picturesPut++;
	e.layOutPicturesSoon();
}
