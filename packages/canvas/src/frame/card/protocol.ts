import type { Peer, SharedCalls, SharedToFrame, SharedToPage } from "@decks/frame";

/**
 * The card frame: one card, whole, in the frame every kind runs in (`@decks/frame`), as a tab of its
 * own shows it. The card is the canvas's still: it is read on its canvas's pass, its calls to the
 * canvas go to the harness on that pass, and the ones that are the page's (an agent sent words) are
 * asked of the page, as on the canvas. It says the shared words and two of its own.
 */

/** Everything a card frame starts from. `kind` tells the guest which kind to run: a canvas's start has none. */
export interface CardStart {
	protocol: number;
	kind: "card";
	/** The canvas the card is on, whose pass this frame holds. */
	canvas: string;
	card: CardShown;
	backend: { api: string; token: string; expires: number };
	/** Where the canvas's files are read, the pass in the address. */
	files: { base: string; expires: number };
	/** The deck's import map, as the canvas's frame is given it. */
	imports?: Record<string, string>;
	look: CardLook;
}

/** Light or dark, and how much of the window's foot the page's composer covers: the card can be scrolled clear of it. */
export interface CardLook {
	dark: boolean;
	foot: number;
}

/** The card as the page knows it: its path in the deck, what it is called, its revision and its width. A friend's runs no scripts. */
export interface CardShown {
	path: string;
	title: string;
	rev: number;
	w: number;
	trusted: boolean;
}

/** Page to frame: the shared words, the look, and the card when its file changed. */
export interface PageToCard extends SharedToFrame {
	look: CardLook;
	card: { rev: number; w: number };
}

type NoCalls = Record<never, { data: unknown; value: unknown }>;

/** The page's end, and the frame's. */
export type CardPageEnd = Peer<PageToCard, NoCalls, SharedToPage, SharedCalls>;
export type CardEnd = Peer<SharedToPage, SharedCalls, PageToCard, NoCalls>;
