/**
 * A question about the screen, asked by the chrome: whether the pointer can hover at all.
 *
 * This was `lib/panels.ts`, named for the floating panels — which moved into `state/ui.ts`
 * with their signals and their persistence.
 */
import { RULES } from "@decks/canvas/device";

/** Whether this pointer can hover, asked once: a device does not change its mind. */
export function canHover(): boolean {
	// The rules table's: a desk hovers, a tablet and a phone do not (`hover.outline`).
	return RULES.hover;
}
