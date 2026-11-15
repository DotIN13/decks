/**
 * Which items are files: the marks alone, with nothing else imported, so the editor's core can
 * ask (`editor/core/pick.ts`) without the card's markdown machinery. `card-frame.ts` builds them.
 */
import type { PenNode } from "@decks/pen";

/** A file in the deck, as a piece: pen's own frame holding an icon and the file's name. */
export const FILE = "decks.file";
export const isFile = (node: PenNode | undefined) => node?.type === "frame" && node.metadata?.type === FILE;

/** An SVG shown live on the canvas, as itself. */
export const LIVE_FILE = "decks.live-file";
export const isLiveFile = (node: PenNode | undefined) => node?.metadata?.type === LIVE_FILE;
