import type { Board, Camera } from "@decks/protocol";
import { boxOf, fitInto, frames } from "../lib/camera.ts";

/**
 * What a conversation remembers about the canvas, and what switching to it should do.
 *
 * The canvas has always been per agent — it is the focused agent's in-play set and nothing
 * else — while the camera was one value for the whole app. So switching swapped every board
 * on screen and left the camera exactly where the last conversation had it, and nothing
 * refitted, because the only automatic fit in the app runs once per page load. Two agents
 * working in different corners of a deck meant coming back to one of them and looking at
 * empty canvas 3000px from anything.
 *
 * The rule is not "fit on switch". A fit is a different gesture and you already have it on
 * `0`; what you want back is **the view you left**, position and zoom, so that returning to
 * a conversation is returning rather than re-finding. That is only possible when there is a
 * view to return to, which is why this is three cases rather than one.
 *
 * Pure, and tested in `agent-view.test.ts`. The alternative — deciding it inside
 * `focusAgent` — makes "what happens when the remembered boards are gone" a question you
 * can only answer by deleting a board and switching.
 */

/** What is remembered per agent. Not persisted: a reload starts over — see `App.tsx`. */
export interface AgentView {
	camera: Camera;
	/** The board that was selected, so returning restores the selection too. */
	selected?: string;
}

/**
 * Where the camera should go when you switch to an agent — or `undefined` for "stay put".
 *
 * Three cases, and only the middle one restores:
 *
 * 1. **Nothing on the canvas** → stay put. Moving to look at nothing is worse than not
 *    moving: the view would jump for no reason and land nowhere, and the panel already says
 *    why the canvas is empty. This is also the common case for a brand-new agent.
 * 2. **A remembered view that still shows at least one of its boards** → that view, exactly.
 *    Not a fit of those boards — the position and zoom as they were, including the fact that
 *    you had scrolled to the corner of one of them.
 * 3. **A remembered view that has stopped showing anything**, or no memory at all → fit what
 *    it has now. Boards get moved, hidden and shown while you are reading another chat, so a
 *    saved camera can be pointing at empty canvas by the time you come back — and a view of
 *    nothing that *looks* like a view of something is worse than a fresh fit.
 *
 * `playing` is what the agent has on the canvas; `boards` is the deck, needed to turn those
 * paths into boxes. A path in `playing` that the deck no longer has is ignored throughout —
 * a deleted board can sit in a remembered in-play set.
 *
 * `region` is the part of the window the canvas actually has — the window minus the panel
 * and the floats. Case 3 frames into it with `fitInto`, which is what the app's own Fit
 * button does; framing into the whole window instead would centre a board behind the boards
 * panel, and a fit that hides what it framed is worse than no fit.
 */
export function viewOnSwitch(input: {
	view: AgentView | undefined;
	playing: string[];
	boards: Board[];
	viewport: { width: number; height: number };
	region: { x: number; y: number; width: number; height: number };
}): Camera | undefined {
	const known = new Map(input.boards.map((board) => [board.path, board]));
	const live = input.playing.filter((path) => known.has(path));

	// 1 · nothing to look at.
	if (live.length === 0) return undefined;

	const boxes = live.map((path) => boxOf(known.get(path)!));

	/*
	 * 2 · a remembered view that still has something of its own on screen.
	 *
	 * "Still shows one of its boards" is asked of the *current* in-play set rather than of
	 * whatever was playing when the view was saved, and it is asked of the geometry rather
	 * than assumed. Merely having a memory is not enough: a board moved across the deck while
	 * you were in another conversation leaves the saved camera pointing at nothing, and
	 * putting it back regardless recreates the empty-canvas bug from the other end.
	 */
	if (input.view && frames(input.view.camera, input.viewport, boxes)) return input.view.camera;

	// 3 · no memory, or one that has stopped showing anything: frame what it has now.
	return fitInto(boxes, input.viewport, input.region);
}

/**
 * The selection to restore, dropped if the board is no longer on that agent's canvas.
 *
 * A selection is a thing on screen, so restoring one for a board the agent has since hidden
 * would put a handle around nothing. Cleared rather than kept, which is the same rule the
 * *component* selection has always had on switch — the two were inconsistent, and this is
 * the half that was wrong.
 */
export function selectionOnSwitch(view: AgentView | undefined, playing: string[]): string | undefined {
	if (!view?.selected) return undefined;
	return playing.includes(view.selected) ? view.selected : undefined;
}

/**
 * Park what is on screen under the agent you are leaving.
 *
 * Called with the live camera and selection at the moment of switching away. Returns the
 * record to store rather than storing it, so the caller owns the map and this stays pure.
 */
export function viewToPark(camera: Camera, selected: string | undefined): AgentView {
	return { camera: { ...camera }, ...(selected ? { selected } : {}) };
}
