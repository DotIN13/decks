import { knobs, probes } from "../base/debug.ts";
import type { TileFromWorker } from "./types.ts";
import { ENGINE } from "./device.ts";
import type { CanvasEngine } from "./engine.ts";

/**
 * How much of a frame the page spends taking the worker's tiles in (`takeTiles`): this many
 * milliseconds, and under WebKit, whose clock counts whole milliseconds, no more than `bytes` tiles
 * of bytes (about 0.3 ms each on an iPad mini) or `pictures` tiles of pictures (about 2 ms) a frame
 * either; what is left waits for the next frame, the window's tiles first. A pinch's tiles taken in
 * all at once held frames on an iPad mini for 40 to 100 ms. Three tiles of bytes a frame, tried
 * first, made a pinch's tiles take 300 ms to come in where all at once took 65 (WebKit as an iPad
 * mini on a Mac). `knobs.tileBudget` changes it, for measuring.
 */
const TILE_BUDGET = { ms: 4, bytes: 12, pictures: 2 };

const tileBudget = (): typeof TILE_BUDGET => ({ ...TILE_BUDGET, ...knobs.tileBudget });

/** A tile's place on the stage, `[x, y, side]`, from its key (`scale` is an `f32`'s bits). */
const tileScale = new DataView(new ArrayBuffer(4));

function tileArea(t: { scale: number; x: number; y: number }): [number, number, number] {
	tileScale.setUint32(0, t.scale);
	const side = TILE_SIDE / tileScale.getFloat32(0);
	return [t.x * side, t.y * side, side];
}

/** A level whose tiles stop coming before they cover the window is shown anyway this long after the last. */
const SHOW_ANYWAY_MS = 2000;

/** WebKit (Safari, and every browser on iOS and iPadOS), as `render/device.ts` tells it. */
export function webKit(): boolean {
	return ENGINE === "webkit";
}

const TILE_SIDE = 512;

/**
 * The tiles the worker paints: which scale is wanted for the zoom, taking what the worker sends
 * within a frame's budget, dropping levels no longer wanted, fading a level in, and showing one
 * anyway when its tiles stop coming. A part of the engine (`engine.ts`), which it reaches through
 * `of`.
 */
export class EngineTiles {
	constructor(private readonly of: CanvasEngine) {}

	/** The scale the worker's latest camera wants its tiles at (`scaleFor`, an `f32`'s bits), and the overview's (`overviewScale`). */
	wantScale: number | undefined;

	overviewScale = 0;

	/** Whether a tile is still wanted: at the scale the latest camera wants, or the overview's. Tiles of a scale the zoom has left are not taken in. */
	wanted(t: { scale: number }): boolean {
		return this.wantScale === undefined || t.scale === this.wantScale || t.scale === this.overviewScale;
	}

	/** Let go of the tiles waiting to be taken in that the latest camera no longer wants, and tell the worker, which paints them again if they are wanted again. */
	dropUnwanted(): void {
		if (!this.tileQueue.length) return;
		const gone: Array<[number, number, number]> = [];
		this.tileQueue = this.tileQueue.filter((q) => {
			if (this.wanted(q.tile)) return true;
			q.tile.bitmap?.close();
			gone.push([q.tile.scale, q.tile.x, q.tile.y]);
			return false;
		});
		if (gone.length) this.of.post({ type: "dropped", keys: gone });
	}

	/**
	 * A card's picture replacing one the engine held fades in over it (`Page::fade_pictures`, 180 ms),
	 * so a rung swap at rest never pops: a frame is drawn for each step of the fade until none is left.
	 */
	fadeFrame = 0;

	private fadeLast = 0;

	fadeSoon(): void {
		this.of.frames.draw();
		if (this.fadeFrame || this.of.disposed) return;
		this.fadeLast = performance.now();
		const step = () => {
			this.fadeFrame = 0;
			if (this.of.disposed || !this.of.page) return;
			const now = performance.now();
			const more = this.of.page.fadePictures(Math.min(100, now - this.fadeLast));
			this.fadeLast = now;
			this.of.frames.draw();
			// For the checks: how many fade frames have run (`touch-step5` probe).
			probes.pictureFades++;
			if (more) this.fadeFrame = requestAnimationFrame(step);
		};
		this.fadeFrame = requestAnimationFrame(step);
	}

	/** Tiles from the worker not yet taken in, oldest first, and what it said with the latest batch. */
	tileQueue: Array<{ key: string; tile: TileFromWorker }> = [];

	tileBatch: { left: number; rest: number; got: number; sent: number } | undefined;

	private coarseClock: boolean | undefined;

	/**
	 * Take tiles in soon, in a task of their own (`takeTiles`), and draw them at the next frame
	 * (`tick`): never in the frame's callback before its draw, where a copy that waited on the GPU
	 * process (12 ms once, in Chromium) made that frame late, and the draw after it too. A frame's
	 * share (`TILE_BUDGET`) is spent once, in one or more tasks after its draw; what is left waits
	 * for the next frame's.
	 */
	takeTilesSoon(): void {
		if (this.takePosted || this.of.disposed || !this.tileQueue.length) return;
		const budget = tileBudget();
		if (this.frameTaken.ms >= budget.ms) return void this.of.frames.tickSoon();
		this.takePosted = true;
		if (!this.takeChannel) {
			this.takeChannel = new MessageChannel();
			this.takeChannel.port1.onmessage = () => {
				this.takePosted = false;
				if (!this.of.disposed) this.takeTiles();
			};
		}
		this.takeChannel.port2.postMessage(0);
	}

