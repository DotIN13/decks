import type { Setter } from "solid-js";
import { probes } from "../base/debug.ts";
import type { Camera } from "@decks/protocol";
import { createEffect, on } from "solid-js";
import { createCameraController } from "../camera/controller.ts";
import { nearEdge, scrollFor, type Origin } from "../camera/scroll-area.ts";
import { type WorldNeeds } from "./world.ts";

/** What `createWorldRest` reads of `createWorld` (`world.ts`), each read when it is used. */
export interface WorldRestNeeds {
	readonly ctl: ReturnType<typeof createCameraController>;
	readonly outer: WorldNeeds;
	origin: Origin;
	readonly setWorldOrigin: Setter<Origin>;
	readonly placeWorld: (zoom: number, force?: boolean) => void;
	readonly placeScroll: (cam: Camera) => void;
	zoomScroll: { left: number; top: number; } | undefined;
	zoomStill: boolean;
}

export function createWorldRest(d: WorldRestNeeds) {
	/*
	 * For the browser checks: the camera as the world's transform said it before the stage scrolled
	 * (`translate(half the window) scale(zoom) translate(−camera)`), which they read and parse; the
	 * world's own transform now holds only the origin and the zoom (`camera/scroll-area.ts`).
	 */
	probes.cameraTransform = () => {
		const c = d.ctl.now();
		const v = d.outer.view();
		return `translate(${v.width / 2}px, ${v.height / 2}px) scale(${c.zoom}) translate(${-c.x}px, ${-c.y}px)`;
	};

	/*
	 * Back to the middle of the scroll area once the camera rests near an edge of it: the origin moves
	 * to the camera and the scroll to the middle in one task, so nothing on screen moves.
	 */
	createEffect(
		on(d.ctl.moving, (moving) => {
			if (moving || !d.outer.element || d.outer.view().width === 0) return;
			if (!nearEdge({ left: d.outer.element.scrollLeft, top: d.outer.element.scrollTop }, d.outer.view())) return;
			const cam = d.ctl.now();
			d.origin = { x: cam.x, y: cam.y };
			d.setWorldOrigin(d.origin);
			d.placeWorld(cam.zoom, true);
			d.placeScroll(cam);
			// A zoom not yet rested keeps the scroll it now has.
			if (d.zoomScroll) d.zoomScroll = scrollFor(cam, d.origin, d.outer.view());
		}, { defer: true }),
	);

	// The camera's motion, as the controller tracks it (`camera/controller.ts`).
	const { moving, scaling, gliding, panning } = d.ctl;

	// The zoom has rested: from here the scroll and the camera agree again, and a pan sets the scroll as before.
	createEffect(
		on(scaling, (now) => {
			if (now) return;
			d.zoomScroll = undefined;
			// A zoom that moved nothing: the world and the canvas are placed for where it rested.
			if (d.zoomStill) {
				d.zoomStill = false;
				d.placeWorld(d.ctl.now().zoom, true);
				d.outer.penLayer.holdStill(false);
			}
		}, { defer: true }),
	);

	return {
		panning,
		scaling,
		moving,
		gliding,
	};
}
