/**
 * What a new card's size and head are made from: the width it starts at, and the import map
 * its head carries (`cards.ts`). Boards are no longer made; the boards-to-cards migration reads
 * `BOARD_W` for an old board that named no width.
 */

/**
 * The width a new board starts at when nobody asked for one: 1000, which is the measure a board is
 * written to and about as wide as one is read at.
 */
export const BOARD_W = 1000;

/**
 * The width a board is worth keeping under, and it is **guidance, not a limit**.
 *
 * There used to be a hard cap here: 1600, clamped by `boardWidth` and again by `decks.canvas.fit`,
 * so a board that needed to be wider was quietly narrowed and its content left clipped.
 * That is the wrong trade — the thing being protected is readability, and a caller who
 * means 1800 has a reason that cannot be seen from in here. **Nothing is clamped now.**
 * What is left is a number to aim under, and defaults that are small on a small screen.
 *
 * 1200, because past it the eye loses its place coming back for the next line — and because
 * a board is read at the size the canvas has: `decks.view.viewport()` is the room on screen, not
 * divided by the zoom, so a board wider than the viewport is read scaled down.
 */
export const WIDE_BOARD_W = 1200;

/**
 * A width a board may actually be: what was asked for, or the default (`BOARD_W`), clamped.
 *
 * `viewport` is the room the canvas has (`decks.view.viewport()`), and `undefined` means nobody
 * is looking — a board written by an agent nobody is watching gets the default rather than a
 * guess, because a guess would be indistinguishable from a measurement at the point it got used.
 */
export function boardWidth(wanted: number | undefined, viewport: number | undefined): number {
	/*
	 * The room on screen, or nothing — and **no ceiling of our own**.
	 *
	 * This used to be `min(viewport, 1600)`, which capped a board on a large screen at a
	 * number nobody had asked for. What is left is the screen: a default should fit the
	 * device it will be read on, which is what keeps a phone's boards narrow.
	 */
	const room = viewport && viewport > 0 ? viewport : Number.POSITIVE_INFINITY;
	// A width somebody typed is theirs, whatever it is. The default is the only thing this
	// function decides, and an agent that means 1800 has a reason we cannot see from here.
	if (wanted) return Math.round(wanted);
	return Math.max(320, Math.min(BOARD_W, room));
}

/**
 * The libraries a new board can import by bare name, and the exact version each resolves to.
 *
 * One map, put into every new card's head (`cards.ts`), so the versions are bumped in one place.
 * **It costs a card nothing.** An import map is a table of names — the browser fetches a library
 * only when a card actually imports it, and nothing is fetched at all for one that never does.
 *
 * Pinned rather than `@latest`, because a file's bytes are supposed to say what it renders; an
 * agent that wants another version edits the map in the board it is writing, which is the one it
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
