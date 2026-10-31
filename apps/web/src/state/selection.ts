import { createSignal } from "solid-js";

/**
 * What is selected, and which mode the canvas is in.
 *
 * Layer 0 of the state split: this module imports nothing from the others, and several of
 * them import it. It is the smallest of the three at the bottom of the graph, which is why
 * it goes first — the pattern it sets is the one the other twelve follow.
 *
 * **A factory and a singleton, not a bare singleton.** `createSelection()` is what a test
 * calls to get its own; `selection` is the one the app uses. That is the shape opencode uses
 * for `createServerSession`, and the reason that store has a test file at all — module state
 * that can only exist once is module state no test can set up.
 *
 * Nothing here needs an owner: signals work at module scope, and only `onMount`,
 * `onCleanup` and `createEffect` require a component to hang from. Those stay in `App.tsx`,
 * where they belong.
 */
/**
 * What a click on the canvas means: **browse** reads the boards (text selects, a game plays, a
 * link opens) and still moves and retypes what is drawn; **edit** is for changing the drawing,
 * with its outlines, grips and distances. A board's own page is never edited from the canvas.
 */
export type CanvasMode = "browse" | "edit";

function createSelection() {
	/** The selected board, by path. */
	const [selected, setSelected] = createSignal<string | undefined>(undefined);

	/**
	 * Browse or edit (`CanvasMode`, above), and **browse is where every session starts**: a deck is
	 * read far more often than it is drawn, and browsing still moves and retypes what is drawn.
	 * Not persisted. A board's own page is never edited from the canvas, in either.
	 */
	const [mode, setMode] = createSignal<CanvasMode>("browse");

	return { selected, setSelected, mode, setMode };
}

export type Selection = ReturnType<typeof createSelection>;

/** The app's one selection. Tests build their own with `createSelection()`. */
export const selection = createSelection();

export const { selected, setSelected, mode, setMode } = selection;
