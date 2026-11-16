import type { Camera } from "@decks/protocol";
import type { Accessor, Setter } from "solid-js";
import type { Viewport } from "./camera.ts";

// The camera controller's state, and its one write to the page per step, with whether the
// camera is moving or scaling.

export interface CameraHost {
	/** The stage's size on screen. */
	view: Accessor<Viewport>;
	/** Put the world and the drawing at this camera: the one write to the page a camera step makes (for the stage, its scroll). */
	place(camera: Camera): void;
	/** The browser has scrolled the world to this camera already: tell the drawing, and nothing else. */
	follow(camera: Camera): void;
	/** The camera moved: a press in hand runs its last step again (`canvas/input/pointer.ts`, `follow`). */
	moved(): void;
	/** The host's camera signal, set once a frame. */
	publish(camera: Camera): void;
	/** The camera the host asks for, and a glide to arrive at it by. */
	asked(): { camera: Camera; glide?: { token: number; ms: number } | undefined };
	/** Draw the drawing now: called from inside an animation frame already. */
	flush(): void;
}

/** What one stage's camera holds, handed to each of its steps. */
export interface CameraRun {
	host: CameraHost;
	localCamera: Camera;
	/** When the camera last moved. */
	lastMoved: number;
	rafId?: number;
	pendingCamera?: Camera;
	/*
	 * One glide at a time, and this is its identity.
	 *
	 * Anything that moves the camera itself — a wheel, a pinch, a drag, a key, an op — bumps the
	 * token, and the loop below stops the moment its token is not the current one. A camera the
	 * person is holding must never be argued with, and this counter is the whole of the mechanism
	 * that guarantees it.
	 */
	glideToken: number;
	glideRaf?: number;
	lastGlideToken: number;
	/**
	 * A pan *gesture* is in flight — a finger down, a drag on bare canvas, space and a drag.
	 *
	 * The cursor's own state, and only that (`index.css`: `cursor: grabbing`). It is set on the
	 * press and cleared on the release, so it is true *before* the camera has moved and false the
	 * instant the hand stops. Nothing else reads it: the camera's own state is not something this
	 * signal can answer, because a wheel scroll pans the camera and presses nothing.
	 */
	panning: Accessor<boolean>;
	setPanning: Setter<boolean>;
	/**
	 * Whether the camera's scale is changing now, as opposed to its position. A pan moves pictures the
	 * compositor holds; a zoom redraws every awake card at a new size, so while the scale moves the
	 * cards sit on layers of their own and are stretched, and the layers go a moment after it stops.
	 */
	scaling: Accessor<boolean>;
	setScaling: Setter<boolean>;
	scaleSettle?: ReturnType<typeof setTimeout>;
	/**
	 * Whether the camera is moving at all — a pan as well as a zoom.
	 *
	 * `scaling` answers "is the picture the wrong size"; this answers "is the picture in
	 * motion", and the canvas renderers need the second one too. A pan repaints the page, so
	 * Chrome reports every drawable element as changed on every step, and a renderer that
	 * reads a `paint` event as "this document changed" redraws every board on every step of
	 * a pan for nothing. Same tail as the scale settle, for the same reason.
	 */
	moving: Accessor<boolean>;
	setMoving: Setter<boolean>;
	moveSettle?: ReturnType<typeof setTimeout>;
	/**
	 * Whether the camera is gliding right now — for the checks, not for the drawing.
	 *
	 * `data-panning` and `data-scaling` are the other two halves of "the camera is moving and this
	 * is what kind of work that is"; this is the third case, a move the app made on the reader's
	 * behalf, and a check has no other way to wait for it to arrive without sleeping.
	 */
	gliding: Accessor<boolean>;
	setGliding: Setter<boolean>;
	/** The camera and window the world was last placed for (`writeTransform`). */
	written?: { cam: Camera; width: number; height: number };
	/*
	 * The coast after a thrown one-finger pan (`coastStep`, `touch.ts`). Its own frame, not a
	 * glide's: a glide is the app moving the camera somewhere, and a finger landing must stop
	 * a coast without also stopping that. Anything else that moves the camera stops it too,
	 * because every one of those goes through `cancelGlide`.
	 */
	coastRaf?: number;
}

