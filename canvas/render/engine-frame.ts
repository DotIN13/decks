/**
 * The canvas engine's frames: the camera and its glide, the tiles the worker paints for it, and
 * drawing a frame of both engines' canvases.
 */
import { EMPTY, SHEET_MARGIN, type StageEngine as Engine, webKit } from "./engine.ts";
import { knobs, probes } from "../debug.ts";
import { glideShifts, glideStep, type Shift, shiftsFrom } from "../camera/glide.ts";
import { type Frame, isArrow, type PenDocument } from "@decks/pen";
import type { PenPreview, TileFromWorker } from "./types.ts";
import { cardReader } from "./reader.ts";
import type { Camera } from "@decks/protocol-old";

/** A level whose tiles stop coming before they cover the window is shown anyway this long after the last. */
export const SHOW_ANYWAY_MS = 2000;

/**
 * How much of a frame the page spends taking the worker's tiles in (`takeTiles`): this many
 * milliseconds, and under WebKit, whose clock counts whole milliseconds, no more than `bytes` tiles
 * of bytes (about 0.3 ms each on an iPad mini) or `pictures` tiles of pictures (about 2 ms) a frame
 * either; what is left waits for the next frame, the window's tiles first. A pinch's tiles taken in
 * all at once held frames on an iPad mini for 40 to 100 ms. Three tiles of bytes a frame, tried
 * first, made a pinch's tiles take 300 ms to come in where all at once took 65 (WebKit as an iPad
 * mini on a Mac). `knobs.tileBudget` changes it, for measuring.
 */
export const TILE_BUDGET = { ms: 4, bytes: 12, pictures: 2 };

/** A zoom faster than this many doublings a second paints no new level (`zoomRate`), over this window of time; and is painted after this long still. */
export const FAST_ZOOM = 1;

export const ZOOM_RATE_MS = 100;

export const FAST_HOLD_MS = 250;

export const tileBudget = (): typeof TILE_BUDGET => ({ ...TILE_BUDGET, ...knobs.tileBudget });

/** A tile's place on the stage, `[x, y, side]`, from its key (`scale` is an `f32`'s bits). */
export const tileScale = new DataView(new ArrayBuffer(4));

// The camera: where it looks, whether it moves, and what the worker is told.
/** In the call that moves the board pages, and drawn there, so the two land in one frame. */
export function setCamera(e: Engine, camera: Camera): void {
	// Zooming once the zoom changes while the camera moves, until it rests (`setMoving`): a pan at one zoom keeps the exact scale.
	if (e.moving && camera.zoom !== e.camera.zoom) e.zooming = true;
	e.camera = camera;
	e.fastZoom = e.moving && e.zooming && e.zoomRate(performance.now(), camera.zoom) > FAST_ZOOM && knobs.skipLevels;
	clearTimeout(e.fastTimer);
	// Fingers that stop moving but stay down: painted once the zoom has been still a while.
	if (e.fastZoom)
		e.fastTimer = setTimeout(() => {
			e.fastZoom = false;
			e.sendCamera();
		}, FAST_HOLD_MS);
	// A pan inside the sheet: the browser has scrolled it with the world, and there is nothing to draw (`drawRect`).
	if (!e.windowInSheet()) {
		e.sheet = undefined;
		e.draw();
		e.sendCamera();
	}
	/*
	 * The pictures wanted, once a frame: a pinch's two fingers and a trackpad's wheel move the camera
	 * two or three times a frame, and each asked the index and sorted the cards near the window again
	 * (a tenth of a zoom's script time at 100 cards, for a list that could not have changed in between).
	 */
	e.picturesSoon = true;
	e.tickSoon();
	// The click shapes' reach round a line is a screen width: written again once the zoom has drifted far from the one they were made at.
	if (e.placed.size && e.bandZoom > 0 && (camera.zoom > e.bandZoom * 1.25 || camera.zoom < e.bandZoom * 0.8)) e.writeHits();
}

export const TILE_SIDE = 512;

export function setMoving(e: Engine, moving: boolean): void {
	if (moving === e.moving) return;
	e.moving = moving;
	if (!moving) {
		e.zooming = false;
		e.fastZoom = false;
		clearTimeout(e.fastTimer);
	}
	// At rest, the sheet is placed round the camera again, with its margin on every side.
	if (!moving) e.sheet = undefined;
	e.sendCamera();
	if (!moving) {
		e.wantCardPictures();
		// Drawn again where the camera came to rest, at the tiles' resting scale.
		e.draw();
		// And, a moment later, the pictures held to the budget, after a pan as after a zoom (`fitPictures`).
		e.fitSoon();
	}
}

