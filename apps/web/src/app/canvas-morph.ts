import type { Board, Camera } from "@decks/protocol";
import { boxOf, fit } from "../camera/camera.ts";
import { boundsOf, cameraInto, morphFrame, type WorldBox } from "../camera/morph.ts";
import { CLOSE_MS, moveCamera, OPEN_MS, reducedMotion } from "../state/camera.ts";

/**
 * Opening a canvas from its card, and going back into it.
 *
 * The card is a small picture of the canvas, so the canvas starts exactly inside the card and
 * grows to its own view (`camera/morph.ts` works out the first frame). Back is the same move
 * the other way: the canvas shrinks into the card it came from, and only then does the
 * dashboard take the screen again. Nothing cross-fades, so there is never a moment with two
 * layouts on screen at once.
 *
 * **Where you were on each canvas is kept, on this device**, the way a conversation's view
 * always was (`camera/agent-views.ts`): the camera belongs to the person looking, and a laptop
 * and a phone open on the same canvas want different windows. The open lands there; a canvas
 * you have never opened lands on a fit of its boards.
 */

const PREFIX = "decks.canvas-views:";

interface Storage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface CanvasMorph {
	/** A card was pressed: remember where, and grow out of it once the canvas's boards are here. */
	open(canvasId: string, card: DOMRect): void;
	/** The canvas this browser is on and its boards have arrived: run a pending open, if any. */
	arrived(canvasId: string, boards: readonly Board[]): void;
	/**
	 * Leaving a canvas for the dashboard: shrink into its card, then call `done`.
	 *
	 * Calls `done` at once when there is nothing to shrink into — no card on the shelf, nothing
	 * on the canvas, or a person who asked for less movement.
	 */
	leave(canvasId: string, boards: readonly Board[], done: () => void): void;
	/** Keep where the camera is, for the next time this canvas is opened. */
	keep(canvasId: string, camera: Camera): void;
}

export function createCanvasMorph(options: { deckPath: () => string; stage: () => Element | null; camera: () => Camera; storage?: Storage }): CanvasMorph {
	const storage = options.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
	let pending: { canvasId: string; card: DOMRect; at: number } | undefined;

	const run = (from: Camera, to: Camera, box: WorldBox, ms: number, done?: () => void) => {
		const rect = stageRect();
		flyAlong(from, to, box, { width: rect?.width ?? 0, height: rect?.height ?? 0 }, ms, done);
	};

	const read = (): Record<string, Camera> => {
		try {
			const raw = storage?.getItem(PREFIX + options.deckPath());
			const parsed = raw ? (JSON.parse(raw) as unknown) : {};
			return parsed && typeof parsed === "object" ? (parsed as Record<string, Camera>) : {};
		} catch {
			return {};
		}
	};
	const kept = (canvasId: string): Camera | undefined => {
		const view = read()[canvasId];
		return view && [view.x, view.y, view.zoom].every((n) => typeof n === "number" && Number.isFinite(n)) ? view : undefined;
	};
	const stageRect = () => options.stage()?.getBoundingClientRect();

	/** Where the canvas should land: the view left on it here, else a fit of its boards. */
	const destination = (canvasId: string, boards: readonly Board[]): Camera | undefined => {
		const rect = stageRect();
		if (!rect || boards.length === 0) return undefined;
		return kept(canvasId) ?? fit(boards.map(boxOf), { width: rect.width, height: rect.height });
	};

	return {
		open(canvasId, card) {
			pending = { canvasId, card, at: Date.now() };
		},

		arrived(canvasId, boards) {
			const opening = pending;
			if (!opening || opening.canvasId !== canvasId) return;
			pending = undefined;
			const to = destination(canvasId, boards);
			if (!to) return;
			const rect = stageRect();
			const box = boundsOf(boards.map(boxOf));
			/*
			 * A press answered late is not animated: a canvas that took more than a moment to
			 * arrive would otherwise grow out of a card the person has already stopped looking at.
			 */
			if (!rect || !box || reducedMotion() || Date.now() - opening.at > 1500) {
				moveCamera(to);
				return;
			}
			run(cameraInto(box, opening.card, rect), to, box, OPEN_MS);
		},

		leave(canvasId, boards, done) {
			this.keep(canvasId, options.camera());
			const card = document.querySelector(`.canvas-card[data-canvas-id="${CSS.escape(canvasId)}"] .canvas-strip`);
			const rect = stageRect();
			const box = boundsOf(boards.map(boxOf));
			if (!card || !rect || !box || reducedMotion()) {
				done();
				return;
			}
			run(options.camera(), cameraInto(box, card.getBoundingClientRect(), rect), box, CLOSE_MS, done);
		},

		keep(canvasId, camera) {
			try {
				storage?.setItem(PREFIX + options.deckPath(), JSON.stringify({ ...read(), [canvasId]: camera }));
			} catch {
				/* storage full or refused: the next open lands on a fit, which is fine */
			}
		},
	};
}

let flight = 0;

/**
 * Fly the camera frame by frame on the app's own curve, keeping `box` on a straight line across
 * the screen — the grow out of a card, the shrink back in, and the fall into a board's page.
 *
 * Not the stage's glide: that one moves the camera's centre linearly, which with a tenfold
 * change of zoom swings the boards off the screen in the middle of the move. `morphFrame` keeps
 * them on a line from where they were to where they land. Each frame is an ordinary camera set,
 * the same thing a finger's pan does, and a new flight cancels the one before it.
 */
export function flyAlong(from: Camera, to: Camera, box: WorldBox, view: { width: number; height: number }, ms: number, done?: () => void): void {
	cancelAnimationFrame(flight);
	const start = performance.now();
	moveCamera(from);
	const step = (now: number) => {
		const t = Math.min(1, (now - start) / ms);
		const eased = 1 - Math.pow(1 - t, 3);
		moveCamera(morphFrame(from, to, eased, box, view));
		if (t < 1) flight = requestAnimationFrame(step);
		else done?.();
	};
	flight = requestAnimationFrame(step);
}
