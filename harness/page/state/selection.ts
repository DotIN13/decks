import { createSignal } from "solid-js";

/*
 * What is selected, and which mode the canvas is in. It imports no other state module.
 * `createSelection()` gives a test its own; `selection` is the one the app uses.
 */

/**
 * What a click on the canvas means: **browse** reads the cards (text selects, a game plays, a
 * link opens) and still moves and retypes what is drawn; **edit** is for changing the drawing,
 * with its outlines, grips and distances. A card's own page is never edited from the canvas.
 */
export type CanvasMode = "browse" | "edit";

function createSelection() {
	/** The selected card, by path. */
	const [selected, setSelected] = createSignal<string | undefined>(undefined);

	/**
	 * Browse or edit (`CanvasMode`, above), and **browse is where every session starts**: a deck is
	 * read far more often than it is drawn, and browsing still moves and retypes what is drawn.
	 * Not persisted. A card's own page is never edited from the canvas, in either.
	 */
	const [mode, setMode] = createSignal<CanvasMode>("browse");

	return { selected, setSelected, mode, setMode };
}

export type Selection = ReturnType<typeof createSelection>;

/** The app's one selection. Tests build their own with `createSelection()`. */
export const selection = createSelection();

export const { selected, setSelected, mode, setMode } = selection;
