import type { Board, Camera } from "@decks/protocol";
import { createEffect, onCleanup } from "solid-js";
import { toScreen } from "../camera/camera.ts";
import { cssEscape } from "./inspect.ts";
import { canvasPixelRatio, drawScale, elementContext, needsRedraw, type PaintEvent, type PictureHost, pictureSize } from "./picture.ts";
import type { RedrawQueue } from "./redraw-queue.ts";

/**
 * One canvas for the stage, and a darkroom behind it.
 *
 * `drawElementImage` can only take an immediate child of the canvas it draws into, and
 * it repaints the whole document on every call — so a stage that drew every board on
 * every frame was measured at 21ms a pan step for 16 boards, 95ms at 4× CPU throttle,
 * against the DOM renderer at the frame floor. Instead each board is drawn **once** into
 * a hidden canvas of the same kind (the darkroom, whose children the documents are),
 * copied out as a bitmap at the zoom it was captured for, and from then on the visible
 * canvas only copies bitmaps: a pan is sixteen `drawImage` calls, a pinch stretches them,
 * and the camera resting is what asks for new captures.
 *
 * A bitmap outlives its document. A board whose frame has been let go is still drawn
 * from the picture it left, which is the one thing this renderer can do that the DOM
 * one cannot. What it cannot do is let anyone click into a board: Chrome does not yet
 * hit-test a drawn element where it was drawn, so the documents in the darkroom are
 * inert and the boards are pictures.
 *
 * Split out of `Stage.tsx`. The queue is *not* owned here — both canvas renderers settle
 * through the same one, and `canvas-per-board` draws through it without any of this.
 */

export interface OneCanvasHost {
	boards: () => Board[];
	/** Whether a board is on screen, or within a viewport of it. */
	isVisible: (board: Board) => boolean;
	view: () => { width: number; height: number };
	/**
	 * The camera the gestures are moving — `localCamera`, not the one committed a frame
	 * later. The world transform is written from the same number and the two must agree.
	 */
	camera: () => Camera;
	/** The committed camera's zoom, for the effect that recaptures at rest. */
	settledZoom: () => number;
	/** Whether the camera's scale is moving; a capture during a pinch is deferred. */
	scaling: () => boolean;
	/** Which renderer is running: everything here is inert unless it is `one-canvas`. */
	renderer: () => string;
	/** The stage element, for the background colour the scene is cleared to. */
	stage: () => HTMLElement | undefined;
	/** Shared by both canvas renderers (`redraw-queue.ts`). */
	queue: RedrawQueue;
}

export interface OneCanvas {
	/** What `BoardFrame` is handed so a board can say its document changed. */
	pictures: PictureHost;
	/** Redraw the visible canvas on the next frame, once, however many changes ask. */
	requestPicture: () => void;
	/** Called with the visible canvas when it mounts. */
	setPicture: (canvas: HTMLCanvasElement) => void;
	/** Called with the darkroom when it mounts; wires its paint listener. */
	setDarkroom: (canvas: HTMLCanvasElement) => void;
}