export function setScheme(e: Engine, scheme: "light" | "dark"): void {
	if (scheme === e.scheme) return;
	e.scheme = scheme;
	if (e.page) {
		// The stage is drawn again in the other scheme: cards' colours, papers, ink.
		e.page.setMarkdownReader(cardReader(scheme));
		e.page.setDark(scheme === "dark");
		e.whole(e.doc);
		e.laidOut();
	}
	e.draw();
}

export function setOverlay(e: Engine, json: string): boolean {
	if (!e.page) return false;
	if (json === e.overlayJson) return true;
	e.overlayJson = json;
	e.page.setOverlay(json);
	e.draw();
	return true;
}

/**
 * The canvas sits in the world (`CanvasView.tsx`), after the board pages, so it is placed in stage
 * units at the rectangle it was drawn for and scaled by one over the zoom: the world's transform
 * undone, so it covers exactly the window.
 */
export function place(e: Engine): boolean {
	const at = e.drawnAt;
	if (!e.over || !at || e.still) return false;
	const transform = `translate(${at.x}px, ${at.y}px) scale(${1 / at.zoom})`;
	// Compared with the one set, not the style's, which the browser writes back rounded.
	if (transform === e.placedAs) return false;
	e.placedAs = transform;
	e.over.style.transform = transform;
	return true;
}

/**
 * Hold the canvas where it is while the scale moves (`Stage`, `holdStill`): the stage leaves the world
 * where it is too, so the canvas keeps covering the window, and every frame draws the window at the
 * camera into it as before. Setting its transform at each step, even on a promised layer, made
 * Chromium rebuild its paint property tree and assign every layer on the page again, a frame's
 * worth of style and layer work per zoom step (a quarter of a zoom's main thread over 100 cards).
 */
export function holdStill(e: Engine, on: boolean): void {
	if (on === e.still) return;
	e.still = on;
	if (!on) e.draw();
}

export function whole(e: Engine, doc: PenDocument | undefined): void {
	const text = doc ? JSON.stringify(doc) : EMPTY;
	e.page?.setDocument(text);
	// The fonts its words name are asked for first, so a worker still to paint its first view hears
	// they are coming before it has the drawing, and waits for them rather than paint it twice.
	e.needFonts();
	e.post({ type: "doc", doc: text, dark: e.scheme === "dark" });
}

/** Whether the window, at the camera now, is still inside the sheet. */
export function windowInSheet(e: Engine): boolean {
	const at = e.sheet;
	if (!at || at.zoom !== e.camera.zoom || !e.view.width) return false;
	const w = Math.round(e.view.width * (1 + 2 * SHEET_MARGIN)) / at.zoom;
	const h = Math.round(e.view.height * (1 + 2 * SHEET_MARGIN)) / at.zoom;
	const c = e.corner();
	return c.x >= at.x && c.y >= at.y && c.x + e.view.width / at.zoom <= at.x + w && c.y + e.view.height / at.zoom <= at.y + h;
}

