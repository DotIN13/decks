import type { Camera } from "@decks/protocol";
import { createEffect, onCleanup } from "solid-js";
import { type CameraHost } from "./controller.ts";

/** What `followAsked` reads of `createCameraController` (`controller.ts`), each read when it is used. */
export interface FollowAskedNeeds {
	readonly host: CameraHost;
	localCamera: Camera;
	lastGlideToken: number;
	readonly glideTo: (to: Camera, ms: number) => void;
	readonly cancelGlide: () => void;
	readonly nowScaling: () => void;
	readonly nowMoving: () => void;
	readonly written: { cam: Camera; width: number; height: number; } | undefined;
	readonly writeTransform: (cam: Camera) => void;
	readonly rafId: number | undefined;
	readonly glideRaf: number | undefined;
	readonly cancelCoast: () => void;
}

export function followAsked(d: FollowAskedNeeds) {
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
		const target = d.host.asked().camera;
		const asked = d.host.asked().glide;
		d.host.view(); // a resize re-frames without moving the camera
		const moved = target.x !== d.localCamera.x || target.y !== d.localCamera.y || target.zoom !== d.localCamera.zoom;
		const fresh = asked !== undefined && asked.token !== d.lastGlideToken;
		if (fresh) d.lastGlideToken = asked.token;
		if (fresh && moved && asked.ms > 0) {
			d.glideTo(target, asked.ms);
			return;
		}
		if (moved) {
			d.cancelGlide();
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
			if (target.zoom !== d.localCamera.zoom) d.nowScaling();
			d.nowMoving();
			d.localCamera = target;
		}
		/*
		 * Our own frame coming back (`writeCamera` put it on screen and then told the app) is already
		 * drawn: placing it again drew nothing new but posted the camera to the worker and looked for
		 * card pictures a second time each frame. A resize still re-frames.
		 */
		const v = d.host.view();
		const w = d.written;
		const same = !moved && w !== undefined && w.cam.x === target.x && w.cam.y === target.y && w.cam.zoom === target.zoom && w.width === v.width && w.height === v.height;
		if (!same) d.writeTransform(target);
		if (moved) d.host.moved();
	});

	onCleanup(() => {
		if (d.rafId !== undefined) cancelAnimationFrame(d.rafId);
		if (d.glideRaf !== undefined) cancelAnimationFrame(d.glideRaf);
		d.cancelCoast();
	});

}
