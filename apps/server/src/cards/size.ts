import { CARD_W } from "@decks/deck-kit";
/**
 * What a new card's size and head are made from: the width it starts at, and the import map
 * its head carries (`cards.ts`).
 */

/**
 * The width a card is worth keeping under, and it is **guidance, not a limit**.
 *
 * There used to be a hard cap here: 1600, clamped by `cardWidth` and again by `decks.canvas.fit`,
 * so a card that needed to be wider was quietly narrowed and its content left clipped.
 * That is the wrong trade — the thing being protected is readability, and a caller who
 * means 1800 has a reason that cannot be seen from in here. **Nothing is clamped now.**
 * What is left is a number to aim under, and defaults that are small on a small screen.
 *
 * 1200, because past it the eye loses its place coming back for the next line — and because
 * a card is read at the size the canvas has: `decks.view.viewport()` is the room on screen, not
 * divided by the zoom, so a card wider than the viewport is read scaled down.
 */
export const WIDE_CARD_W = 1200;

/**
 * A width a card may actually be: what was asked for, or the default (`CARD_W`, deck-kit's), clamped.
 *
 * `viewport` is the room the canvas has (`decks.view.viewport()`), and `undefined` means nobody
 * is looking — a card written by an agent nobody is watching gets the default rather than a
 * guess, because a guess would be indistinguishable from a measurement at the point it got used.
 */
export function cardWidth(wanted: number | undefined, viewport: number | undefined): number {
	/*
	 * The room on screen, or nothing — and **no ceiling of our own**.
	 *
	 * This used to be `min(viewport, 1600)`, which capped a card on a large screen at a
	 * number nobody had asked for. What is left is the screen: a default should fit the
	 * device it will be read on, which is what keeps a phone's cards narrow.
	 */
	const room = viewport && viewport > 0 ? viewport : Number.POSITIVE_INFINITY;
	// A width somebody typed is theirs, whatever it is. The default is the only thing this
	// function decides, and an agent that means 1800 has a reason we cannot see from here.
	if (wanted) return Math.round(wanted);
	return Math.max(320, Math.min(CARD_W, room));
}

/**
 * The libraries a new card can import by bare name, and the exact version each resolves to.
 *
 * One map, put into every new card's head (`cards.ts`), so the versions are bumped in one place.
 * **It costs a card nothing.** An import map is a table of names — the browser fetches a library
 * only when a card actually imports it, and nothing is fetched at all for one that never does.
 *
 * Pinned rather than `@latest`, because a file's bytes are supposed to say what it renders; an
 * agent that wants another version edits the map in the card it is writing, which is the one it
 * will be read from. `three/addons/` is a prefix mapping, so `three/addons/controls/OrbitControls.js`
 * resolves beside the same `three` build the map names — those two have to match, or a scene ends up
 * with two copies of the library and an object from one is not an object from the other.
 */
export const IMPORT_MAP = JSON.stringify(
	{
		imports: {
			d3: "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm",
			three: "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js",
			"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/",
			gsap: "https://cdn.jsdelivr.net/npm/gsap@3.15.0/+esm",
			"chart.js": "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/+esm",
		},
	},
	null,
	2,
);
