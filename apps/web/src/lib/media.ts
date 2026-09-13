/**
 * Two questions about the screen, asked by the chrome.
 *
 * This was `lib/panels.ts`, named for the floating panels — which moved into `state/ui.ts`
 * with their signals and their persistence. What was left was a breakpoint, a hover test,
 * and fifty lines of panel code that nothing called any more.
 *
 * Different questions, and neither is about the panels: one is how many pixels there are,
 * the other is whether the pointer can hover at all.
 */

/**
 * Below this the panels and the conversation cannot share the screen with the canvas, so
 * they take turns.
 *
 * A width, unusually — most of the decisions about chrome here ask `(hover: none)` instead —
 * because this one really is about how many pixels there are.
 */
export const NARROW = 760;

/** Whether this pointer can hover, asked once: a device does not change its mind. */
export function canHover(): boolean {
	try {
		return !window.matchMedia("(hover: none)").matches;
	} catch {
		// No matchMedia at all is old enough to be a desktop browser.
		return true;
	}
}
