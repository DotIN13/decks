// The canvas's camera, made inside the canvas element (`CanvasView.tsx`): where the world is placed, the controller that
// moves it, and the scroll kept with it.
import { untrack, createSignal, createEffect, on } from "solid-js";
import { StageEngine } from "../render/engine.ts";
import type { createItemsLayer } from "./items-layer.tsx";
import type { createSelection } from "./selection.tsx";
import type { Viewport } from "../camera/camera.ts";
import { type Origin, worldTransform, scrollFor, originFor, nearEdge, cameraFor } from "../camera/scroll-area.ts";
import type { Camera } from "@decks/protocol";
import { createCameraController } from "../camera/controller.ts";
import { probes } from "../debug.ts";
import type { Props } from "./CanvasView.tsx";
import type { editorOf } from "./canvas-editor.ts";

/** The canvas's element and world (filled by refs), its engine, the holder for what is made later, and its view. */
export function elementAndEngine(ctx: { props: Props }) {
	const { props } = ctx;
	/* The host's board, read once: a component, not a value that changes. */
	const Frame = untrack(() => props.frame);
	const element = {} as { now: HTMLDivElement };
	const worldEl = {} as { now: HTMLDivElement };
	/**
	 * The stage's engine (`render/engine.ts`): the drawing and the boards' pictures, drawn with WebGPU
	 * on two canvases, one under the item slots and one over them, in the same call that moves the
	 * slots (`writeTransform`). The document, the window's size and the colour scheme reach it here.
	 */
	const penLayer = new StageEngine();
	/** Made later here and read by callbacks that run after: the editor, the placed items and the selection. */
	const ahead = {} as { editor: ReturnType<typeof editorOf>["editor"]; items: ReturnType<typeof createItemsLayer>; selection: ReturnType<typeof createSelection> };
	/** The camera moved: a press in hand runs its last step again (`input/pointer.ts`, `follow`). */
	const cameraChanged = () => ahead.editor.cameraMoved();
	const [view, setView] = createSignal<Viewport>({ width: 0, height: 0 });
	return { Frame, element, worldEl, penLayer, ahead, cameraChanged, view, setView };
}

/** Where the world is placed in the scrolled content: the origin, the transform last written, the scroll this file set, a zoom held still. */
export function worldPlacement(ctx: {
	props: Props; element: ReturnType<typeof elementAndEngine>["element"]; view: ReturnType<typeof elementAndEngine>["view"];
	worldEl: ReturnType<typeof elementAndEngine>["worldEl"];
}) {
	const { element, props, view, worldEl } = ctx;
	/*
	 * The stage scrolls (`camera/scroll-area.ts`): the camera's position is the stage's scroll, and the
	 * world is placed in the scrolled content at `origin`, scaled by the zoom. A pan is the browser
	 * scrolling, which moves the world on its compositor; a step of ours (a zoom, a key, a glide, a
	 * drag) sets the scroll and, when the zoom or the origin changed, the world's transform.
	 */
	const origin: { now: Origin } = { now: { x: props.camera.x, y: props.camera.y } };
	/** The origin as a signal, for the host's world layer (`props.world`), which is placed from it. */
	const [worldOrigin, setWorldOrigin] = createSignal<Origin>(origin.now);
	/** The origin and zoom the world's transform was last written for (`placeWorld`): what a child of the world is placed in. */
	const [worldPlaced, setWorldPlaced] = createSignal<{ x: number; y: number; zoom: number }>({ x: origin.now.x, y: origin.now.y, zoom: props.camera.zoom });
	/** The origin and zoom the world's transform was last written for. */
	const worldFor: { now: { x: number; y: number; zoom: number } | undefined } = { now: undefined };
	/** The scroll this file last set, so the scroll event that answers it is not taken for the person's. */
	const ownScroll: { now: { left: number; top: number } | undefined } = { now: undefined };
	const placeWorld = (zoom: number, force = false) => {
		if (!force && worldFor.now && worldFor.now.x === origin.now.x && worldFor.now.y === origin.now.y && worldFor.now.zoom === zoom) return;
		worldFor.now = { x: origin.now.x, y: origin.now.y, zoom };
		setWorldPlaced(worldFor.now);
		worldEl.now.style.transform = worldTransform(origin.now, zoom);
	};
	const placeScroll = (cam: Camera) => {
		if (!element.now || view().width === 0) return;
		const to = scrollFor(cam, origin.now, view());
		ownScroll.now = to;
		element.now.scrollTo(to.left, to.top);
	};
	/**
	 * While the zoom is changing, the scroll it found when it began (read once): the view then changes
	 * by the world's origin alone (`originFor`), and the scroll is left where it is until the zoom rests.
	 * One rule for every zoom: fingers, a trackpad's pinch, Ctrl and the wheel, Safari's gesture events,
	 * the zoom keys, a glide. Setting the scroll at each step made the browser lay out and scroll the
	 * whole area: a third of a pinch's script time on an iPad mini, and 8 to 27% of a zoom's on a Mac.
	 */
	const zoomScroll: { now: { left: number; top: number } | undefined } = { now: undefined };
	/** Whether this zoom moves nothing in the DOM (`place` above): no card node is in the world. */
	const zoomStill: { now: boolean } = { now: false };
	/** The zoom the world was last placed at, to tell a zoom step from a pan. */
	const placedZoom: { now: number | undefined } = { now: undefined };
	return { origin, worldOrigin, setWorldOrigin, worldPlaced, ownScroll, placeWorld, placeScroll, zoomScroll, zoomStill, placedZoom };
}

