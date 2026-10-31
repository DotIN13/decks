import type { Page, Camera } from "@decks/protocol";
import { createEffect, onCleanup, onMount, untrack } from "solid-js";
import { boxOf, canvasBox, createLanding, type CameraOwner } from "@decks/canvas/camera";
import { baseTheme, placements } from "@decks/pen";
import type { AgentViews } from "../camera/agent-views.ts";
import { scheme } from "../lib/theme.ts";
import { camera, moveCamera } from "../state/camera.ts";
import { state } from "../state/deck.ts";
import { selected, setSelected } from "../state/selection.ts";
import { stageOf, stages } from "../state/stages.ts";
import { reportCamera, setCameraAndReport } from "./camera-report.ts";

/** What the landing reads of the page. */
export interface LandingInputs {
	views: () => AgentViews;
	/** The drawing on screen: its doc and the canvas it is (`stagePen`). */
	stagePen: () => { doc: Parameters<typeof placements>[0]; scope?: string } | undefined;
	stagePages: () => Page[];
	/** How many deck frames have arrived. */
	deckSeen: () => number;
}

/*
 * The camera, and whose it is (`camera/landing.ts`, shared with the canvas frame's views for other
 * conversations, which it hands here to keep): a view kept per agent and canvas on this device,
 * taken back exactly on arriving there, else the middle of everything on the canvas once its
 * drawing is on screen. An agent with no canvas waits for a deck frame sent after it began, since
 * its boards are the deck's.
 */
export function createCameraLanding({ views, stagePen, stagePages, deckSeen }: LandingInputs) {
	/**
	 * Everything on the canvas in view, for framing it: its boards and every item drawn round them
	 * (notes, shapes, arrows, ink, frames), so a canvas that is mostly drawing is framed on its drawing.
	 */
	const canvasBoxes = (): Array<{ x: number; y: number; w: number; h: number }> => {
		const boxes = stagePages().map(boxOf);
		const doc = stagePen()?.doc;
		if (doc) {
			const placed = placements(doc, { theme: baseTheme(doc, scheme() === "dark" ? "dark" : "light") });
			for (const node of doc.children ?? []) {
				const box = placed.get(node.id)?.box;
				if (box && box.w > 0 && box.h > 0) boxes.push({ x: box.x, y: box.y, w: box.w, h: box.h });
			}
		}
		return boxes;
	};
	const landing = createLanding({
		views: () => views(),
		camera: () => untrack(camera),
		selected: () => untrack(selected),
		boxes: () => untrack(canvasBoxes),
		viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
		region: canvasBox,
		current: (to) => state.focused === to.scope && stageOf(to.scope)?.name === to.canvas,
		onScreen: (to) => !to.canvas || untrack(stagePen)?.scope === to.canvas,
		waitFor: (to, first) => {
			/*
			 * The page's first landing has no canvas being left, and its deck frame usually came before it
			 * began, so it takes any frame at all; it also waits for the canvas's boards themselves, the deck
			 * frame on hand may not have put them in play yet. A canvas's boards are in its drawing, so a
			 * switch to a canvas waits for nothing more: a switch by `agent.update` is followed by no deck frame.
			 */
			const deckAt = first ? 0 : untrack(deckSeen);
			return () => (to.canvas && !first ? true : untrack(deckSeen) > deckAt) && (!first || untrack(stagePages).length > 0);
		},
		land: (next, to) => {
			moveCamera(next);
			reportCamera(next, to.scope);
		},
		select: (path) => setSelected(path),
	});
	onCleanup(landing.stop);
	const personMoved = (next: Camera) => {
		landing.personMoved(next);
		setCameraAndReport(next);
	};
	createEffect(() => {
		const agent = state.focused;
		const canvas = stageOf(agent)?.name;
		// Not before the canvases are known: an agent's canvas read as none would land once for no canvas, then again.
		if (!agent || (!canvas && stages().length === 0)) return;
		const to: CameraOwner = { scope: agent, ...(canvas ? { canvas } : {}) };
		untrack(() => landing.arrive(to, stageOf(agent)?.formerly));
	});
	return { park: landing.park, personMoved };
}

/**
 * One reading at startup, so an agent knows the canvas before anybody pans.
 *
 * Until now the server only ever heard about the camera *after* a gesture: a session
 * where the user asked one question and never touched the canvas reported nothing, and
 * `decks.view.viewport()` had nothing to answer with. Read at fire time rather than now,
 * because the deck arrives and fits itself in the first moments and this should carry
 * where that left the camera, not the {0,0,1} it started at.
 *
 * Once there is a conversation to report it for: a reading has to name whose stage it is,
 * and the deck may still be arriving at 400ms. A later switch reports from its landing (`settle`).
 *
 * And again whenever this browser is come back to: the harness answers an agent's `view.camera` with
 * the newest reading of its canvas from any device (`deck/cameras.ts`), and the device the person is
 * on now is the one whose view that should be, even before they pan.
 */
export function reportCameraOnArrival() {
	let reportedOpening = false;
	createEffect(() => {
		const id = state.focused;
		if (!id || reportedOpening) return;
		reportedOpening = true;
		const timer = window.setTimeout(() => {
			if (state.focused === id) reportCamera(camera(), id);
		}, 400);
		onCleanup(() => clearTimeout(timer));
	});
	onMount(() => {
		const again = () => {
			if (document.visibilityState === "visible" && state.focused) reportCamera(camera(), state.focused);
		};
		window.addEventListener("focus", again);
		document.addEventListener("visibilitychange", again);
		onCleanup(() => {
			window.removeEventListener("focus", again);
			document.removeEventListener("visibilitychange", again);
		});
	});
}
