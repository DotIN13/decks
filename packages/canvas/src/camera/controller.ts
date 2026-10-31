import type { Camera } from "@decks/protocol";
import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js";
import { between, pan, zoomAbout, type Viewport } from "./camera.ts";
import { coastStep } from "./touch.ts";
import { springCurve } from "./spring.ts";

/**
 * The camera of one stage: where it is, whether it is moving, and the one place that moves it.
 *
 * Everything that moves the camera comes here: a wheel or a trackpad's pinch (`wheel`), a finger or
 * a drag (`push`), a flick's coast (`coast`), a glide the app asked for (`glideTo`, and the host's
 * camera followed by the effect below). Each step is written to the page at once, by the host's
 * `place` (the world's one transform and the drawing's camera), and published to the host's camera
 * signal once a frame. What the step is never does is reach anything else in the stage: whatever
 * reads the camera reads it from here.
 *
 * Moved out of `Stage.tsx` whole, its comments with it, so the stage keeps the drawing and the
 * boards and asks this for the camera.
 */
export interface CameraHost {
	/** The stage's size on screen. */
	view: Accessor<Viewport>;
	/** Put the world and the drawing at this camera: the one write to the page a camera step makes (for the stage, its scroll). */
	place(camera: Camera): void;
	/** The browser has scrolled the world to this camera already: tell the drawing, and nothing else. */
	follow(camera: Camera): void;
	/** The camera moved: a press in hand runs its last step again (`editor/dom/pointer.ts`, `follow`). */
	moved(): void;
	/** The host's camera signal, set once a frame. */
	publish(camera: Camera): void;
	/** The camera the host asks for, and a glide to arrive at it by. */
	asked(): { camera: Camera; glide?: { token: number; ms: number } | undefined };
	/** Draw the drawing now: called from inside an animation frame already. */
	flush(): void;
}

export type CameraController = ReturnType<typeof createCameraController>;

