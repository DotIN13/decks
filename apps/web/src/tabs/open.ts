import { notice } from "../state/notices.ts";
import { kindOf } from "./kinds.ts";
import { tabAt, windowAddressOf } from "./remember.ts";
import { openTab } from "./tabs.ts";

/**
 * Open a card, a document or an app whole, from its pill on a canvas (New tab): in a tab of this
 * window, by its kind (`kinds/`); with ⌘ or ⌃ held (`browser`), in the browser's own tab, at this
 * window's address with the tab's after `#` (`remember.ts`), which opens the same tab there.
 */
export function openItem(item: { kind: "canvas" | "card" | "document" | "app"; target: string; browser?: true }): void {
	if (item.browser) return void window.open(windowAddressOf(item), "_blank", "noopener");
	openTab(item.kind, item.target);
}

/**
 * Follow a link on a canvas to something in the deck, by its address in this window (`#canvas/…`,
 * `#card/…`, `#doc/…`, `#app/…`; `remember.ts`): the tab it names opens in this window, in front, or
 * comes forward when it is already open; with `browser`, in the browser's own tab. A canvas opens as
 * another tab, the one left staying in the row. An address that names nothing, or something that is
 * no longer in the deck, says so and opens nothing.
 */
export function openAt(link: { address: string; browser?: true }): void {
	const tab = tabAt(link.address);
	if (!tab) return void notice("warn", `This link opens nothing: ${link.address} is not an address of a canvas, a card, a document or an app.`);
	if (kindOf(tab.kind)?.has?.(tab.target) === false) return void notice("warn", `This link's ${tab.kind} is not in the deck any more: ${tab.target}.`);
	openItem({ kind: tab.kind as "canvas" | "card" | "document" | "app", target: tab.target, ...(link.browser ? { browser: true as const } : {}) });
}
