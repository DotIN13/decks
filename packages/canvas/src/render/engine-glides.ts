import { knobs, probes } from "../base/debug.ts";
import { isArrow, type Frame } from "@decks/pen";
import { glideShifts, glideStep, shiftsFrom, type Shift } from "../edit/core/glide.ts";
import type { PenPreview } from "./types.ts";
import type { CanvasEngine } from "./engine.ts";

/**
 * Whether changes glide at all: not when the person asked their system for less motion, and not when
 * a check or a page turned it off (`knobs.noGlide`). A drop still lands where it is dropped.
 */
function glidesWanted(): boolean {
	if (knobs.noGlide) return false;
	return typeof matchMedia !== "function" || !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The glide of items to their new places: when a change moves what is drawn, each moved item is
 * shown where it was and eased to where it is (`edit/core/glide.ts`), a frame at a time. A part of
 * the engine (`engine.ts`), which it reaches through `of`.
 */
export class EngineGlides {
	constructor(private readonly of: CanvasEngine) {}

	/**
	 * Where what a drop can move was let go (`settle`), and the glide in hand: each item's shift from
	 * where it lands (and, for one that appeared, how much of its transparency is left), and when the
	 * last frame of it was.
	 */
	landing: ReadonlyMap<string, Frame> | undefined;

	private glide: { shifts: Map<string, Shift>; last: number; frame: number } | undefined;

	/**
	 * Where each item is drawn now: its laid-out box moved by the glide still in hand, its own shift
	 * or the shift of the item it is inside. What a new drawing's changes glide from, so a change
	 * that lands mid-glide goes on from where things are rather than jumping back.
	 */
	drawnBoxes(): Map<string, Frame> {
		const out = new Map<string, Frame>();
		const shifts = this.glide?.shifts;
		for (const [id, one] of this.of.placed) {
			let shift: Shift | undefined;
			for (let up: string | undefined = id; up && !shift; up = this.of.placed.get(up)?.parent) shift = shifts?.get(up);
			out.set(id, shift ? { x: one.box.x + shift.dx, y: one.box.y + shift.dy, w: one.box.w, h: one.box.h } : one.box);
		}
		return out;
	}

	/**
	 * The drawing that answers a drop is laid out: everything that moved glides from where it was let
	 * go to where it is now (`edit/core/glide.ts`). Shown before this drawing's first frame, so nothing is
	 * drawn where it lands before it has glided there. False when nothing moved.
	 */
	startGlide(): boolean {
		const landing = this.landing;
		this.landing = undefined;
		if (!landing || !this.of.page) return false;
		const shifts = glideShifts(landing, (id) => this.of.placed.get(id)?.box, (id) => this.of.placed.get(id)?.parent);
		return this.beginGlide(shifts);
	}

	/**
	 * Any other new drawing (an agent's edit, a friend's through Studio, undo): everything drawn
	 * somewhere else before glides from there, and what appeared rises in. Not while the camera moves
	 * (it would fight the pan), not while a gesture is showing its own preview, and not for a change
	 * of more than `MOST_GLIDING` items, which is a canvas changing whole.
	 */
	glideFrom(before: Map<string, Frame> | undefined): boolean {
		/*
		 * Not while a gesture is showing its own preview, nor with a drag of cards in hand: the server's
		 * answers to its steps land where the hand has them. A pan is no reason not to: the shifts are in
		 * canvas units and ride the scroll, and an agent's edit that lands while the person pans to follow
		 * it (or while a flick still coasts) used to jump in.
		 */
		if (!before || !this.of.page || this.of.cardLayer.shown !== undefined || this.of.cardLayer.carriedCount > 0 || this.of.cardLayer.cardsOnly || !glidesWanted()) return false;
		const appeared: string[] = [];
		for (const [id, one] of this.of.placed) if (!one.parent && !before.has(id)) appeared.push(id);
		// What is still fading in from the last drawing keeps its fade (`shiftsFrom`).
		const fading = new Map<string, number>();
		for (const [id, one] of this.glide?.shifts ?? []) if (one.fade !== undefined) fading.set(id, one.fade);
		const shifts = shiftsFrom(before, (id) => this.of.placed.get(id)?.box, (id) => this.of.placed.get(id)?.parent, appeared, fading);
		return this.beginGlide(shifts);
	}

	/**
	 * Run a glide: each frame the shifts decay (`glideStep`) and what is left is shown as a preview,
	 * the items lifted and drawn with their offset, an appeared one with its opacity still coming;
	 * when nothing is left the preview ends, which puts the items down into the tiles.
	 */
	private beginGlide(shifts: Map<string, Shift>): boolean {
		// An arrow never glides on its own: it is bent from its ends, which do (`bend`), and a route the server changed is drawn at once.
		for (const id of [...shifts.keys()]) {
			const node = this.of.placed.get(id)?.node;
			if (node && isArrow(node)) shifts.delete(id);
		}
		if (!shifts.size || !this.of.page) return false;
		if (this.glide) cancelAnimationFrame(this.glide.frame);
		// What glides now, for the checks (`smooth-edits.mjs`).
		probes.glide = () => (this.glide ? [...this.glide.shifts] : []);
		this.settling = false;
		const show = (now: Map<string, Shift>) => {
			const preview = new Map<string, PenPreview>();
			const offsets = new Map<string, { dx: number; dy: number }>();
			for (const [id, one] of now) {
				offsets.set(id, { dx: one.dx, dy: one.dy });
				const own = this.of.placed.get(id)?.node as { opacity?: unknown } | undefined;
				const base = typeof own?.opacity === "number" ? own.opacity : 1;
				preview.set(id, { dx: one.dx, dy: one.dy, ...(one.fade !== undefined ? { set: { opacity: Math.round(base * (1 - one.fade) * 1000) / 1000 } } : {}) });
			}
			this.of.previews.showPreview(preview);
			this.of.onGlide?.(offsets);
		};
		show(shifts);
		const step = () => {
			const glide = this.glide;
			if (!glide || this.of.disposed) return;
			const now = performance.now();
			const next = glideStep(glide.shifts, Math.min(0.1, (now - glide.last) / 1000));
			glide.last = now;
			if (!next.size) {
				this.glide = undefined;
				this.of.previews.showPreview(undefined);
				this.of.onGlide?.(undefined);
				return;
			}
			glide.shifts = next;
			// What a frame of the glide costs the main thread (the preview, the lift, the arrows, the draw): for the checks.
			const began = performance.now();
			show(next);
			const cost = knobs.glideCost;
			if (cost) cost.push(performance.now() - began);
			glide.frame = requestAnimationFrame(step);
		};
		this.glide = { shifts, last: performance.now(), frame: requestAnimationFrame(step) };
		return true;
	}

	/**
	 * A gesture was let go and its edit sent (`CanvasView.tsx`, `settleGesture`). When the drawing that
	 * answers it arrives, what it lifted is put down: painted back into the worker's tiles, and drawn
	 * here until they come (`landed`). Without this an item stayed lifted after its drop, drawn by
	 * the page every frame and holding the worker to the screen's tiles. A new gesture first cancels it.
	 */
	settle(landing?: ReadonlyMap<string, Frame>): void {
		this.settling = true;
		this.landing = landing;
	}

	settling = false;

	/** End a glide in hand, where it is: the items it lifted stay lifted for whoever is showing them now. */
	endGlide(): void {
		if (!this.glide) return;
		cancelAnimationFrame(this.glide.frame);
		this.glide = undefined;
		this.of.onGlide?.(undefined);
	}
}