/**
 * Move the camera now: the body `pushCamera` has always been, given the name it deserves.
 *
 * A glide is **not a second way to move the camera**. It is a loop that calls this, which is why
 * an arrival gets everything a finger already had for free: the scale settle (a zooming glide
 * sets it for its duration, so the boards are redrawn once, at the end), the `lastMoved` stamp,
 * and the camera signal going up once per frame, so the zoom readout
 * ticks and `camera()` is never a lie about where the view is going.
 */
export function write(c: CameraRun, cam: Camera): void {
	if (cam.zoom !== c.localCamera.zoom) nowScaling(c);
	if (cam.x !== c.localCamera.x || cam.y !== c.localCamera.y || cam.zoom !== c.localCamera.zoom) nowMoving(c);
	c.lastMoved = performance.now();
	c.localCamera = cam;
	c.host.moved();
	/*
	 * Placed and published once a frame, however many events move the camera in it. A pinch's two
	 * fingers and a trackpad's wheel send two or three a frame, and each placed the world and gave the
	 * engine its camera (its transform, its timers, a message to the worker) for a picture the frame
	 * never showed; the frame's callback runs before the browser paints, so the one placing lands in
	 * the same frame the events did. A glide's or a coast's step is in a frame already and places at once (`placeNow`).
	 */
	c.pendingCamera = cam;
	if (c.rafId === undefined) {
		c.rafId = requestAnimationFrame(() => {
			c.rafId = undefined;
			const next = c.pendingCamera!;
			c.pendingCamera = undefined;
			writeTransform(c, next);
			c.host.publish(next);
		});
	}
}

/** Place the camera written and not yet placed now: for a caller in an animation frame that flushes the drawing itself. */
export function placeNow(c: CameraRun): void {
	if (c.pendingCamera) writeTransform(c, c.pendingCamera);
}

export function writeTransform(c: CameraRun, cam: Camera): void {
	const v = c.host.view();
	c.written = { cam, width: v.width, height: v.height };
	c.host.place(cam);
}

/** Say the camera is moving, and stop saying it 160 ms after the last step. */
export function nowMoving(c: CameraRun): void {
	if (!c.moving()) c.setMoving(true);
	clearTimeout(c.moveSettle);
	c.moveSettle = setTimeout(() => c.setMoving(false), 160);
}

/**
 * Say the scale is moving, and arrange to notice when it stops.
 *
 * The tail matters: a pinch delivers its steps as separate events with nothing to mark
 * the end of the *scaling* in particular, and dropping the layers between two frames of
 * one gesture would pay for them twice. 300ms is longer than any gap inside a gesture
 * and shorter than anyone would notice holding.
 */
export function nowScaling(c: CameraRun): void {
	if (!c.scaling()) c.setScaling(true);
	clearTimeout(c.scaleSettle);
	c.scaleSettle = setTimeout(() => c.setScaling(false), 300);
}

/**
 * The camera has stopped and nothing more is coming: the moving and scaling states end now, not
 * after their tails. When the last finger lifts from a pinch there is no next step to wait for,
 * and the tails (160 and 300 ms) were that much more of tiles painted at the moving scale before
 * the sharp ones were asked for (on an iPad mini, sharp about 620 ms after the lift). A wheel or
 * a trackpad's pinch has no lift, so it keeps the tails. `knobs.pinchTail` (`debug.ts`) keeps them after
 * a pinch too, for measuring.
 */
export function stopped(c: CameraRun): void {
	clearTimeout(c.moveSettle);
	clearTimeout(c.scaleSettle);
	if (c.moving()) c.setMoving(false);
	if (c.scaling()) c.setScaling(false);
}

/**
 * A glide the app has asked for and this file has not started yet.
 *
 * The camera signal and the glide request arrive in the same batch, and the boards are
 * rendered from that batch **before** the effect below gets to start the loop — so for one
 * pass "the camera has moved" is true and "the camera is moving" is not yet, and a board
 * that the new camera brings into view would begin parsing its document exactly then, at
 * the top of the flight. This closes that window: the request itself counts as movement.
 */
export function glidePending(c: CameraRun): boolean {
	const glide = c.host.asked().glide;
	return glide !== undefined && glide.token !== c.lastGlideToken;
}
