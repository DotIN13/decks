import type { Camera } from "@decks/protocol";
import { viewToPark } from "./agent-view.ts";
import type { AgentViews } from "./agent-views.ts";
import { frames as showsAny, type Viewport } from "./camera.ts";
import { landingCamera, sameOwner, type CameraOwner } from "./land.ts";
import type { Box } from "../model/boxes.ts";

/**
 * The camera, and whose it is: parking a view and landing one, for every host that keeps views per
 * key (the Decks page per agent and canvas, and the canvas frame's views for other conversations,
 * which it hands the page to keep).
 *
 * A view is kept per key on this device. The camera on screen has an **owner**, the key it last
 * landed for, and it is kept only under that owner: when the key on screen changes and when the
 * page goes. Between a switch and its landing there is no owner, so nothing is kept. Before,
 * whatever camera was on screen was kept under the agent being left, and a canvas with no boards
 * kept the last agent's camera: one round trip gave an agent another agent's view, for good.
 *
 * One path for every arrival, an agent picked, its canvas changed by anyone, the page opened: a
 * view this device left there comes back at once and exactly; with none, the landing waits for
 * that canvas to be on screen, then goes to the middle of everything on it (`landingCamera`). A
 * later arrival calls an earlier one off.
 */
export interface LandingHost {
	views(): AgentViews;
	camera(): Camera;
	/** The card or board selected, kept with the view. */
	selected(): string | undefined;
	/** Everything on the canvas on screen, boards and drawing alike, in canvas units. */
	boxes(): Box[];
	viewport(): Viewport;
	/** The part of the viewport the canvas has, without the panels standing over it. */
	region(viewport: Viewport): { x: number; y: number; width: number; height: number };
	/** Whether `to` is still the key that should be on screen: a landing for one that is not is called off. */
	current(to: CameraOwner): boolean;
	/** Whether the canvas on screen is `to`'s own (its drawing has come), so its boxes are its own. */
	onScreen(to: CameraOwner): boolean;
	/**
	 * Called as a landing with no kept view begins: what else it waits for, past `onScreen`, before it
	 * lands (`first`: the page's first landing). Not given, it waits for nothing more.
	 */
	waitFor?(to: CameraOwner, first: boolean): () => boolean;
	/** Put the camera there, and tell whoever keeps it (the harness, for `view.camera`). */
	land(next: Camera, to: CameraOwner): void;
	/** Select what the landed view had selected (or nothing). */
	select(path: string | undefined): void;
}

/** How long a landing waits for its canvas before it lands on what there is. */
const WAIT = 3000;

export interface Landing {
	/** The key the camera on screen belongs to, if it has landed. */
	owner(): CameraOwner | undefined;
	/** Keep the view on screen under its owner, if it has one. */
	park(): void;
	/**
	 * Arrive at a key: nothing when it is the one on screen or arriving; the view stays, kept under the
	 * new name, when only the canvas's name changed (`formerly`: its names before, the first having chosen
	 * its folder); else park the view on screen and land on the key.
	 */
	arrive(to: CameraOwner, formerly?: readonly string[]): void;
	/**
	 * The person moved the camera themselves (a pan, a pinch, a wheel), so a landing still waiting is
	 * called off and the view they made is theirs, kept under the canvas it was arriving at. Left
	 * waiting, it landed up to 3 s later and threw the view they had made away. Only once that canvas
	 * is on screen, and only a move that shows something of it: a move made over the canvas being left
	 * is not a view of the new one, and one over the empty canvas a page opens on (its origin, before
	 * the landing) is a person looking for it, whom the landing still brings there.
	 */
	personMoved(next: Camera): void;
	/** Stop a landing still waiting. */
	stop(): void;
}

export function createLanding(host: LandingHost): Landing {
	let owner: CameraOwner | undefined;
	/** The landing still waiting for its canvas, if any. */
	let arriving: (CameraOwner & { stop: () => void }) | undefined;
	/** A landing has happened: until then there is no earlier canvas whose frames could be mistaken for this one's. */
	let landedOnce = false;
	const stop = () => {
		arriving?.stop();
		arriving = undefined;
	};
	const park = () => {
		if (owner) host.views().keep(owner.scope, owner.canvas, viewToPark(host.camera(), host.selected()));
	};
	const fresh = () => landingCamera({ view: undefined, boxes: host.boxes(), viewport: host.viewport(), region: host.region(host.viewport()) });
	const settle = (to: CameraOwner, next: Camera, chosen?: string) => {
		landedOnce = true;
		stop();
		host.land(next, to);
		host.select(chosen);
		owner = to;
	};
	/*
	 * The first landing ran out of time before its canvas's items came (a slow server, a busy machine)
	 * and landed on nothing: when they come, it lands on them, unless the person has moved the camera
	 * since. Left alone, the page sat at the empty origin until they went looking.
	 */
	const landLate = (to: CameraOwner) => {
		const landed = host.camera();
		const moved = () => {
			const now = host.camera();
			return Math.abs(now.x - landed.x) > 0.5 || Math.abs(now.y - landed.y) > 0.5 || Math.abs(now.zoom - landed.zoom) > 1e-4;
		};
		const asked = Date.now();
		const timer = setInterval(() => {
			if (!host.current(to) || moved() || Date.now() - asked > 30000) return stop();
			if (host.boxes().length === 0) return;
			stop();
			host.land(fresh(), to);
		}, 100);
		arriving = { ...to, stop: () => clearInterval(timer) };
	};
	const landOn = (to: CameraOwner) => {
		stop();
		const view = host.views().of(to.scope, to.canvas);
		if (view) return settle(to, view.camera, view.selected);
		const first = !landedOnce;
		const more = host.waitFor?.(to, first) ?? (() => true);
		const asked = Date.now();
		const timer = setInterval(() => {
			// Called off by the next arrival; this is only a key changing under it without one.
			if (!host.current(to)) return stop();
			if (!(host.onScreen(to) && more()) && Date.now() - asked < WAIT) return;
			settle(to, fresh());
			if (first && host.boxes().length === 0) landLate(to);
		}, 100);
		arriving = { ...to, stop: () => clearInterval(timer) };
	};
	return {
		owner: () => owner,
		park,
		arrive: (to, formerly) => {
			if (sameOwner(owner, to) || sameOwner(arriving, to)) return;
			if (owner?.scope === to.scope && owner.canvas && formerly?.includes(owner.canvas)) {
				owner = to;
				return park();
			}
			park();
			owner = undefined;
			landOn(to);
		},
		personMoved: (next) => {
			const to = arriving;
			if (to && host.onScreen(to) && showsAny(next, host.viewport(), host.boxes())) {
				stop();
				owner = { scope: to.scope, ...(to.canvas ? { canvas: to.canvas } : {}) };
			}
		},
		stop,
	};
}