export function sendCamera(e: Engine): void {
	if (!e.view.width) return;
	const { x, y, zoom, width, height } = e.drawRect();
	const dpr = Math.min(2, devicePixelRatio || 1);
	/*
	 * While the zoom changes, by any means (fingers, a trackpad, the wheel, keys, a glide), tiles at
	 * half the screen's density: a quarter of the pixels a tile, and the sharp ones once the zoom
	 * rests. A pinch on an iPad mini asked for 35 to 135 tiles, each about 2 ms of the worker's time
	 * and a copy into the page's texture; text is soft only while the zoom moves. A pan at one zoom
	 * keeps the exact scale. `knobs.halfZoom = false` paints them sharp, for measuring.
	 */
	const half = e.zooming && knobs.halfZoom;
	const sent = { zoom, dpr: half ? dpr / 2 : dpr, moving: e.moving, zooming: e.zooming, fast: e.fastZoom };
	e.post({ type: "camera", x, y, width, height, ...sent });
	const want = e.stageModule?.scaleFor(sent.zoom * sent.dpr, sent.zooming);
	if (want !== undefined && want !== e.wantScale) {
		e.wantScale = want;
		e.dropUnwanted();
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
export function zoomRate(e: Engine, now: number, zoom: number): number {
	const trail = e.zoomTrail;
	const level = Math.log2(zoom);
	while (trail.length && trail[0]![0] < now - ZOOM_RATE_MS) trail.shift();
	trail.push([now, level]);
	const from = trail[0]!;
	if (now - from[0] < 16) return Infinity;
	return (Math.abs(level - from[1]) * 1000) / (now - from[0]);
}

/** The stage point at the window's top-left, from the camera's centre. */
export function corner(e: Engine): { x: number; y: number } {
	return { x: e.camera.x - e.view.width / 2 / e.camera.zoom, y: e.camera.y - e.view.height / 2 / e.camera.zoom };
}

// Glides: a change of place eased over a few frames.
/**
 * Whether changes glide at all: not when the person asked their system for less motion, and not when
 * a check or a page turned it off (`knobs.noGlide`). A drop still lands where it is dropped.
 */
export function glidesWanted(): boolean {
	if (knobs.noGlide) return false;
	return typeof matchMedia !== "function" || !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The drawing that answers a drop is laid out: everything that moved glides from where it was let
 * go to where it is now (`camera/glide.ts`). Shown before this drawing's first frame, so nothing is
 * drawn where it lands before it has glided there. False when nothing moved.
 */
export function startGlide(e: Engine): boolean {
	const landing = e.landing;
	e.landing = undefined;
	if (!landing || !e.page) return false;
	const shifts = glideShifts(landing, (id) => e.placed.get(id)?.box, (id) => e.placed.get(id)?.parent);
	return e.beginGlide(shifts);
}

/**
 * Any other new drawing (an agent's edit, a friend's through Studio, undo): everything drawn
 * somewhere else before glides from there, and what appeared rises in. Not while the camera moves
 * (it would fight the pan), not while a gesture is showing its own preview, and not for a change
 * of more than `MOST_GLIDING` items, which is a canvas changing whole.
 */
export function glideFrom(e: Engine, before: Map<string, Frame> | undefined): boolean {
	/*
	 * Not while a gesture is showing its own preview, nor with a drag of cards in hand: the server's
	 * answers to its steps land where the hand has them. A pan is no reason not to: the shifts are in
	 * canvas units and ride the scroll, and an agent's edit that lands while the person pans to follow
	 * it (or while a flick still coasts) used to jump in.
	 */
	if (!before || !e.page || e.shown !== undefined || e.carriedCount > 0 || e.cardsOnly || !glidesWanted()) return false;
	const appeared: string[] = [];
	for (const [id, one] of e.placed) if (!one.parent && !before.has(id)) appeared.push(id);
	// What is still fading in from the last drawing keeps its fade (`shiftsFrom`).
	const fading = new Map<string, number>();
	for (const [id, one] of e.glide?.shifts ?? []) if (one.fade !== undefined) fading.set(id, one.fade);
	const shifts = shiftsFrom(before, (id) => e.placed.get(id)?.box, (id) => e.placed.get(id)?.parent, appeared, fading);
	return e.beginGlide(shifts);
}

/**
 * Run a glide: each frame the shifts decay (`glideStep`) and what is left is shown as a preview,
 * the items lifted and drawn with their offset, an appeared one with its opacity still coming;
 * when nothing is left the preview ends, which puts the items down into the tiles.
 */
export function beginGlide(e: Engine, shifts: Map<string, Shift>): boolean {
	// An arrow never glides on its own: it is bent from its ends, which do (`bend`), and a route the server changed is drawn at once.
	for (const id of [...shifts.keys()]) {
		const node = e.placed.get(id)?.node;
		if (node && isArrow(node)) shifts.delete(id);
	}
	if (!shifts.size || !e.page) return false;
	if (e.glide) cancelAnimationFrame(e.glide.frame);
	// What glides now, for the checks (`smooth-edits.mjs`).
	probes.glide = () => (e.glide ? [...e.glide.shifts] : []);
	e.settling = false;
	const show = (now: Map<string, Shift>) => {
		const preview = new Map<string, PenPreview>();
		const offsets = new Map<string, { dx: number; dy: number }>();
		for (const [id, one] of now) {
			offsets.set(id, { dx: one.dx, dy: one.dy });
			const own = e.placed.get(id)?.node as { opacity?: unknown } | undefined;
			const base = typeof own?.opacity === "number" ? own.opacity : 1;
			preview.set(id, { dx: one.dx, dy: one.dy, ...(one.fade !== undefined ? { set: { opacity: Math.round(base * (1 - one.fade) * 1000) / 1000 } } : {}) });
		}
		e.showPreview(preview);
		e.onGlide?.(offsets);
	};
	show(shifts);
	const step = () => {
		const glide = e.glide;
		if (!glide || e.disposed) return;
		const now = performance.now();
		const next = glideStep(glide.shifts, Math.min(0.1, (now - glide.last) / 1000));
		glide.last = now;
		if (!next.size) {
			e.glide = undefined;
			e.showPreview(undefined);
			e.onGlide?.(undefined);
			return;
		}
		glide.shifts = next;
		// What a frame of the glide costs the main thread (the preview, the lift, the arrows, the draw): for the checks.
		const began = performance.now();
		show(next);
		const cost = knobs.glideCost;
		if (cost) cost.push(performance.now() - began);
		glide.frame = requestAnimationFrame(step);
	};
	e.glide = { shifts, last: performance.now(), frame: requestAnimationFrame(step) };
	return true;
}

/**
 * A gesture was let go and its edit sent (`CanvasView.tsx`, `settleGesture`). When the drawing that
 * answers it arrives, what it lifted is put down: painted back into the worker's tiles, and drawn
 * here until they come (`landed`). Without this an item stayed lifted after its drop, drawn by
 * the page every frame and holding the worker to the screen's tiles. A new gesture first cancels it.
 */
export function settle(e: Engine, landing?: ReadonlyMap<string, Frame>): void {
	e.settling = true;
	e.landing = landing;
}

/** End a glide in hand, where it is: the items it lifted stay lifted for whoever is showing them now. */
export function endGlide(e: Engine): void {
	if (!e.glide) return;
	cancelAnimationFrame(e.glide.frame);
	e.glide = undefined;
	e.onGlide?.(undefined);
}

// Tiles: the ones wanted, taken in from the worker, and let go of.
/** Whether a tile is still wanted: at the scale the latest camera wants, or the overview's. Tiles of a scale the zoom has left are not taken in. */
export function wanted(e: Engine, t: { scale: number }): boolean {
	return e.wantScale === undefined || t.scale === e.wantScale || t.scale === e.overviewScale;
}

/** Let go of the tiles waiting to be taken in that the latest camera no longer wants, and tell the worker, which paints them again if they are wanted again. */
export function dropUnwanted(e: Engine): void {
	if (!e.tileQueue.length) return;
	const gone: Array<[number, number, number]> = [];
	e.tileQueue = e.tileQueue.filter((q) => {
		if (e.wanted(q.tile)) return true;
		q.tile.bitmap?.close();
		gone.push([q.tile.scale, q.tile.x, q.tile.y]);
		return false;
	});
	if (gone.length) e.post({ type: "dropped", keys: gone });
}

/**
 * Take tiles in soon, in a task of their own (`takeTiles`), and draw them at the next frame
 * (`tick`): never in the frame's callback before its draw, where a copy that waited on the GPU
 * process (12 ms once, in Chromium) made that frame late, and the draw after it too. A frame's
 * share (`TILE_BUDGET`) is spent once, in one or more tasks after its draw; what is left waits
 * for the next frame's.
 */
export function takeTilesSoon(e: Engine): void {
	if (e.takePosted || e.disposed || !e.tileQueue.length) return;
	const budget = tileBudget();
	if (e.frameTaken.ms >= budget.ms) return void e.tickSoon();
	e.takePosted = true;
	if (!e.takeChannel) {
		e.takeChannel = new MessageChannel();
		e.takeChannel.port1.onmessage = () => {
			e.takePosted = false;
			if (!e.disposed) e.takeTiles();
		};
	}
	e.takeChannel.port2.postMessage(0);
}

/**
 * Take in the tiles waiting, the window's first, until this frame's share (`TILE_BUDGET`) is
 * spent, and draw them at the next frame; what is left is taken after that frame's draw. When none is left, what the worker
 * said with its latest batch holds: the window sharp (`sharpAt`), or filled in (`settledAt`).
 */
export function takeTiles(e: Engine): void {
	const page = e.page;
	if (!page || e.paused) return e.dropTileQueue();
	const queue = e.tileQueue;
	if (!queue.length) return;
	const budget = tileBudget();
	// Counted too where the clock is coarse (WebKit, where tiles come as bytes).
	const coarse = (e.coarseClock ??= webKit());
	// The window's tiles first, in the order they came.
	if (queue.length > 1) {
		const { x, y } = e.corner();
		const w = e.view.width / e.camera.zoom;
		const h = e.view.height / e.camera.zoom;
		const seen = (t: TileFromWorker) => {
			const [tx, ty, side] = tileArea(t);
			return tx < x + w && tx + side > x && ty < y + h && ty + side > y;
		};
		const inView = queue.filter((q) => seen(q.tile));
		if (inView.length && inView.length < queue.length) e.tileQueue = [...inView, ...queue.filter((q) => !seen(q.tile))];
	}
	const start = performance.now();
	const spent = e.frameTaken;
	let { bytes, pictures } = spent;
	let taken = 0;
	for (let first = e.tileQueue[0]; first; first = e.tileQueue[0]) {
		const next = first.tile;
		// At least one a frame, however long the last frame's took.
		if (taken > 0 || spent.bytes + spent.pictures > 0) {
			if (spent.ms + performance.now() - start >= budget.ms) break;
			if (coarse && (next.bitmap ? pictures >= budget.pictures : bytes >= budget.bytes)) break;
		}
		e.tileQueue.shift();
		// A tile of a level not shown yet: it is shown once its level covers the window, or once its tiles stop coming for `SHOW_ANYWAY_MS`.
		if (next.scale !== e.overviewScale && next.scale !== page.shownScale()) e.showAnywaySoon();
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
	e.frameTaken = { ms: spent.ms + performance.now() - start, bytes, pictures };
	probes.sheet.tiles = (probes.sheet.tiles ?? 0) + taken;
	const batch = e.tileBatch;
	if (!e.tileQueue.length && batch) {
		e.tileBatch = undefined;
		e.settledNext = batch.rest === 0 && batch.got >= e.posted && e.fontsPending === 0;
		if (batch.left === 0 && batch.got >= e.postedContent && e.fontsPending === 0) e.sharpNext = true;
		e.seenAtDraw = batch.sent;
	}
	// Drawn in the next frame's one draw (`tick`), which takes what is left after it.
	if (taken) e.draw();
	else e.tickSoon();
}

/** Let go of the tiles waiting: the engine they were for is gone. */
export function dropTileQueue(e: Engine): void {
	for (const q of e.tileQueue) q.tile.bitmap?.close();
	e.tileQueue = [];
	e.tileBatch = undefined;
}

/** The old sheet's tile hand-off, which this engine does not use. */
export function setTiles(e: Engine, _sink: unknown): void {}

export function forgetTile(e: Engine, _key: string): void {}

export function tileArea(t: { scale: number; x: number; y: number }): [number, number, number] {
	tileScale.setUint32(0, t.scale);
	const side = TILE_SIDE / tileScale.getFloat32(0);
	return [t.x * side, t.y * side, side];
}

// Drawing a frame, and what has reached the screen.
/** Draw the canvas at the next frame (`tick`), once however many changes come before it. */
export function draw(e: Engine): void {
	e.dirty = true;
	e.tickSoon();
}

export function drawSoon(e: Engine): void {
	e.draw();
}

/** Draw the canvas now, for the window: the frame's one draw (`tick`), or one that cannot wait (`flush`, `cutFromCarried`). */
export function drawNow(e: Engine): void {
	e.dirty = false;
	if (!e.page || !e.view.width || e.paused) return;
	try {
		e.drawUnguarded();
	} catch (error) {
		e.recover(error, "a frame");
	}
}

export function drawUnguarded(e: Engine): void {
	if (!e.page) return;
	e.shownSeen = Math.max(e.shownSeen, e.seenAtDraw);
	const at = e.drawRect();
	// At the scale the worker's latest camera wants: shown once its tiles cover the window (`Page::frame`).
	const ops = e.page.frame(at.x, at.y, at.zoom, Math.min(2, devicePixelRatio || 1), at.width, at.height, e.wantScale ?? 0);
	// The tiles let go of: past the budget, or of the level a new one replaced.
	const gone = e.page.evict();
	if (gone !== "[]") e.post({ type: "dropped", keys: JSON.parse(gone) as Array<[number, number, number]> });
	e.drawnAt = { x: at.x, y: at.y, zoom: at.zoom };
	/*
	 * Moved as well as drawn, under WebKit: drawn once more at the next frame, where the camera
	 * stops. WebKit can show a canvas whose place changed with the picture it had before (a
	 * screenshot at rest after a zoom showed the step before it until anything drew again); a draw
	 * with the place unchanged shows the last one. While the camera moves, the next frame draws anyway.
	 */
	if (e.place() && (e.webKit ??= webKit())) e.draw();
	e.lastOps = ops;
	probes.sheet.shown = (probes.sheet.shown ?? 0) + 1;
	if (e.sharpNext && !e.moving) {
		e.sharpNext = false;
		probes.sheet.sharpAt ??= performance.now();
		e.warmSoon();
	}
	if (e.settledNext) {
		e.settledNext = false;
		probes.sheet.settledAt = performance.now();
	}
	// Asked for in JSON only when the engine says they changed: most frames, nothing did.
	const marks = e.page.cardMarks();
	if (marks !== e.marksSeen) {
		e.marksSeen = marks;
		const pictured = e.page.pictured();
		if (pictured !== e.picturedKey) {
			e.picturedKey = pictured;
			e.pictured?.(new Set(JSON.parse(pictured) as string[]));
		}
		const carrying = e.page.carrying();
		if (carrying !== e.carryingKey) {
			e.carryingKey = carrying;
			e.carrying?.(new Set(JSON.parse(carrying) as string[]));
		}
	}
	if (e.page.hasWanted()) e.wantPictures(JSON.parse(e.page.wantedPictures()) as string[]);
	e.presented?.();
}

/**
 * Draw now what is marked to be drawn: for a caller already in an animation frame's callback (a
 * glide's or a coast's step, which move the camera), whose change would otherwise be drawn a frame
 * after the world moved.
 */
export function flush(e: Engine): void {
	if (e.dirty) e.drawNow();
}

export function fadeSoon(e: Engine): void {
	e.draw();
	if (e.fadeFrame || e.disposed) return;
	e.fadeLast = performance.now();
	const step = () => {
		e.fadeFrame = 0;
		if (e.disposed || !e.page) return;
		const now = performance.now();
		const more = e.page.fadePictures(Math.min(100, now - e.fadeLast));
		e.fadeLast = now;
		e.draw();
		// For the checks: how many fade frames have run (`touch-step5` probe).
		probes.pictureFades++;
		if (more) e.fadeFrame = requestAnimationFrame(step);
	};
	e.fadeFrame = requestAnimationFrame(step);
}

export function tickSoon(e: Engine): void {
	if (e.tickFrame || e.disposed) return;
	e.tickFrame = requestAnimationFrame(() => e.tick());
}

export function tick(e: Engine): void {
	e.tickFrame = 0;
	if (e.disposed) return;
	if (e.picturesSoon) {
		e.picturesSoon = false;
		e.wantCardPictures();
	}
	if (e.dirty) e.drawNow();
	// A new frame's share of taking tiles in, spent after its draw (`takeTilesSoon`).
	e.frameTaken = { ms: 0, bytes: 0, pictures: 0 };
	if (e.tileQueue.length) e.takeTilesSoon();
}

/**
 * Once the stage is first sharp, in idle time before any gesture, both engines make what a
 * first zoom or drag would otherwise make in its first frames (`PageEngine::warm`,
 * `WorkerEngine::warm`): every pipeline they draw with, the glyph textures, spare tile textures
 * (not on a device short of memory).
 * Again after the engines start again (a lost device). `knobs.warm = false` leaves it out, for measuring.
 */
export function warmSoon(e: Engine): void {
	if (e.warmed || !knobs.warm) return;
	e.warmed = true;
	const idle = (globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
	const warm = () => {
		if (e.disposed || !e.page) return;
		e.page.warm(!e.lowMemory);
		e.post({ type: "warm" });
	};
	if (idle) idle(warm, { timeout: 500 });
	else setTimeout(warm, 50);
}

/**
 * Show the level wanted in `SHOW_ANYWAY_MS` whether it covers the window or not, unless another of
 * its tiles comes first: the old engine's word that a level was whole could fail to come, and so
 * can a tile here.
 */
export function showAnywaySoon(e: Engine): void {
	clearTimeout(e.showAnyway);
	e.showAnyway = setTimeout(() => {
		if (e.disposed || !e.page) return;
		e.page.showWanted();
		e.draw();
	}, SHOW_ANYWAY_MS);
}

/** Tiles the page holds: none until the worker's first ones arrive. */
export function tileCount(e: Engine): number {
	return e.page?.tileCount() ?? 0;
}

/** A mark for what has been sent so far: `shows(mark)` once a frame painted after all of it is on screen. */
export function mark(e: Engine): number {
	return e.sent;
}

export function shows(e: Engine, mark: number): boolean {
	return e.shownSeen >= mark;
}
