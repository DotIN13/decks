import { tabTitle } from "./alerts.ts";

/**
 * The tab itself as a notification surface.
 *
 * The quietest of the three, and the only one that works everywhere. A sound needs speakers
 * that are on; a banner needs a secure context and a permission (`notify.ts`); a dot on the
 * favicon needs nothing at all, survives being ignored for an hour, and is the thing you see
 * when you come back to a window of twelve tabs rather than the thing that interrupts you.
 *
 * Two changes, together, because either alone is easy to miss: the mark grows a dot, and the
 * title grows a count. `public/favicon-badge.svg` is the same drawing with a hole punched in
 * it for the dot — a mask rather than a ring of background colour, since the favicon has no
 * background and "background colour" would mean whatever the browser's tab strip is.
 *
 * ### The one browser this does not reach
 *
 * The swap is done on the SVG icon only. A browser old enough to be using `favicon-32.png`
 * is a browser that also ignores `type="image/svg+xml"`, and keeping a second badged PNG in
 * step for it would be two more files to regenerate every time the mark changes. It still
 * gets the count in the title, which is the half that is actually legible at tab size.
 */

const PLAIN = "/favicon.svg";
const BADGED = "/favicon-badge.svg";

let current = PLAIN;

/**
 * Swap the icon by *replacing the element*, not by assigning to `href`.
 *
 * Chrome and Safari both treat the link as already-resolved and will happily keep painting
 * the old bitmap after an href assignment; removing the node and appending a fresh one is
 * the only form of this that reliably repaints in all three engines. Cheap enough — it
 * happens when an alert arrives and when you come back to the tab, not per frame.
 */
function paint(href: string): void {
	if (href === current) return;
	current = href;
	const existing = document.head.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
	const link = document.createElement("link");
	link.rel = "icon";
	link.type = "image/svg+xml";
	link.href = href;
	existing?.remove();
	document.head.append(link);
}

/**
 * How many things are waiting for you that you have not looked at.
 *
 * Zero puts everything back. The caller owns the counting — `App.tsx` clears it on focus,
 * because coming back to the window *is* looking.
 */
export function setUnattended(count: number): void {
	paint(count > 0 ? BADGED : PLAIN);
	const next = tabTitle(count);
	// Guarded: assigning the same string still fires a `titlechange` in some extensions, and
	// this runs on every state message an agent sends.
	if (document.title !== next) document.title = next;
}
