import type { Component, JSX } from "solid-js";
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
	 * What it shows, as its kind names it: a canvas's folder, a card's or a document's path in the deck. Left out by the home tab, a canvas tab
	 * whose canvas is not fixed: it is the canvas of the conversation on screen, whichever that is now.
	 */
	target?: string;
}

/** A kind of tab: what the row and the window ask of it, the same questions for every kind. */
export interface TabKind {
	name: string;
	/** The word it goes by in the window's address, `#<address>/<target>` (`remember.ts`). */
	address: string;
	/** What a tab of this kind is called in the row. */
	title(tab: Tab): string | undefined;
	/**
	 * What a message written while a tab of this kind is in front says the person was looking at, as
	 * the agent reads it: what it is, by the name an agent can act on (`about.ts`).
	 */
	says(tab: Tab): string | undefined;
	/** Its mark in the row. */
	icon: Component<{ size?: number }>;
	/**
	 * What fills the window while a tab of this kind is in front. Made once, the first time one is, and
	 * told which tab of its kind is in front now, or none while another kind is: the canvas keeps its
	 * frame and hides it, and moves it from one canvas to the next in place; a card is put away.
	 */
	view(tab: () => Tab | undefined, parts: Parts): JSX.Element;
}