	takeChannel: MessageChannel | undefined;

	private takePosted = false;

	/** What taking tiles in has spent of this frame's share since its draw. */
	frameTaken = { ms: 0, bytes: 0, pictures: 0 };

	/**
	 * Take in the tiles waiting, the window's first, until this frame's share (`TILE_BUDGET`) is
	 * spent, and draw them at the next frame; what is left is taken after that frame's draw. When none is left, what the worker
	 * said with its latest batch holds: the window sharp (`sharpAt`), or filled in (`settledAt`).
	 */
	private takeTiles(): void {
		const page = this.of.page;
		if (!page || this.of.paused) return this.dropTileQueue();
		const queue = this.tileQueue;
		if (!queue.length) return;
		const budget = tileBudget();
		// Counted too where the clock is coarse (WebKit, where tiles come as bytes).
		const coarse = (this.coarseClock ??= webKit());
		// The window's tiles first, in the order they came.
		if (queue.length > 1) {
			const { x, y } = this.of.corner();
			const w = this.of.view.width / this.of.camera.zoom;
			const h = this.of.view.height / this.of.camera.zoom;
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
				probes.sheet.pixelTiles = (probes.sheet.pixelTiles ?? 0) + 1;
				bytes++;
			}
			taken++;
		}
		this.frameTaken = { ms: spent.ms + performance.now() - start, bytes, pictures };
		probes.sheet.tiles = (probes.sheet.tiles ?? 0) + taken;
		const batch = this.tileBatch;
		if (!this.tileQueue.length && batch) {
			this.tileBatch = undefined;
			this.of.settledNext = batch.rest === 0 && batch.got >= this.posted && this.of.faces.fontsPending === 0;
			if (batch.left === 0 && batch.got >= this.postedContent && this.of.faces.fontsPending === 0) this.of.sharpNext = true;
			this.of.frames.seenAtDraw = batch.sent;
		}
		// Drawn in the next frame's one draw (`tick`), which takes what is left after it.
		if (taken) this.of.frames.draw();
		else this.of.frames.tickSoon();
	}

	/**
	 * Once the stage is first sharp, in idle time before any gesture, both engines make what a
	 * first zoom or drag would otherwise make in its first frames (`PageEngine::warm`,
	 * `WorkerEngine::warm`): every pipeline they draw with, the glyph textures, spare tile textures
	 * (not on a device short of memory).
	 * Again after the engines start again (a lost device). `knobs.warm = false` leaves it out, for measuring.
	 */
	warmSoon(): void {
		if (this.warmed || !knobs.warm) return;
		this.warmed = true;
		const idle = (globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
		const warm = () => {
			if (this.of.disposed || !this.of.page) return;
			this.of.page.warm(!this.of.lowMemory);
			this.of.post({ type: "warm" });
		};
		if (idle) idle(warm, { timeout: 500 });
		else setTimeout(warm, 50);
	}

	warmed = false;

	/**
	 * Show the level wanted in `SHOW_ANYWAY_MS` whether it covers the window or not, unless another of
	 * its tiles comes first: the old engine's word that a level was whole could fail to come, and so
	 * can a tile here.
	 */
	private showAnywaySoon(): void {
		clearTimeout(this.showAnyway);
		this.showAnyway = setTimeout(() => {
			if (this.of.disposed || !this.of.page) return;
			this.of.page.showWanted();
			this.of.frames.draw();
		}, SHOW_ANYWAY_MS);
	}

	showAnyway: ReturnType<typeof setTimeout> | undefined;

	/** Let go of the tiles waiting: the engine they were for is gone. */
	dropTileQueue(): void {
		for (const q of this.tileQueue) q.tile.bitmap?.close();
		this.tileQueue = [];
		this.tileBatch = undefined;
	}

	/** Tiles the page holds: none until the worker's first ones arrive. */
	tileCount(): number {
		return this.of.page?.tileCount() ?? 0;
	}

	/** A mark for what has been sent so far: `shows(mark)` once a frame painted after all of it is on screen. */
	mark(): number {
		return this.sent;
	}

	shows(mark: number): boolean {
		return this.shownSeen >= mark;
	}

	/** The engine's `pageMarks` when `pictured` and `carrying` were last read: read again only when it moves. */
	marksSeen = -1;

	sent = 0;

	shownSeen = 0;

	/** Messages posted to the worker that is running now, and that count when the last one that changes what it paints was posted. */
	posted = 0;

	postedContent = 0;

	/** Tiles from now on as their bytes (`pixelsFirst`), or as pictures: for measures to switch in one page. */
	tilePixels(on: boolean): void {
		this.of.post({ type: "pixels", on });
	}
}
