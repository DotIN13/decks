import type { Page } from "@decks/protocol";
import type { PageView } from "./page-view.ts";

/**
 * What the stage hands the slot of one placed item (`CanvasView`'s `frame` prop): a card, a document or
 * an app.
 *
 * The stage decides where it is, whether it is awake and what its gestures do; the host adds what it
 * knows of the item's file (`ItemSlotExtras`).
 */
export interface ItemSlotProps {
	board: Page;
	/** The camera's zoom: an edge band is sized in screen pixels. */
	zoom: number;
	/** Whether the item is awake: a card, an app or a document chosen near the window (`items/awake.ts`). */
	mounted: boolean;
	/** Whether the item is on screen or within a window of it. */
	visible: boolean;
	/**
	 * Mounted but asleep: a card let go lately, kept with its root so waking it again is instant
	 * (`items/awake.ts`, `kept`). Hidden, and drawn by the sheet as its picture; it takes a press as
	 * a sleeping card's slot does. Its scripts go on running: a card has no way to be paused.
	 */
	asleep?: boolean | undefined;
	/** Asleep and kept (`items/awake.ts`, `kept`), rather than on its way out: for the node's `data-state`. */
	kept?: boolean | undefined;
	/** The sheet is drawing this item's picture over it: only then does an asleep card hide, so it never leaves bare canvas for a frame. */
	covered?: boolean | undefined;
	selected: boolean;
	/**
	 * Its surface is showing, or has stopped showing. Until it says so the sheet keeps the item's
	 * picture over it, so a card never flashes empty on its way from a picture to its surface.
	 */
	onLive?: (live: boolean) => void;
	/** A drag carries this item's picture (`PenLayer.carry`): its surface waits, unseen, for the move to land. */
	carried?: boolean;
	onMove: (x: number, y: number) => void;
	/** The stage's editor, as far as this item goes (`editor/dom/pointer.ts`, `PageView`). */
	view: PageView;
	onOpen: () => void;
	/** How much room a card's content took, for `decks.canvas.fit`, with the revision it was measured at. */
	onExtent?: (extent: { rev: number; w: number; h: number; at?: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number }) => void;
	/** A link on a card to another board or card of the deck: `true` once the host has opened it. */
	onOpenPage?: (path: string, from: string) => boolean;
	/** Words selected in a card, to comment on: the stage gives this while you may. */
	onWords?: (words: { quote: string; component?: string; anchor: () => DOMRect | undefined }) => void;
	/** The stage's fingers: a finger on the bar or the edge carries the item, and a second makes it a pinch. */
	gestures: { claimTouch(id: number): void; pinching(): boolean; /** A finger the stage pans for, from a cover the browser cannot scroll. */ panTouch(id: number): void; /** The first finger caught a moving canvas: its lift is no tap. */ caught(): boolean };
	/**
	 * On a touch screen an item's page is covered until it is activated (`items-layer.tsx`): a tap on the
	 * cover selects, a drag anywhere on it moves the item, a pinch with a finger on it zooms the canvas,
	 * and a second tap on the selected item activates it, so its page takes the fingers until something
	 * else is selected. As an app's page is entered, for cards and documents too.
	 */
	active?: boolean;
	onActivate?: () => void;
}

/** What a host adds to the slot: where a card's file is, and whether its scripts may run here. */
export interface ItemSlotExtras {
	/** A card's address (its `index.html`), or anything for a document or an app item. */
	page?: string | undefined;
	/** Raised by the host when the card's file changed where it comes from: it loads again. */
	reload?: number | undefined;
	/** False when a card's scripts may not run here: a friend's card, on a canvas shared with the person. */
	cardScripts?: boolean | undefined;
	/** With its scripts off, a card the person may turn them on for (one pasted from a friend's canvas): a button on it does. */
	onScriptsOn?: (() => void) | undefined;
}
