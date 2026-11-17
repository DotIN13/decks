import { probes } from "../base/debug.ts";
import { webKit } from "./engine-tiles.ts";
import type { CanvasEngine } from "./engine.ts";

/**
 * The frame loop: one draw per animation frame however many things ask for one, a tick while a
 * glide or a fade runs, and the draw itself, guarded so a fault in one frame starts the engine again
 * instead of freezing the canvas. A part of the engine (`engine.ts`), which it reaches through `of`.
 */
export class EngineFrames {
	constructor(private readonly of: CanvasEngine) {}

	/**
	 * The frame's one draw. Cameras, tiles from the worker and every other change only mark the canvas
	 * to be drawn (`draw`); it is drawn once, in the next animation frame's callback (`tick`), which
	 * runs before the browser paints, so the drawing still lands in the same frame as the board pages
	 * the world's transform moved. A pinch's two fingers move the camera twice a frame, a wheel or a
	 * trackpad may too, and tiles come in bursts: each drew the canvas again (2 draws a frame for a
	 * two-event pinch, 1.2 for a wheel zoom).
	 */
	dirty = false;

	tickFrame = 0;

	/** What had been sent when the tiles that arrived last were asked for: shown once they are drawn. */
	seenAtDraw = 0;

	tickSoon(): void {
		if (this.tickFrame || this.of.disposed) return;
		this.tickFrame = requestAnimationFrame(() => this.tick());
	}

	private tick(): void {
		this.tickFrame = 0;
		if (this.of.disposed) return;
		if (this.of.cardPictures.picturesSoon) {
			this.of.cardPictures.picturesSoon = false;
			this.of.cardPictures.wantCardPictures();
		}
		if (this.dirty) this.drawNow();
		// A new frame's share of taking tiles in, spent after its draw (`takeTilesSoon`).
		this.of.tiles.frameTaken = { ms: 0, bytes: 0, pictures: 0 };
		if (this.of.tiles.tileQueue.length) this.of.tiles.takeTilesSoon();
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

	drawSoon(): void {
		this.draw();
	}

	/** Draw the canvas now, for the window: the frame's one draw (`tick`), or one that cannot wait (`flush`, `cutFromCarried`). */
	drawNow(): void {
		this.dirty = false;
		if (!this.of.page || !this.of.view.width || this.of.paused) return;
		try {
			this.drawUnguarded();
		} catch (error) {
			this.of.recover(error, "a frame");
		}
	}

	private drawUnguarded(): void {
		if (!this.of.page) return;
		this.of.tiles.shownSeen = Math.max(this.of.tiles.shownSeen, this.seenAtDraw);
		const at = this.of.drawRect();
		// At the scale the worker's latest camera wants: shown once its tiles cover the window (`Page::frame`).
		const ops = this.of.page.frame(at.x, at.y, at.zoom, Math.min(2, devicePixelRatio || 1), at.width, at.height, this.of.tiles.wantScale ?? 0);
		// The tiles let go of: past the budget, or of the level a new one replaced.
		const gone = this.of.page.evict();
		if (gone !== "[]") this.of.post({ type: "dropped", keys: JSON.parse(gone) as Array<[number, number, number]> });
		this.of.drawnAt = { x: at.x, y: at.y, zoom: at.zoom };
		/*
		 * Moved as well as drawn, under WebKit: drawn once more at the next frame, where the camera
		 * stops. WebKit can show a canvas whose place changed with the picture it had before (a
		 * screenshot at rest after a zoom showed the step before it until anything drew again); a draw
		 * with the place unchanged shows the last one. While the camera moves, the next frame draws anyway.
		 */
		if (this.of.place() && (this.of.webKit ??= webKit())) this.draw();
		this.of.lastOps = ops;
		probes.sheet.shown = (probes.sheet.shown ?? 0) + 1;
		if (this.of.sharpNext && !this.of.moving) {
			this.of.sharpNext = false;
			probes.sheet.sharpAt ??= performance.now();
			this.of.tiles.warmSoon();
		}
		if (this.of.settledNext) {
			this.of.settledNext = false;
			probes.sheet.settledAt = performance.now();
		}
		// Asked for in JSON only when the engine says they changed: most frames, nothing did.
		const marks = this.of.page.cardMarks();
		if (marks !== this.of.tiles.marksSeen) {
			this.of.tiles.marksSeen = marks;
			const pictured = this.of.page.pictured();
			if (pictured !== this.of.cardLayer.picturedKey) {
				this.of.cardLayer.picturedKey = pictured;
				this.of.pictured?.(new Set(JSON.parse(pictured) as string[]));
			}
			const carrying = this.of.page.carrying();
			if (carrying !== this.of.cardLayer.carryingKey) {
				this.of.cardLayer.carryingKey = carrying;
				this.of.carrying?.(new Set(JSON.parse(carrying) as string[]));
			}
		}
		if (this.of.page.hasWanted()) this.of.cardPictures.wantPictures(JSON.parse(this.of.page.wantedPictures()) as string[]);
		this.of.presented?.();
	}
}