export function createOneCanvas(host: OneCanvasHost): OneCanvas {
	let pictureEl: HTMLCanvasElement | undefined;
	let darkroomEl: HTMLCanvasElement | undefined;
	/** Each board as a bitmap, with the size it was captured at. */
	const bitmaps = new Map<string, { bitmap: ImageBitmap; w: number; h: number }>();
	/**
	 * Boards whose document changed while the scale was moving.
	 *
	 * A paint event during a pinch is not acted on — the picture is being stretched and
	 * would be drawn again at rest anyway — but it must not be *lost*: the first version
	 * dropped it, and a board that finished rendering its markdown during the opening fit
	 * kept the blank picture taken at `load` for good, because at rest its size was right
	 * and nothing said its content was not.
	 */
	const stale = new Set<string>();
	let pictureRaf: number | undefined;

	const requestPicture = () => {
		if (host.renderer() !== "one-canvas" || pictureRaf !== undefined) return;
		pictureRaf = requestAnimationFrame(() => {
			pictureRaf = undefined;
			drawScene();
		});
	};
	onCleanup(() => {
		if (pictureRaf !== undefined) cancelAnimationFrame(pictureRaf);
		for (const held of bitmaps.values()) held.bitmap.close();
		bitmaps.clear();
	});

	const drawScene = () => {
		const canvas = pictureEl;
		const element = host.stage();
		if (!canvas || !element) return;
		const v = host.view();
		const dpr = window.devicePixelRatio || 1;
		const w = Math.max(1, Math.round(v.width * dpr));
		const h = Math.max(1, Math.round(v.height * dpr));
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		// Opaque, in the stage's own colour: the darkroom sits under this canvas at whatever
		// size its last capture needed, and this is what keeps it out of sight.
		ctx.fillStyle = getComputedStyle(element).backgroundColor || "#fff";
		ctx.fillRect(0, 0, w, h);
		const cam = host.camera();
		ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, dpr * (v.width / 2 - cam.x * cam.zoom), dpr * (v.height / 2 - cam.y * cam.zoom));
		ctx.imageSmoothingQuality = "high";
		for (const board of host.boards()) {
			const held = bitmaps.get(board.path);
			if (!held) continue;
			const topLeft = toScreen(cam, v, { x: board.x, y: board.y });
			const bottomRight = toScreen(cam, v, { x: board.x + board.w, y: board.y + board.h });
			if (bottomRight.x < 0 || bottomRight.y < 0 || topLeft.x > v.width || topLeft.y > v.height) continue;
			ctx.drawImage(held.bitmap, board.x, board.y, board.w, board.h);
		}
	};

	/** The darkroom's box, in CSS pixels: the stage, and never anything else (`capture`). */
	const darkroomBox = () => {
		const v = host.view();
		return { w: Math.max(1, Math.round(v.width)), h: Math.max(1, Math.round(v.height)) };
	};
	/** Its backing store, which is also the largest picture a board's capture may have. */
	const darkroomBacking = (dpr: number) => {
		const box = darkroomBox();
		return { w: Math.max(1, Math.round(box.w * dpr)), h: Math.max(1, Math.round(box.h * dpr)) };
	};

	/** Draw one board's document through the darkroom and keep the result as its picture. */
	const capture = (path: string) => {
		const darkroom = darkroomEl;
		if (!darkroom) return;
		const board = host.boards().find((candidate) => candidate.path === path);
		if (!board) return;
		const frame = darkroom.querySelector(`iframe[data-path="${cssEscape(path)}"]`) as HTMLIFrameElement | null;
		if (!frame) return;
		const ctx = elementContext(darkroom);
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
		/*
		 * The darkroom stands at the size of the stage and never changes, and that is
		 * load-bearing twice over.
		 *
		 * A canvas shown at one CSS pixel draws an element into a corner of its backing store
		 * and leaves the rest blank, worse the larger the store — a 940×894 board came out
		 * empty. So it has to be shown at a real size, and the stage is the largest picture
		 * worth taking anyway.
		 *
		 * And a canvas's *box* is laid out, so a box set in this tick is not the one this
		 * draw would use: the element arrives at the ratio from the last rendering update.
		 * Resizing the darkroom per board therefore drew each board at the previous board's
		 * ratio — a 1600-wide board at a 2× screen's ratio came out twice its picture, cropped
		 * to the top-left. Only the backing store changes here, which does take effect at
		 * once, and the picture is cropped out of the corner it was drawn into.
		 */
		const box = darkroomBox();
		if (darkroom.style.width !== `${box.w}px` || darkroom.style.height !== `${box.h}px`) {
			darkroom.style.width = `${box.w}px`;
			darkroom.style.height = `${box.h}px`;
			// Laid out this tick, so it is not the box this draw would be given. Next frame.
			host.queue.add(path, () => capture(path));
			return;
		}
		const backing = darkroomBacking(dpr);
		if (darkroom.width !== backing.w || darkroom.height !== backing.h) {
			darkroom.width = backing.w;
			darkroom.height = backing.h;
		}
		const size = pictureSize(board, host.camera().zoom, dpr, backing);
		const ratio = canvasPixelRatio(darkroom);
		const scale = ratio && drawScale(size, frame.getBoundingClientRect(), ratio);
		if (!scale) return;
		try {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, darkroom.width, darkroom.height);
			ctx.setTransform(scale.x, 0, 0, scale.y, 0, 0);
			ctx.drawElementImage(frame, 0, 0);
		} catch {
			// Not drawable yet — a document a frame away from its first snapshot. Its paint
			// event asks again.
			return;
		}
		// The copy is taken now; only the promise is later.
		void createImageBitmap(darkroom, 0, 0, size.w, size.h)
			.then((bitmap) => {
				bitmaps.get(path)?.bitmap.close();
				bitmaps.set(path, { bitmap, w: size.w, h: size.h });
				requestPicture();
			})
			.catch(() => {});
	};

	/** The browser saying which documents changed since the last frame. */
	const onDarkroomPaint = (event: Event) => {
		const changed = (event as PaintEvent).changedElements;
		const frames = changed ?? [...(darkroomEl?.children ?? [])];
		for (const node of frames) {
			const path = (node as HTMLElement).dataset?.path;
			if (!path) continue;
			if (host.scaling()) stale.add(path);
			else host.queue.add(path, () => capture(path));
		}
	};

	/*
	 * At rest after a zoom, every board in view whose picture is now the wrong size is
	 * captured again — through the queue, a few per frame. Runs on every camera change and
	 * does nothing on a pan, because `needsRedraw` says the size has not changed.
	 */
	createEffect(() => {
		if (host.renderer() !== "one-canvas" || host.scaling()) return;
		const zoom = host.settledZoom();
		const dpr = window.devicePixelRatio || 1;
		for (const board of host.boards()) {
			if (!host.isVisible(board)) continue;
			const want = pictureSize(board, zoom, dpr, darkroomBacking(dpr));
			if (stale.has(board.path) || needsRedraw(bitmaps.get(board.path), want)) {
				stale.delete(board.path);
				host.queue.add(board.path, () => capture(board.path));
			}
		}
	});

	// A board moved or was resized, or the window did: the scene is drawn from those.
	createEffect(() => {
		void host.boards();
		void host.view();
		requestPicture();
	});

	return {
		pictures: {
			queue: host.queue,
			get darkroom() {
				return darkroomEl;
			},
			changed: (path) => host.queue.add(path, () => capture(path)),
			has: (path) => bitmaps.has(path),
		},
		requestPicture,
		setPicture: (canvas) => {
			pictureEl = canvas;
			requestPicture();
		},
		setDarkroom: (canvas) => {
			darkroomEl = canvas;
			canvas.addEventListener("paint", onDarkroomPaint);
			onCleanup(() => canvas.removeEventListener("paint", onDarkroomPaint));
		},
	};
}