/**
 * The camera: where it is, whether it is moving, and the one place that moves it (`camera/controller.ts`).
 * The stage hands it the window, how to place the world and the drawing at a camera, and its host's
 * camera to follow.
 */
export function cameraOf(ctx: {
	cameraChanged: ReturnType<typeof elementAndEngine>["cameraChanged"];
	element: ReturnType<typeof elementAndEngine>["element"]; origin: ReturnType<typeof worldPlacement>["origin"];
	penLayer: ReturnType<typeof elementAndEngine>["penLayer"];
	placedZoom: ReturnType<typeof worldPlacement>["placedZoom"];
	placeScroll: ReturnType<typeof worldPlacement>["placeScroll"];
	placeWorld: ReturnType<typeof worldPlacement>["placeWorld"]; props: Props;
	setWorldOrigin: ReturnType<typeof worldPlacement>["setWorldOrigin"];
	view: ReturnType<typeof elementAndEngine>["view"]; worldEl: ReturnType<typeof elementAndEngine>["worldEl"];
	zoomScroll: ReturnType<typeof worldPlacement>["zoomScroll"];
	zoomStill: ReturnType<typeof worldPlacement>["zoomStill"];
}) {
	const { cameraChanged, element, origin, penLayer, placedZoom, placeScroll, placeWorld, props, setWorldOrigin, view, worldEl, zoomScroll, zoomStill } = ctx;
	const ctl = createCameraController({
		view,
		place: (cam) => {
			const zooming = placedZoom.now !== undefined && cam.zoom !== placedZoom.now;
			placedZoom.now = cam.zoom;
			if (zooming && !zoomScroll.now && element.now) {
				zoomScroll.now = { left: element.now.scrollLeft, top: element.now.scrollTop };
				/*
				 * A zoom with no card node in the world moves nothing in the DOM: the world and the sheet's
				 * canvas stay where they are, the canvas covering the window as it did, and the engine draws
				 * the window at each step's camera into it (`holdStill`). Each step set two inline transforms,
				 * and in Chromium each set rebuilt the paint property tree and assigned every layer on the
				 * page again, even with the transform promised: a quarter of a zoom's main thread over 100
				 * cards as pictures. With a card's page in the world the world has to move, as its page is
				 * stretched on its own layer (`data-scaling`); nothing wakes mid-gesture, so this is decided once.
				 */
				zoomStill.now = !worldEl.now.querySelector(".card-node");
				penLayer.holdStill(zoomStill.now);
			}
			if (zoomScroll.now) {
				origin.now = originFor(cam, zoomScroll.now, view());
				setWorldOrigin(origin.now);
				if (!zoomStill.now) placeWorld(cam.zoom, true);
				penLayer.setCamera(cam);
				return;
			}
			placeWorld(cam.zoom);
			placeScroll(cam);
			// The drawing moves in the same call as the boards, so the two can never be a frame apart.
			penLayer.setCamera(cam);
		},
		follow: (cam) => penLayer.setCamera(cam),
		moved: () => cameraChanged(),
		publish: (cam) => props.setCamera(cam),
		asked: () => ({ camera: props.camera, glide: props.glide }),
		flush: () => penLayer.flush(),
	});
	/*
	 * For the browser checks: the camera as the world's transform said it before the stage scrolled
	 * (`translate(half the window) scale(zoom) translate(−camera)`), which they read and parse; the
	 * world's own transform now holds only the origin and the zoom (`camera/scroll-area.ts`).
	 */
	probes.cameraTransform = () => {
		const c = ctl.now();
		const v = view();
		return `translate(${v.width / 2}px, ${v.height / 2}px) scale(${c.zoom}) translate(${-c.x}px, ${-c.y}px)`;
	};
	return { ctl };
}

