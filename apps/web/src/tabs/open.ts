import { m } from "@decks/i18n";
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
	if (!tab) return void notice("warn", m.tabs_link_nothing({ address: link.address }));
	if (kindOf(tab.kind)?.has?.(tab.target) === false) return void notice("warn", goneWords(tab.kind, tab.target));
	openItem({ kind: tab.kind as "canvas" | "card" | "document" | "app", target: tab.target, ...(link.browser ? { browser: true as const } : {}) });
}

/** A link whose target is gone, said by its kind. */
function goneWords(kind: string, target: string): string {
	if (kind === "canvas") return m.tabs_link_gone_canvas({ target });
	if (kind === "card") return m.tabs_link_gone_card({ target });
	if (kind === "document") return m.tabs_link_gone_document({ target });
	if (kind === "app") return m.tabs_link_gone_app({ target });
	return m.tabs_link_gone({ target });
}
