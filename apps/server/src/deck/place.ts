/**
 * Where a card goes when nobody said where.
 *
 * One rule, in one place, because the app has five ways for a card to arrive on a canvas —
 * an agent's `decks.canvas.insert`, the ＋ in the corner, a card picked out of the
 * panel, the shared-Chrome card — and each of them used to fall through to the deck's own auto-layout, which
 * put a new card below every card the canvas had ever had a place for: a column a million
 * pixels tall.
 *
 * The rule here is: **a card joins the canvas beside the canvas's newest card, stepping on to the
 * right past every card and drawn item in the way** (`@decks/deck-kit`, aim then step clear). The first card on an
 * empty canvas goes at the origin.
 *
 * **It reads what is on the canvas, and nothing about who is watching.** The anchor used to be the
 * middle of the camera, and that broke twice: first a view of another canvas, then the view of
 * whichever browser panned last, on any canvas. Both times cards landed tens of thousands of
 * pixels from their own. A canvas's contents are the same for every viewer, so the answer is too, and no
 * camera is taken as input anywhere in this file. Keep it that way: arriving where the person is
 * looking is the camera's job (`decks.view.focus` moves it onto the card), not the placement's.
 *
 * Nothing here reads or writes state. The caller is `agents/session.ts`, which owns the places,
 * the list of what is on the canvas and the drawing around it.
 */

import { GAP, placeBy, stepClear } from "@decks/deck-kit";

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Space left between cards. The same number `deck/loader.ts` lays its fallback rows on. */
export const GUTTER = GAP;

const touching = (a: Box, b: Box, gap: number): boolean =>
	a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** The one rectangle that holds all of them. */
export function bounds(boxes: readonly Box[]): Box | undefined {
	if (boxes.length === 0) return undefined;
	const left = Math.min(...boxes.map((box) => box.x));
	const top = Math.min(...boxes.map((box) => box.y));
	const right = Math.max(...boxes.map((box) => box.x + box.w));
	const bottom = Math.max(...boxes.map((box) => box.y + box.h));
	return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Where a card joins a canvas: aimed just right of the canvas's newest card, top edges level, then
 * on to the right past whatever is in the way (`@decks/deck-kit`, `stepClear`), so a row of
 * newcomers stays a row. With nothing on the canvas, the origin.
 *
 * `newest` is the card last put on the canvas, not the right-hand end of all of them: "beside
 * the card you were just shown" is the near that matters, and a row that has wrapped back or a
 * card dragged away should not drag every newcomer to the far edge.
 */
export function joinSpot(size: { w: number; h: number }, newest: Box | undefined, occupied: readonly Box[]): { x: number; y: number } {
	const aim = newest ? placeBy(newest, "beside") : { x1: 0, y1: 0 };
	const spot = stepClear(occupied, size, aim, "right", GUTTER);
	return { x: spot.x1, y: spot.y1 };
}

/**
 * Is the place a card already has near enough to keep when it joins the canvas?
 *
 * Yes when it sits within a card's length of the cards on the canvas — which is what makes hiding a card and playing it again put it back
 * in its own hole rather than at the end of the row. No when it is neither: that is a card still
 * carrying a place from the old deck-wide auto-layout, arriving a million pixels from anything.
 *
 * **An empty canvas keeps it too**, which is the case that has to be argued for rather than
 * assumed. There is nothing there to be near and so nothing to be far from, and a place is
 * somebody's decision — a drag, a drop, a deck laid out on purpose. Moving it here was worse than
 * useless: clearing the canvas and playing one card back moved it, and every arrangement was one
 * clear-and-replay from being rebuilt. Nothing is lost by keeping it, because the camera arrives
 * on a card you asked for.
 */
export function keepsPlace(box: Box, onCanvas: readonly Box[]): boolean {
	const cluster = bounds(onCanvas);
	if (!cluster) return true;
	const reach = GUTTER + Math.max(box.w, box.h);
	return touching(box, cluster, reach);
}

/**
 * The places a set of cards joining a canvas should take, and only the ones that need one.
 *
 * The three cases in order: a card with no place gets the nearest open slot beside the canvas's
 * newest card; a card whose place is near the cards already on the canvas keeps it; a card
 * whose place is far from all of them is placed again. What is returned is the new spots,
 * so the caller writes them into the agent's canvas.
 *
 * Pure, so the rule is tested apart from the canvas that uses it.
 */
export function joinPlaces(options: {
	wanted: readonly string[];
	playing: readonly string[];
	places: Readonly<Record<string, { x: number; y: number }>>;
	size: (path: string) => { w: number; h: number } | undefined;
	/**
	 * What else is drawn on the canvas (notes, shapes, frames, text), which a card must not land
	 * on either. Cards themselves come from `places`.
	 */
	drawn?: readonly Box[];
	/**
	 * Where the caller said a joining card goes, top-left corner. Taken as given, near or far,
	 * clear or not: an agent that names a place has decided, and saying what it sits on is the
	 * tool's job (`calls/tool.ts`), not a reason to move it here.
	 */
	at?: Readonly<Record<string, { x: number; y: number }>>;
}): Record<string, { x: number; y: number }> {
	const { wanted, playing, places, size, drawn = [], at = {} } = options;
	const joining = wanted.filter((path) => !playing.includes(path) && size(path) !== undefined);
	const spots: Record<string, { x: number; y: number }> = {};
	if (joining.length === 0) return spots;
	const boxOf = (path: string): Box | undefined => {
		const dimensions = size(path);
		const at = places[path];
		return dimensions && at ? { x: at.x, y: at.y, ...dimensions } : undefined;
	};
	const onCanvas = wanted
		.filter((path) => playing.includes(path))
		.map(boxOf)
		.filter((box): box is Box => box !== undefined);
	/*
	 * What a newcomer has to keep clear of: the cards on the canvas, and any card that is merely
	 * *near* — placed, hidden, and close enough that playing it again would put it back where it
	 * is. Everything else is filtered out by the same test, which keeps this cheap on a canvas that
	 * still carries a place for hundreds of cards.
	 */
	const occupied = [...onCanvas, ...drawn];
	for (const path of Object.keys(places)) {
		if (wanted.includes(path)) continue;
		const box = boxOf(path);
		if (box && keepsPlace(box, onCanvas)) occupied.push(box);
	}
	/* The named places first, so the cards placed for themselves keep clear of them. */
	for (const path of joining) {
		const dimensions = size(path);
		const named = at[path];
		if (!dimensions || !named) continue;
		const spot = { x: Math.round(named.x), y: Math.round(named.y) };
		spots[path] = spot;
		onCanvas.push({ ...spot, ...dimensions });
		occupied.push({ ...spot, ...dimensions });
	}
	for (const path of joining) {
		const dimensions = size(path);
		if (!dimensions || at[path]) continue;
		const held = places[path];
		if (held && keepsPlace({ ...held, ...dimensions }, onCanvas)) {
			onCanvas.push({ ...held, ...dimensions });
			occupied.push({ ...held, ...dimensions });
			continue;
		}
		const spot = joinSpot(dimensions, onCanvas.at(-1), occupied);
		spots[path] = spot;
		// Both lists: the newcomer is part of the canvas the next one is measured against, and
		// part of what it has to miss.
		onCanvas.push({ ...spot, ...dimensions });
		occupied.push({ ...spot, ...dimensions });
	}
	return spots;
}
