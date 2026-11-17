import type { ItemEnd, ItemStart } from "../kind-host.tsx";

/**
 * The document frame: one document, whole, in the frame every kind runs in (`@decks/frame`), as a tab
 * of its own shows it: its editor, its history and its review (`@decks/docs/page`), on the line of
 * the canvas that places it, which answers for the files that canvas's document items name.
 */

/** Everything a document frame starts from. */
export interface DocumentStart extends ItemStart {
	kind: "document";
	/** The document's file, by its path in the deck. */
	document: { path: string };
}

/** The frame's end: the shared words and the look, and none of its own. */
export type DocumentEnd = ItemEnd;
