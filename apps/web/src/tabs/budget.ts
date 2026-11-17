import { DEVICE } from "@decks/canvas";

/**
 * How much a device keeps alive in tabs behind the one in front.
 *
 * A canvas keeps its one frame whatever is in front, a card and a document are put away when they are
 * not (they come back as they were: what they hold is in their files). An app is a program, and one
 * put away starts again from nothing, so its tab is kept running behind the front one, up to this
 * many of them: a few on a computer, none on an iPad or a phone, where the system gives one page a
 * hard ceiling of memory for everything it shows (`@decks/canvas`, `render/device.ts`). One past the
 * budget is put away, the one in front longest ago first, and loads again when it comes forward,
 * with what it saved in its browser storage.
 */
export const APPS_BEHIND: number = { computer: 3, mobile: 0 }[DEVICE];
