import type { Camera } from "@decks/protocol-old";
import { createEffect } from "solid-js";
import { between, pan, zoomAbout } from "./camera.ts";
import { nowMoving, nowScaling, placeNow, write, writeTransform, type CameraRun } from "./controller-write.ts";
import { springCurve } from "./spring.ts";
import { coastStep } from "./touch.ts";

export function cancelCoast(c: CameraRun): void {
	if (c.coastRaf === undefined) return;
	cancelAnimationFrame(c.coastRaf);
	c.coastRaf = undefined;
}

/** The coast after a thrown one-finger pan (`CameraRun.coastRaf`). */
export function coast(c: CameraRun, start: { vx: number; vy: number }): void {
	cancelCoast(c);
	let v = start;
	let last = performance.now();
	const frame = () => {
		const now = performance.now();
		const step = coastStep(v, now - last);
		last = now;
		v = step.v;
		write(c, pan(c.localCamera, step.dx, step.dy));
		// In an animation frame already: the world is placed and the drawing drawn now, in this frame, not at the next.
		placeNow(c);
		c.host.flush();
		if (Math.hypot(v.vx, v.vy) < 0.01) {
			c.coastRaf = undefined;
			return;
		}
		c.coastRaf = requestAnimationFrame(frame);
	};
	c.coastRaf = requestAnimationFrame(frame);
}

export function cancelGlide(c: CameraRun): void {
	cancelCoast(c);
	c.glideToken++;
	if (c.glideRaf !== undefined) {
		cancelAnimationFrame(c.glideRaf);
		c.glideRaf = undefined;
	}
	c.setGliding(false);
}

/**
 * The browser scrolled the stage (a trackpad, a wheel, a finger), and the world is already where
 * this camera puts it: the camera follows, the drawing is told, and the camera is published once
 * a frame, as for any other step, with no transform written. A hand on the canvas wins over a
 * glide, as it does for every gesture.
 */
export function scrolled(c: CameraRun, cam: Camera): void {
	if (cam.x === c.localCamera.x && cam.y === c.localCamera.y && cam.zoom === c.localCamera.zoom) return;
	cancelGlide(c);
	nowMoving(c);
	c.lastMoved = performance.now();
	c.localCamera = cam;
	const v = c.host.view();
	c.written = { cam, width: v.width, height: v.height };
	c.host.follow(cam);
	c.host.moved();
	c.pendingCamera = cam;
	if (c.rafId === undefined) {
		c.rafId = requestAnimationFrame(() => {
			c.rafId = undefined;
			c.host.publish(c.pendingCamera!);
			c.pendingCamera = undefined;
		});
	}
}

/** A gesture, and the hand wins: it ends any glide before writing its own camera. */
export function push(c: CameraRun, cam: Camera): void {
	cancelGlide(c);
	write(c, cam);
}

/**
 * Arrive at `to` over `ms`, from wherever the camera is *now*.
 *
 * From the pixels rather than from the previous target, so two moves in a row read as a change
 * of mind rather than as the view travelling backwards to a place it never went. The last frame
 * writes `to` itself, not `between(from, to, 1)` — see the note on `between` about what `a +
 * (b - a) * 1` does to a fit.
 */
export function glideTo(c: CameraRun, to: Camera, ms: number): void {
	const from = c.localCamera;
	if (from.x === to.x && from.y === to.y && from.zoom === to.zoom) {
		write(c, to);
		return;
	}
	const mine = ++c.glideToken;
	const at = performance.now();
	c.setGliding(true);
	/*
	 * `performance.now()`, not the timestamp `requestAnimationFrame` hands the callback.
	 *
	 * They are different clocks, and `at` above is a `performance.now()`. The frame's own
	 * timestamp is when the frame *started*, which is routinely **before** the moment the press
	 * that started this glide was handled — a press arrives during a frame. So `now - at` came out
	 * negative on the first frame, the number was clamped to zero, and the move spent its first
	 * frames re-drawing where it already was: on a loaded machine that cost 20% of the travel,
	 * measured — the camera sat at the start for 50ms and then finished late. It was invisible in
	 * a frame-by-frame assertion, which is happy to see *some* intermediate value, and obvious in
	 * a chart of the curve the samples were supposed to be on.
	 */
	// iOS's spring, no bounce: away at once, settling into place (`spring.ts`).
	const curve = springCurve(ms);
	const step = () => {
		if (mine !== c.glideToken) return;
		const t = Math.min(1, (performance.now() - at) / ms);
		write(c, t >= 1 ? to : between(from, to, curve(t)));
		// In an animation frame already: the world is placed and the drawing drawn now, in this frame, not at the next.
		placeNow(c);
		c.host.flush();
		if (t >= 1) {
			c.glideRaf = undefined;
			c.setGliding(false);
			return;
		}
		c.glideRaf = requestAnimationFrame(step);
	};
	c.glideRaf = requestAnimationFrame(step);
}

