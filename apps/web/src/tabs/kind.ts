import type { JSX } from "solid-js";
import type { Parts } from "../app/parts.ts";

/**
 * A tab: a place the person looks at, as a kind and a target.
 *
 * The row, the strip and the window know only this. What a canvas, a document, an app or a card is,
 * and what showing one takes, is its kind's to say (`TabKind`, one file each in `kinds/`).
 */
export interface Tab {
	/** Its own name in the row, the same for as long as it is open. */
	id: string;
	/** Which kind answers for it (`kinds.ts`). */
	kind: string;
	/**
	 * What it shows, as its kind names it: a canvas's folder. Left out by the home tab, a canvas tab
	 * whose canvas is not fixed: it is the canvas of the conversation on screen, whichever that is now.
	 */
	target?: string;
}

/** A kind of tab: what the row and the window ask of it, the same questions for every kind. */
export interface TabKind {
	name: string;
	/** What a tab of this kind is called in the row. */
	title(tab: Tab): string | undefined;
	/**
	 * What fills the window while a tab of this kind is in front. Made once for the kind and told which
	 * tab it is showing (`tab`), so going from one tab to another of the same kind keeps what was made:
	 * a canvas's frame moves to the other canvas in place.
	 */
	view(tab: () => Tab, parts: Parts): JSX.Element;
}
