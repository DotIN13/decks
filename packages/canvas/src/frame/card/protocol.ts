import type { ItemEnd, ItemStart } from "../kind-host.tsx";

/**
 * The card frame: one card, whole, in the frame every kind runs in (`@decks/frame`), as a tab of its
 * own shows it. The card is the canvas's still: it is read on its canvas's pass, its calls to the
 * canvas go to the harness on that pass, and the ones that are the page's (an agent sent words) are
 * asked of the page, as on the canvas. It says the shared words and one of its own.
 */

/** Everything a card frame starts from. `kind` tells the guest which kind to run: a canvas's start has none. */
export interface CardStart extends ItemStart {
	kind: "card";
	card: CardShown;
}

/** The card as the page knows it: its path in the deck, what it is called, its revision and its width. A friend's runs no scripts. */
export interface CardShown {
	path: string;
	title: string;
	rev: number;
	w: number;
	trusted: boolean;
}

/** What the page says to a card's frame beside the shared words and the look: the card, when its file changed. */
export interface CardWords {
	card: { rev: number; w: number };
}

/** The frame's end. */
export type CardEnd = ItemEnd<CardWords>;