/*
 * Sync from external camera changes (a fit, an op, the opening view, a glide the app asked for)
 * and from viewport resizes.
 *
 * `localCamera` is what the pixels say, and it is deliberately **not** reactive: the test below
 * is "has somebody else moved the camera", and a glide's own frames write both it and the signal
 * the app holds. An effect that cancelled on every incoming change would therefore cancel the
 * glide with it — so a change that matches the pixels is one of ours, and not news.
 */
export function followAsked(c: CameraRun): void {
	createEffect(() => {
		const target = c.host.asked().camera;
		const asked = c.host.asked().glide;
		c.host.view(); // a resize re-frames without moving the camera
		const moved = target.x !== c.localCamera.x || target.y !== c.localCamera.y || target.zoom !== c.localCamera.zoom;
		const fresh = asked !== undefined && asked.token !== c.lastGlideToken;
		if (fresh) c.lastGlideToken = asked.token;
		if (fresh && moved && asked.ms > 0) {
			glideTo(c, target, asked.ms);
			return;
		}
		if (moved) {
			cancelGlide(c);
				/*
				 * A move the app made (the opening camera, a fit, an agent's focus) is a step like a finger's:
				 * the scale and the motion settle as after a gesture. Without this a zoom that came this way
				 * never counted as scaling, so the stage never heard it rest: a zoom it had held still (the
				 * world and the drawing's canvas left where they were, the drawing drawn at the camera into
				 * them) stayed held for good. Every pan after that moved the canvas with the scroll and the
				 * drawing was drawn again at the new camera into the moved canvas, so it drifted from the
				 * camera by each pan: an agent's cursor and a fit landed a pan's width from what they aimed
				 * at, the canvas's margin ran out at one edge and pans showed bare strips, until a pinch or a
				 * wheel zoom placed everything again.
				 */
			if (target.zoom !== c.localCamera.zoom) nowScaling(c);
			nowMoving(c);
			c.localCamera = target;
		}
			/*
			 * Our own frame coming back (`writeCamera` put it on screen and then told the app) is already
			 * drawn: placing it again drew nothing new but posted the camera to the worker and looked for
			 * card pictures a second time each frame. A resize still re-frames.
			 */
		const v = c.host.view();
		const w = c.written;
		const same = !moved && w !== undefined && w.cam.x === target.x && w.cam.y === target.y && w.cam.zoom === target.zoom && w.width === v.width && w.height === v.height;
		if (!same) writeTransform(c, target);
		if (moved) c.host.moved();
	});
}

/**
 * Scroll units per e-fold of zoom: smaller zooms faster (see `wheel`). A trackpad pinch, which
 * Chrome reports as `ctrlKey` without ⌘, has its own; every other zoom (⌘ with a wheel, a mouse
 * that scrolls in small steps) keeps the one it had.
 */
export const PINCH_TRAVEL = 64;
export const WHEEL_TRAVEL = 80;
export function wheel(c: CameraRun, gesture: { x: number; y: number; deltaX: number; deltaY: number; zooming: boolean; pinch?: boolean }): void {
	const travel = gesture.pinch ? PINCH_TRAVEL : WHEEL_TRAVEL;
	if (gesture.zooming) {
		/*
		 * A pinch arrives as a stream of small deltas and a ⌘-wheel notch as one
		 * delta of 100 or more, so the exponential is clamped: without it, the
		 * pinch is right and one notch of the wheel jumps 2.7x.
		 *
		 * The divisor is how far a finger has to travel for a given zoom, and it is the
		 * pinch's alone: a wheel notch is past the clamp at any of these numbers, so
		 * changing it moves the trackpad and leaves the mouse where it was. It has been
		 * turned five times, each time because a Mac trackpad felt slow — 300 barely doubled
		 * the zoom across a whole pinch, 200 was still short, 120 (about 3.8×) a little short,
		 * 100 (about 5×) still slow, 80 (about 7.4×) asked to be faster, 60 (about 14×) a little
		 * too fast. At 64 that pinch is about 12× (`PINCH_TRAVEL`).
		 */
		const factor = Math.min(1.3, Math.max(1 / 1.3, Math.exp(-gesture.deltaY / travel)));
		push(c, zoomAbout(c.localCamera, c.host.view(), { x: gesture.x, y: gesture.y }, factor));
		return;
	}
	push(c, pan(c.localCamera, -gesture.deltaX, -gesture.deltaY));
}
