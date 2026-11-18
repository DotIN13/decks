import { DEVICE } from "@decks/canvas";

/**
 * How much a device keeps alive in tabs behind the one in front.
 *
 * A tab put away starts again from nothing when it comes forward: its frame, its code, its line to
 * the harness, and for a canvas its drawing engine and every picture. So tabs are kept alive behind
 * the one in front, as a browser keeps its own, and coming back to one is showing it. How many is the
 * device's to bear: a few on a computer, fewer on an iPad or a phone, where the system gives one page
 * a hard ceiling of memory for everything it shows (`@decks/canvas`, `render/device.ts`). One past
 * its budget is put away, the one in front longest ago first, and loads again when it comes forward:
 * a card and a document from their files, an app with what it saved in its browser storage.
 */
export const APPS_BEHIND: number = { computer: 3, mobile: 0 }[DEVICE];
/**
 * Canvases kept alive behind the one on screen. Each is a whole canvas frame: a drawing engine, its
 * pictures on the GPU and the cards awake on it, so they are the dearest to keep, and a phone or an
 * iPad keeps none: there a move to another canvas moves the one frame in place, as it always has.
 */
export const CANVASES_BEHIND: number = { computer: 2, mobile: 0 }[DEVICE];
/** Cards and documents kept alive behind the tab in front, counted together: each is one frame with one item in it. */
export const ITEMS_BEHIND: number = { computer: 4, mobile: 2 }[DEVICE];
/** The kinds that share `ITEMS_BEHIND`. */
export const ITEM_KINDS: readonly string[] = ["card", "document"];

/**
 * Whether the top bar is a touch bar: a phone's, or a tablet's. A finger needs larger things than a
 * chip per tab leaves room for, so the bar shows what is in front by name, how many tabs are open,
 * and puts the rest behind a press (`TabStrip.tsx`, `app/top.tsx`).
 */
export const touchTop = (phone: boolean): boolean => phone || DEVICE === "mobile";