export function createCameraController(host: CameraHost) {
	let localCamera = untrack(() => host.asked().camera);
	/** When the camera last moved. */
	let lastMoved = 0;
	let rafId: number | undefined;
	let pendingCamera: Camera | undefined;
	/*
	 * One glide at a time, and this is its identity.
	 *
	 * Anything that moves the camera itself — a wheel, a pinch, a drag, a key, an op — bumps the
	 * token, and the loop below stops the moment its token is not the current one. A camera the
	 * person is holding must never be argued with, and this counter is the whole of the mechanism
	 * that guarantees it.
	 */
	let glideToken = 0;
	let glideRaf: number | undefined;
	let lastGlideToken = -1;
	/**
	 * A glide the app has asked for and this file has not started yet.
	 *
	 * The camera signal and the glide request arrive in the same batch, and the boards are
	 * rendered from that batch **before** the effect below gets to start the loop — so for one
	 * pass "the camera has moved" is true and "the camera is moving" is not yet, and a board
	 * that the new camera brings into view would begin parsing its document exactly then, at
	 * the top of the flight. This closes that window: the request itself counts as movement.
	 */
	const glidePending = () => {
		const glide = host.asked().glide;
		return glide !== undefined && glide.token !== lastGlideToken;
	};
	/**
	 * A pan *gesture* is in flight — a finger down, a drag on bare canvas, space and a drag.
	 *
	 * The cursor's own state, and only that (`index.css`: `cursor: grabbing`). It is set on the
	 * press and cleared on the release, so it is true *before* the camera has moved and false the
	 * instant the hand stops. Nothing else reads it: the camera's own state is not something this
	 * signal can answer, because a wheel scroll pans the camera and presses nothing.
	 */
	const [panning, setPanning] = createSignal(false);
	/**
	 * Whether the camera's *scale* is changing right now, as opposed to its position.
	 *
	 * The two are not the same kind of work, and the difference is the whole reason this
	 * signal exists. Moving the world is a transform the compositor already holds pictures
	 * for, so a pan costs almost nothing however many boards are on the canvas. Scaling it
	 * asks every board's document to be drawn again at a size it has never been drawn at —
	 * and a board is an iframe, which is a whole document to redraw. Measured on twelve
	 * boards at 4× CPU throttle: 69ms of work per finger movement while panning, 134ms
	 * while pinching, and the gap grows with the number of boards in view.
	 *
	 * So while the scale is moving, the boards are put on layers of their own
	 * (`index.css`), which lets the compositor stretch the picture it already has instead
	 * of the main thread drawing a new one: 134ms → 56ms, with nothing to see at rest
	 * (measured: 0.2% of pixels differ, at the edges of letters). It is switched off again
	 * a moment after the gesture stops, because a layer is a texture held in memory and a
	 * canvas of them is not free.
	 */
	const [scaling, setScaling] = createSignal(false);
	let scaleSettle: ReturnType<typeof setTimeout> | undefined;
	/**
	 * Whether the camera is moving at all — a pan as well as a zoom.
	 *
	 * `scaling` answers "is the picture the wrong size"; this answers "is the picture in
	 * motion", and the canvas renderers need the second one too. A pan repaints the page, so
	 * Chrome reports every drawable element as changed on every step, and a renderer that
	 * reads a `paint` event as "this document changed" redraws every board on every step of
	 * a pan for nothing. Same tail as the scale settle, for the same reason.
	 */
	const [moving, setMoving] = createSignal(false);
	let moveSettle: ReturnType<typeof setTimeout> | undefined;
	/**
	 * Whether the camera is gliding right now — for the checks, not for the drawing.
	 *
	 * `data-panning` and `data-scaling` are the other two halves of "the camera is moving and this
	 * is what kind of work that is"; this is the third case, a move the app made on the reader's
	 * behalf, and a check has no other way to wait for it to arrive without sleeping.
	 */
	const [gliding, setGliding] = createSignal(false);
	/** The camera and window the world was last placed for (`writeTransform`). */
	let written: { cam: Camera; width: number; height: number } | undefined;
	const writeTransform = (cam: Camera) => {
		const v = host.view();
		written = { cam, width: v.width, height: v.height };
		host.place(cam);
	};

	/**
	 * Say the scale is moving, and arrange to notice when it stops.
	 *
	 * The tail matters: a pinch delivers its steps as separate events with nothing to mark
	 * the end of the *scaling* in particular, and dropping the layers between two frames of
	 * one gesture would pay for them twice. 300ms is longer than any gap inside a gesture
	 * and shorter than anyone would notice holding.
	 */
	const nowMoving = () => {
		if (!moving()) setMoving(true);
		clearTimeout(moveSettle);
		moveSettle = setTimeout(() => setMoving(false), 160);
	};
	onCleanup(() => clearTimeout(moveSettle));
	const nowScaling = () => {
		if (!scaling()) setScaling(true);
		clearTimeout(scaleSettle);
		scaleSettle = setTimeout(() => setScaling(false), 300);
	};
	onCleanup(() => clearTimeout(scaleSettle));

	/**
	 * The camera has stopped and nothing more is coming: the moving and scaling states end now, not
	 * after their tails. When the last finger lifts from a pinch there is no next step to wait for,
	 * and the tails (160 and 300 ms) were that much more of tiles painted at the moving scale before
	 * the sharp ones were asked for (on an iPad mini, sharp about 620 ms after the lift). A wheel or
	 * a trackpad's pinch has no lift, so it keeps the tails. `__decksPinchTail = true` keeps them after
	 * a pinch too, for measuring.
	 */
	const stopped = () => {
		clearTimeout(moveSettle);
		clearTimeout(scaleSettle);
		if (moving()) setMoving(false);
		if (scaling()) setScaling(false);
	};



	/**
	 * Move the camera now: the body `pushCamera` has always been, given the name it deserves.
	 *
	 * A glide is **not a second way to move the camera**. It is a loop that calls this, which is why
	 * an arrival gets everything a finger already had for free: the scale settle (a zooming glide
	 * sets it for its duration, so the boards are redrawn once, at the end), the `lastMoved` stamp,
	 * and the camera signal going up once per frame, so the zoom readout
	 * ticks and `camera()` is never a lie about where the view is going.
	 */
	const write = (cam: Camera) => {
		if (cam.zoom !== localCamera.zoom) nowScaling();
		if (cam.x !== localCamera.x || cam.y !== localCamera.y || cam.zoom !== localCamera.zoom) nowMoving();
		lastMoved = performance.now();
		localCamera = cam;
		writeTransform(cam);
		host.moved();
		pendingCamera = cam;
		if (rafId === undefined) {
			rafId = requestAnimationFrame(() => {
				rafId = undefined;
				host.publish(pendingCamera!);
				pendingCamera = undefined;
			});
		}
	};

	/*
	 * The coast after a thrown one-finger pan (`coastStep`, `touch.ts`). Its own frame, not a
	 * glide's: a glide is the app moving the camera somewhere, and a finger landing must stop
	 * a coast without also stopping that. Anything else that moves the camera stops it too,
	 * because every one of those goes through `cancelGlide`.
	 */
	let coastRaf: number | undefined;
	const cancelCoast = () => {
		if (coastRaf === undefined) return;
		cancelAnimationFrame(coastRaf);
		coastRaf = undefined;
	};
	const coast = (start: { vx: number; vy: number }) => {
		cancelCoast();
		let v = start;
		let last = performance.now();
		const frame = () => {
			const now = performance.now();
			const step = coastStep(v, now - last);
			last = now;
			v = step.v;
			write(pan(localCamera, step.dx, step.dy));
			// In an animation frame already: the drawing is drawn now, in this frame with the world, not at the next.
			host.flush();
			if (Math.hypot(v.vx, v.vy) < 0.01) {
				coastRaf = undefined;
				return;
			}
			coastRaf = requestAnimationFrame(frame);
		};
		coastRaf = requestAnimationFrame(frame);
	};

	const cancelGlide = () => {
		cancelCoast();
		glideToken++;
		if (glideRaf !== undefined) {
			cancelAnimationFrame(glideRaf);
			glideRaf = undefined;
		}
		setGliding(false);
	};

	/**
	 * The browser scrolled the stage (a trackpad, a wheel, a finger), and the world is already where
	 * this camera puts it: the camera follows, the drawing is told, and the camera is published once
	 * a frame, as for any other step, with no transform written. A hand on the canvas wins over a
	 * glide, as it does for every gesture.
	 */
	const scrolled = (cam: Camera) => {
		if (cam.x === localCamera.x && cam.y === localCamera.y && cam.zoom === localCamera.zoom) return;
		cancelGlide();
		nowMoving();
		lastMoved = performance.now();
		localCamera = cam;
		const v = host.view();
		written = { cam, width: v.width, height: v.height };
		host.follow(cam);
		host.moved();
		pendingCamera = cam;
		if (rafId === undefined) {
			rafId = requestAnimationFrame(() => {
				rafId = undefined;
				host.publish(pendingCamera!);
				pendingCamera = undefined;
			});
		}
	};

	/** A gesture, and the hand wins: it ends any glide before writing its own camera. */
	const push = (cam: Camera) => {
		cancelGlide();
		write(cam);
	};

	/**
	 * Arrive at `to` over `ms`, from wherever the camera is *now*.
	 *
	 * From the pixels rather than from the previous target, so two moves in a row read as a change
	 * of mind rather than as the view travelling backwards to a place it never went. The last frame
	 * writes `to` itself, not `between(from, to, 1)` — see the note on `between` about what `a +
	 * (b - a) * 1` does to a fit.
	 */
	const glideTo = (to: Camera, ms: number) => {
		const from = localCamera;
		if (from.x === to.x && from.y === to.y && from.zoom === to.zoom) {
			write(to);
			return;
		}
		const mine = ++glideToken;
		const at = performance.now();
		setGliding(true);
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
		// iOS's spring, no bounce: away at once, settling into place (`app/spring.ts`).
		const curve = springCurve(ms);
		const step = () => {
			if (mine !== glideToken) return;
			const t = Math.min(1, (performance.now() - at) / ms);
			write(t >= 1 ? to : between(from, to, curve(t)));
			// In an animation frame already: the drawing is drawn now, in this frame with the world, not at the next.
			host.flush();
			if (t >= 1) {
				glideRaf = undefined;
				setGliding(false);
				return;
			}
			glideRaf = requestAnimationFrame(step);
		};
		glideRaf = requestAnimationFrame(step);
	};

	/*
	 * Sync from external camera changes (a fit, an op, the opening view, a glide the app asked for)
	 * and from viewport resizes.
	 *
	 * `localCamera` is what the pixels say, and it is deliberately **not** reactive: the test below
	 * is "has somebody else moved the camera", and a glide's own frames write both it and the signal
	 * the app holds. An effect that cancelled on every incoming change would therefore cancel the
	 * glide with it — so a change that matches the pixels is one of ours, and not news.
	 */
	createEffect(() => {
		const target = host.asked().camera;
		const asked = host.asked().glide;
		host.view(); // a resize re-frames without moving the camera
		const moved = target.x !== localCamera.x || target.y !== localCamera.y || target.zoom !== localCamera.zoom;
		const fresh = asked !== undefined && asked.token !== lastGlideToken;
		if (fresh) lastGlideToken = asked.token;
		if (fresh && moved && asked.ms > 0) {
			glideTo(target, asked.ms);
			return;
		}
		if (moved) {
			cancelGlide();
			localCamera = target;
		}
		/*
		 * Our own frame coming back (`writeCamera` put it on screen and then told the app) is already
		 * drawn: placing it again drew nothing new but posted the camera to the worker and looked for
		 * card pictures a second time each frame. A resize still re-frames.
		 */
		const v = host.view();
		const w = written;
		const same = !moved && w !== undefined && w.cam.x === target.x && w.cam.y === target.y && w.cam.zoom === target.zoom && w.width === v.width && w.height === v.height;
		if (!same) writeTransform(target);
		if (moved) host.moved();
	});

	onCleanup(() => {
		if (rafId !== undefined) cancelAnimationFrame(rafId);
		if (glideRaf !== undefined) cancelAnimationFrame(glideRaf);
		cancelCoast();
	});
	/**
	 * Scroll units per e-fold of zoom: smaller zooms faster (see `wheel`). A trackpad pinch, which
	 * Chrome reports as `ctrlKey` without ⌘, has its own; every other zoom (⌘ with a wheel, a mouse
	 * that scrolls in small steps) keeps the one it had.
	 */
	const PINCH_TRAVEL = 64;
	const WHEEL_TRAVEL = 80;
	const wheel = (gesture: { x: number; y: number; deltaX: number; deltaY: number; zooming: boolean; pinch?: boolean }) => {
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
			push(zoomAbout(localCamera, host.view(), { x: gesture.x, y: gesture.y }, factor));
			return;
		}
		push(pan(localCamera, -gesture.deltaX, -gesture.deltaY));
	};

	/**
	 * The camera's zoom alone. What depends on the zoom only (handle sizes, the live zoom, a text
	 * editor's scale) reads this, and so hears nothing of a pan: the camera itself is a new object
	 * every frame, and reading `camera.zoom` off it re-ran each of them on every frame of a pan.
	 */
	const zoom = createMemo(() => host.asked().camera.zoom);

	/**
	 * The camera as everything that is not glued to the screen should see it: the camera itself,
	 * except that a pan at one zoom reaches it only once it has gone an eighth of the window since it
	 * last did, and exactly once the camera has stopped. Nothing a board shows changes with a pan (the
	 * world's transform moves its page), and what is decided from the camera (which boards are near
	 * the screen, which may load a page, where a pill goes) looks a whole window past the screen or
	 * waits for a rest anyway: so each pan step reaches none of it. A zoom reaches it at once.
	 *
	 * `__decksExactCamera = true` hands every camera through, for measuring (`__decksExactBoardCamera`,
	 * its old name, too, until 2026-11-30).
	 */
	const settled = createMemo<Camera>(
		() => {
			// Read so that coming to rest is heard, and the settled camera becomes the exact one then.
			moving();
			gliding();
			panning();
			return host.asked().camera;
		},
		untrack(() => host.asked().camera),
		{
			equals: (was, next) => {
				if (was === next) return true;
				if (was.zoom !== next.zoom) return false;
				const still = !untrack(moving) && !untrack(gliding) && !untrack(panning);
				const exact = globalThis as { __decksExactCamera?: boolean; __decksExactBoardCamera?: boolean };
				if (still || exact.__decksExactCamera || exact.__decksExactBoardCamera) return was.x === next.x && was.y === next.y;
				const v = untrack(host.view);
				return Math.abs(was.x - next.x) * was.zoom < v.width / 8 && Math.abs(was.y - next.y) * was.zoom < v.height / 8;
			},
		},
	);

	/**
	 * The camera at rest: it changes only once moving, scaling, gliding and panning are all off (and no
	 * glide is waiting to start), and then to exactly where the camera is. What is chosen from it, which
	 * cards are live (`items/live-cards.ts`), is chosen once a gesture ends and never during one, so a
	 * pinch mounts and unmounts nothing. `settled` changes at every step of a zoom; this does not.
	 */
	const rest = createMemo<Camera>(
		(was) => {
			const camera = host.asked().camera;
			const still = !moving() && !scaling() && !gliding() && !panning() && !glidePending();
			return still ? camera : was;
		},
		untrack(() => host.asked().camera),
		{ equals: (was, next) => was === next || (was.x === next.x && was.y === next.y && was.zoom === next.zoom) },
	);

	return {
		/** The camera as of the last step, exactly: what a gesture or a point on the screen needs. */
		now: () => localCamera,
		zoom,
		settled,
		rest,
		/** When the camera last moved. */
		lastMoved: () => lastMoved,
		moving,
		scaling,
		gliding,
		panning,
		setPanning,
		glidePending,
		write,
		push,
		glideTo,
		cancelGlide,
		scrolled,
		coast,
		cancelCoast,
		stopped,
		wheel,
	};
}