/** The scroll and the camera kept together: back to the middle at rest, a zoom's scroll let go, a scroll followed. */
export function scrollFollows(ctx: {
	ctl: ReturnType<typeof cameraOf>["ctl"]; element: ReturnType<typeof elementAndEngine>["element"];
	origin: ReturnType<typeof worldPlacement>["origin"]; ownScroll: ReturnType<typeof worldPlacement>["ownScroll"];
	penLayer: ReturnType<typeof elementAndEngine>["penLayer"];
	placeScroll: ReturnType<typeof worldPlacement>["placeScroll"];
	placeWorld: ReturnType<typeof worldPlacement>["placeWorld"];
	setWorldOrigin: ReturnType<typeof worldPlacement>["setWorldOrigin"];
	view: ReturnType<typeof elementAndEngine>["view"]; zoomScroll: ReturnType<typeof worldPlacement>["zoomScroll"];
	zoomStill: ReturnType<typeof worldPlacement>["zoomStill"];
}) {
	const { ctl, element, origin, ownScroll, penLayer, placeScroll, placeWorld, setWorldOrigin, view, zoomScroll, zoomStill } = ctx;
	/*
	 * Back to the middle of the scroll area once the camera rests near an edge of it: the origin moves
	 * to the camera and the scroll to the middle in one task, so nothing on screen moves.
	 */
	createEffect(
		on(ctl.moving, (moving) => {
			if (moving || !element.now || view().width === 0) return;
			if (!nearEdge({ left: element.now.scrollLeft, top: element.now.scrollTop }, view())) return;
			const cam = ctl.now();
			origin.now = { x: cam.x, y: cam.y };
			setWorldOrigin(origin.now);
			placeWorld(cam.zoom, true);
			placeScroll(cam);
			// A zoom not yet rested keeps the scroll it now has.
			if (zoomScroll.now) zoomScroll.now = scrollFor(cam, origin.now, view());
		}, { defer: true }),
	);
	// The camera's motion, as the controller tracks it (`camera/controller.ts`).
	const { moving, scaling, gliding, panning } = ctl;
	// The zoom has rested: from here the scroll and the camera agree again, and a pan sets the scroll as before.
	createEffect(
		on(scaling, (now) => {
			if (now) return;
			zoomScroll.now = undefined;
			// A zoom that moved nothing: the world and the canvas are placed for where it rested.
			if (zoomStill.now) {
				zoomStill.now = false;
				placeWorld(ctl.now().zoom, true);
				penLayer.holdStill(false);
			}
		}, { defer: true }),
	);
	/*
	 * The stage scrolled: the browser has moved the world already, and the camera follows. A scroll
	 * this file set (`placeScroll`) comes back here too, and is not the person's.
	 */
	const scrolled = () => {
		const at = { left: element.now.scrollLeft, top: element.now.scrollTop };
		const own = ownScroll.now;
		if (own && Math.abs(at.left - own.left) < 1 && Math.abs(at.top - own.top) < 1) return;
		ownScroll.now = undefined;
		// A scroll in the middle of a zoom (fingers, a wheel): its later steps keep the view at the scroll it moved to.
		if (zoomScroll.now) zoomScroll.now = at;
		ctl.scrolled(cameraFor(at, origin.now, ctl.now().zoom, view()));
	};
	return { moving, scaling, gliding, panning, scrolled };
}
