/**
 * A question about the screen, asked by the chrome: whether the pointer can hover at all.
 *
 * This was `lib/panels.ts`, named for the floating panels — which moved into `state/ui.ts`
 * with their signals and their persistence.
 */

/** Whether this pointer can hover, asked once: a device does not change its mind. */
export function canHover(): boolean {
	try {
		return !window.matchMedia("(hover: none)").matches;
	} catch {
		// No matchMedia at all is old enough to be a desktop browser.
		return true;
	}
}
