import type { Accessor } from "solid-js";
import type { Camera } from "@decks/protocol";
import { createSignal } from "solid-js";
import { type Viewport } from "../camera/camera.ts";
import { createCameraController } from "../camera/controller.ts";
import { cameraFor, originFor, scrollFor, worldTransform, type Origin } from "../camera/scroll-area.ts";
import { CanvasEngine } from "../render/engine.ts";
import { type CanvasViewProps } from "./CanvasView.tsx";
import { createWorldRest } from "./world-rest.ts";

/** What `createWorld` reads of `CanvasView` (`CanvasView.tsx`), each read when it is used. */
export interface WorldNeeds {
	readonly props: CanvasViewProps;
	readonly worldEl: HTMLDivElement;
	readonly element: HTMLDivElement;
	readonly view: Accessor<Viewport>;
	readonly penLayer: CanvasEngine;
	readonly cameraChanged: () => void;
}

export function createWorld(d: WorldNeeds) {
	/**
	 * The camera: where it is, whether it is moving, and the one place that moves it (`camera/controller.ts`).
	 * The canvas hands it the window, how to place the world and the drawing at a camera, and its host's
	 * camera to follow.
	 */
	/*
	 * The canvas scrolls (`camera/scroll-area.ts`): the camera's position is the canvas's scroll, and the
	 * world is placed in the scrolled content at `origin`, scaled by the zoom. A pan is the browser
	 * scrolling, which moves the world on its compositor; a step of ours (a zoom, a key, a glide, a
	 * drag) sets the scroll and, when the zoom or the origin changed, the world's transform.
	 */
	let origin: Origin = { x: d.props.camera.x, y: d.props.camera.y };

	/** The origin as a signal, for the host's world layer (`props.world`), which is placed from it. */
	const [worldOrigin, setWorldOrigin] = createSignal<Origin>(origin);

	/** The origin and zoom the world's transform was last written for (`placeWorld`): what a child of the world is placed in. */
	const [worldPlaced, setWorldPlaced] = createSignal<{ x: number; y: number; zoom: number }>({ x: origin.x, y: origin.y, zoom: d.props.camera.zoom });

	/** The origin and zoom the world's transform was last written for. */
	let worldFor: { x: number; y: number; zoom: number } | undefined;

	/** The scroll this file last set, so the scroll event that answers it is not taken for the person's. */
	let ownScroll: { left: number; top: number } | undefined;

	const placeWorld = (zoom: number, force = false) => {
		if (!force && worldFor && worldFor.x === origin.x && worldFor.y === origin.y && worldFor.zoom === zoom) return;
		worldFor = { x: origin.x, y: origin.y, zoom };
		setWorldPlaced(worldFor);
		d.worldEl.style.transform = worldTransform(origin, zoom);
	};

	const placeScroll = (cam: Camera) => {
		if (!d.element || d.view().width === 0) return;
		const to = scrollFor(cam, origin, d.view());
		ownScroll = to;
		d.element.scrollTo(to.left, to.top);
	};

	/**
	 * While the zoom is changing, the scroll it found when it began (read once): the view then changes
	 * by the world's origin alone (`originFor`), and the scroll is left where it is until the zoom rests.
	 * One rule for every zoom: fingers, a trackpad's pinch, Ctrl and the wheel, Safari's gesture events,
	 * the zoom keys, a glide. Setting the scroll at each step made the browser lay out and scroll the
	 * whole area: a third of a pinch's script time on an iPad mini, and 8 to 27% of a zoom's on a Mac.
	 */
	let zoomScroll: { left: number; top: number } | undefined;

	/** Whether this zoom moves nothing in the DOM (`place` above): no card node is in the world. */
	let zoomStill = false;

	/** The zoom the world was last placed at, to tell a zoom step from a pan. */
	let placedZoom: number | undefined;

	const ctl = createCameraController({
		view: d.view,
		place: (cam) => {
			const zooming = placedZoom !== undefined && cam.zoom !== placedZoom;
			placedZoom = cam.zoom;
			if (zooming && !zoomScroll && d.element) {
				zoomScroll = { left: d.element.scrollLeft, top: d.element.scrollTop };
				/*
				 * A zoom with no card node in the world moves nothing in the DOM: the world and the sheet's
				 * canvas stay where they are, the canvas covering the window as it did, and the engine draws
				 * the window at each step's camera into it (`holdStill`). Each step set two inline transforms,
				 * and in Chromium each set rebuilt the paint property tree and assigned every layer on the
				 * page again, even with the transform promised: a quarter of a zoom's main thread over 100
				 * cards as pictures. With a card's page in the world the world has to move, as its page is
				 * stretched on its own layer (`data-scaling`); nothing wakes mid-gesture, so this is decided once.
				 */
				zoomStill = !d.worldEl.querySelector(".card-node");
				d.penLayer.holdStill(zoomStill);
			}
			if (zoomScroll) {
				origin = originFor(cam, zoomScroll, d.view());
				setWorldOrigin(origin);
				if (!zoomStill) placeWorld(cam.zoom, true);
				d.penLayer.setCamera(cam);
				return;
			}
			placeWorld(cam.zoom);
			placeScroll(cam);
			// The drawing moves in the same call as the cards, so the two can never be a frame apart.
			d.penLayer.setCamera(cam);
		},
		follow: (cam) => d.penLayer.setCamera(cam),
		moved: () => d.cameraChanged(),
		publish: (cam) => d.props.setCamera(cam),
		asked: () => ({ camera: d.props.camera, glide: d.props.glide }),
		flush: () => d.penLayer.frames.flush(),
	});

	const { panning, scaling, moving, gliding } = createWorldRest({
		ctl,
		outer: d,
		get origin() {
			return origin;
		},
		set origin(next) {
			origin = next;
		},
		setWorldOrigin,
		placeWorld,
		placeScroll,
		get zoomScroll() {
			return zoomScroll;
		},
		set zoomScroll(next) {
			zoomScroll = next;
		},
		get zoomStill() {
			return zoomStill;
		},
		set zoomStill(next) {
			zoomStill = next;
		},
	});

	/*
	 * The canvas scrolled: the browser has moved the world already, and the camera follows. A scroll
	 * this file set (`placeScroll`) comes back here too, and is not the person's.
	 */
	const scrolled = () => {
		const at = { left: d.element.scrollLeft, top: d.element.scrollTop };
		const own = ownScroll;
		if (own && Math.abs(at.left - own.left) < 1 && Math.abs(at.top - own.top) < 1) return;
		ownScroll = undefined;
		// A scroll in the middle of a zoom (fingers, a wheel): its later steps keep the view at the scroll it moved to.
		if (zoomScroll) zoomScroll = at;
		ctl.scrolled(cameraFor(at, origin, ctl.now().zoom, d.view()));
	};

	return {
		ctl,
		scrolled,
		panning,
		scaling,
		moving,
		gliding,
		worldOrigin,
		worldPlaced,
	};
}
