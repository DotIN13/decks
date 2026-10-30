/**
 * Which picture a card gets: the rung of this device's ladder (`PICTURES` in `device.ts`) its drawn
 * width needs. A card drawn 880 device pixels wide (1,100 px at 40% on a 2× screen, where cards go
 * live) wants the top rung; one drawn 220 wide (10%) the bottom. The server keeps exactly these widths
 * (`SMALL_WIDTHS` in `apps/server/src/boards/thumbs.ts`), and the GPU makes every smaller size of the
 * one fetched, so a zoom out never fetches.
 */

/** How far a rung may be stretched before the next one up is wanted: a picture drawn at most a quarter larger than it is still reads sharp. */
export const STRETCH = 1.25;

/** The smallest rung at least `1 / STRETCH` of the drawn width, in device pixels; the top rung when none is. */
export function rungFor(drawnPx: number, ladder: readonly number[]): number {
	for (const width of ladder) if (width * STRETCH >= drawnPx) return width;
	return ladder[ladder.length - 1]!;
}

/** How wide a card is drawn on the screen, in device pixels. */
export function drawnWidth(cardWidth: number, zoom: number, pixelRatio: number): number {
	return cardWidth * zoom * pixelRatio;
}

/** A card near the screen, for `upgrades`. */
export interface LadderCard {
	key: string;
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * The cards whose picture should go up a rung at rest, nearest the screen's middle first: each with
 * the rung it wants, where that is above the rung it holds (`held`, 0 for none). A card never goes down
 * here: a lower rung is what the budget does (`engine.ts`, `fitPictures`), not the zoom, so zooming
 * out keeps what was fetched and the GPU draws it smaller.
 */
export function upgrades(cards: readonly LadderCard[], held: (key: string) => number, at: { x: number; y: number; zoom: number }, pixelRatio: number, ladder: readonly number[]): Array<{ key: string; width: number }> {
	const out: Array<{ key: string; width: number; far: number }> = [];
	for (const card of cards) {
		const width = rungFor(drawnWidth(card.w, at.zoom, pixelRatio), ladder);
		if (width <= held(card.key)) continue;
		const far = Math.hypot(Math.max(card.x - at.x, 0, at.x - (card.x + card.w)), Math.max(card.y - at.y, 0, at.y - (card.y + card.h)));
		out.push({ key: card.key, width, far });
	}
	return out.sort((a, b) => a.far - b.far).map(({ key, width }) => ({ key, width }));
}
