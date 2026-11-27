import type { Page, Camera } from "@decks/protocol";
import { type Viewport } from "../camera/camera.ts";

/** What `PageCallout` is given (`Callout.tsx`). */
export interface PageCalloutProps {
	card?: Page;
	/** What the pill sits over, on the canvas: the card's box, or the drawn items' together. */
	box: { x: number; y: number; w: number; h: number };
	/** What a screen reader calls it. */
	label: string;
	camera: Camera;
	view: Viewport;
	/** Fit the item to the screen. New tab is the host's to open (`openInTab`): inside the canvas frame a link opens none, the sandbox allows no popup, so the page opens it. */
	onOpen: () => void;
	/** A card's ✕: take it off the canvas at once, its folder kept. */
	onHide?: () => void;
	/** In the ⋯ menu: a picture of what is selected to download, taken as `decks canvas screenshot` takes it; a card's path to the clipboard. */
	onExport?: (format: "png" | "pdf") => void;
	onCopyPath?: () => void;
	/** Comment on the whole card: the popup a selection gets, opened by the pill. */
	onComment?: () => void;
	/** For drawn items: copy them, take them off the canvas. */
	onDuplicate?: () => void;
	onDelete?: () => void;
	/** An app's window: load its page again, this window alone. */
	onReload?: () => void;
	/** A card or an app's window: load it again, this window alone, from the ⋯ menu. */
	onRefresh?: () => void;
	/**
	 * Ink selected, and an agent to hand it to: redraw it as a drawing, make a card of it, or send it as it
	 * is, for the agent to read and act on (a command written by hand is carried out). First, in words.
	 */
	ink?: { agent: string; onDrawing: () => void; onCard: () => void; onSend: () => void };
	/** Out of sight while something moves. */
	hidden?: boolean;
	/** The gap to the edge, in screen pixels, when something sits there the pill must leave clear (an item's arrow handles). */
	gap?: number;
	/** The other cards and items on the canvas, in its coordinates: the pill takes the slot that covers none of them. */
	obstacles?: () => ReadonlyArray<{ x: number; y: number; w: number; h: number }>;
}
