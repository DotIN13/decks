/**
 * Cards on a canvas, read from and written to its file (`canvas/pens.ts`), by anyone who names it.
 *
 * The canvas file is the one record of which cards are on a canvas, where, and how big. An agent
 * works on its own canvas (`agents/session.ts`), a person on the canvas on screen (`calls/person-canvas.ts`);
 * both come here with the canvas's name, and neither keeps a copy of what the file says.
 */
import type { Deck } from "../deck/loader.ts";
import { joinPlaces, type Box } from "../deck/place.ts";
import type { CanvasPens } from "./pens.ts";
import type { CardSpot } from "./cards-on.ts";

export interface OnCanvas {
	path: string;
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The deck's cards on a canvas, as its file has them. */
export function cardsOn(pens: CanvasPens, deck: Deck, name: string): OnCanvas[] {
	if (!pens.has(name)) return [];
	try {
		return pens.cards.cards(name).filter((one) => deck.card(one.path));
	} catch {
		return [];
	}
}

/** What is drawn on a canvas besides its cards, which a joining card keeps clear of. */
function drawnOn(pens: CanvasPens, name: string): Box[] {
	try {
		return pens.cards.drawn(name);
	} catch {
		// A canvas file that does not parse still has its cards to place against.
		return [];
	}
}

/**
 * Put cards on a canvas. Each goes where `at` says, or near where `remembered` had it (a card taken
 * off and shown again), or into the nearest open slot beside the canvas's newest card (`deck/place.ts`),
 * at the size its own file states. A card already on the canvas is left where it is. Returns the paths
 * put on.
 */
export function putOn(
	pens: CanvasPens,
	deck: Deck,
	name: string,
	paths: readonly string[],
	options: { at?: Record<string, { x: number; y: number }>; remembered?: Record<string, { x: number; y: number }> } = {},
): string[] {
	const on = cardsOn(pens, deck, name);
	const present = new Set(on.map((one) => one.path));
	// A copy a canvas has just made of a card (`CanvasPens.ownPath`) is read now, before the watcher finds it.
	const joining = paths.filter((path, index) => paths.indexOf(path) === index && !present.has(path) && (deck.card(path) ?? deck.refresh(path)));
	if (joining.length === 0) return [];
	const known: Record<string, { x: number; y: number }> = { ...(options.remembered ?? {}) };
	const sizes: Record<string, { w: number; h: number }> = {};
	for (const one of on) {
		known[one.path] = { x: one.x, y: one.y };
		sizes[one.path] = { w: one.w, h: one.h };
	}
	const spots = joinPlaces({
		// The whole canvas is wanted: the cards on it are what a newcomer sits beside and keeps clear of.
		wanted: [...on.map((one) => one.path), ...joining],
		...(options.at ? { at: options.at } : {}),
		playing: on.map((one) => one.path),
		places: known,
		size: (path) => {
			const card = deck.card(path);
			return sizes[path] ?? (card ? { w: card.w, h: card.h } : undefined);
		},
		drawn: drawnOn(pens, name),
	});
	const placing: CardSpot[] = [];
	for (const path of joining) {
		const card = deck.card(path);
		const spot = spots[path] ?? known[path];
		if (card && spot) placing.push({ path, x: spot.x, y: spot.y, w: card.w, h: card.h, title: card.title });
	}
	pens.cards.placeCards(name, placing);
	return placing.map((one) => one.path);
}

/** Take cards off a canvas. Returns where each was, for whoever wants to put it back there. */
export function takeOff(pens: CanvasPens, deck: Deck, name: string, paths: readonly string[]): Record<string, { x: number; y: number }> {
	const was: Record<string, { x: number; y: number }> = {};
	for (const one of cardsOn(pens, deck, name)) if (paths.includes(one.path)) was[one.path] = { x: one.x, y: one.y };
	if (Object.keys(was).length) pens.cards.removeCards(name, Object.keys(was));
	return was;
}
