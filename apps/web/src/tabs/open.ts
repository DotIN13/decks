import { windowAddressOf } from "./remember.ts";
import { openTab } from "./tabs.ts";

/**
 * Open a card, a document or an app whole, from its pill on a canvas (New tab): in a tab of this
 * window, by its kind (`kinds/`); with ⌘ or ⌃ held (`browser`), in the browser's own tab, at this
 * window's address with the tab's after `#` (`remember.ts`), which opens the same tab there.
 */
export function openItem(item: { kind: "card" | "document" | "app"; target: string; browser?: true }): void {
	if (item.browser) return void window.open(windowAddressOf(item), "_blank", "noopener");
	openTab(item.kind, item.target);
}
