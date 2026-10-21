/**
 * Boards on a stage, read from and written to its file (`stage/pens.ts`), by anyone who names it.
 *
 * The stage file is the one record of which boards are on a stage, where, and how big. An agent
 * works on its own stage (`agents/session.ts`), a person on the stage on screen (`wire/boards.ts`);
 * both come here with the stage's name, and neither keeps a copy of what the file says.
 */
import type { Deck } from "../deck/loader.ts";
import { joinPlaces, type Box } from "../deck/place.ts";
import type { BoardSpot, StagePens } from "./pens.ts";

export interface OnStage {
	path: string;
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The deck's boards on a stage, as its file has them. */
export function boardsOn(pens: StagePens, deck: Deck, name: string): OnStage[] {
	if (!pens.has(name)) return [];
	try {
		return pens.boards(name).filter((one) => deck.board(one.path));
	} catch {
		return [];
	}
}

/** What is drawn on a stage besides its boards, which a joining board keeps clear of. */
export function drawnOn(pens: StagePens, name: string): Box[] {
	try {
		return pens.drawn(name);
	} catch {
		// A stage file that does not parse still has its boards to place against.
		return [];
	}
}

/**
 * Put boards on a stage. Each goes where `at` says, or near where `remembered` had it (a board taken
 * off and shown again), or into the nearest open slot beside the stage's newest board (`deck/place.ts`),
 * at the size its own file states. A board already on the stage is left where it is. Returns the paths
 * put on.
 */
export function putOn(
	pens: StagePens,
	deck: Deck,
	name: string,
	paths: readonly string[],
	options: { at?: Record<string, { x: number; y: number }>; remembered?: Record<string, { x: number; y: number }> } = {},
): string[] {
	const on = boardsOn(pens, deck, name);
	const present = new Set(on.map((one) => one.path));
	// A copy a canvas has just made of a board (`StagePens.ownPath`) is read now, before the watcher finds it.
	const joining = paths.filter((path, index) => paths.indexOf(path) === index && !present.has(path) && (deck.board(path) ?? deck.refresh(path)));
	if (joining.length === 0) return [];
	const known: Record<string, { x: number; y: number }> = { ...(options.remembered ?? {}) };
	const sizes: Record<string, { w: number; h: number }> = {};
	for (const one of on) {
		known[one.path] = { x: one.x, y: one.y };
		sizes[one.path] = { w: one.w, h: one.h };
	}
	const spots = joinPlaces({
		// The whole canvas is wanted: the boards on it are what a newcomer sits beside and keeps clear of.
		wanted: [...on.map((one) => one.path), ...joining],
		...(options.at ? { at: options.at } : {}),
		playing: on.map((one) => one.path),
		places: known,
		size: (path) => {
			const board = deck.board(path);
			return sizes[path] ?? (board ? { w: board.w, h: board.h } : undefined);
		},
		drawn: drawnOn(pens, name),
	});
	const placing: BoardSpot[] = [];
	for (const path of joining) {
		const board = deck.board(path);
		const spot = spots[path] ?? known[path];
		if (board && spot) placing.push({ path, x: spot.x, y: spot.y, w: board.w, h: board.h, title: board.title });
	}
	pens.placeBoards(name, placing);
	return placing.map((one) => one.path);
}

/** Take boards off a stage. Returns where each was, for whoever wants to put it back there. */
export function takeOff(pens: StagePens, deck: Deck, name: string, paths: readonly string[]): Record<string, { x: number; y: number }> {
	const was: Record<string, { x: number; y: number }> = {};
	for (const one of boardsOn(pens, deck, name)) if (paths.includes(one.path)) was[one.path] = { x: one.x, y: one.y };
	if (Object.keys(was).length) pens.removeBoards(name, Object.keys(was));
	return was;
}
