import { m } from "@decks/i18n";
import { canvasBox, fitInto } from "@decks/canvas/camera";
import { itemLinkOf, linkOpenFor, withLinkOpen } from "@decks/pen";
import { moveCamera } from "../state/camera.ts";
import { act } from "../state/decks.ts";
import { notice } from "../state/notices.ts";
import { setSelected } from "../state/selection.ts";
import { canvasOfPath } from "./kinds/card.tsx";
import { kindOf } from "./kinds.ts";
import { tabAt, windowAddressOf } from "./remember.ts";
import { canvasOnScreen, onCanvas, openTab } from "./tabs.ts";

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
 * Follow a link to something in the deck, by its address in this window (`#canvas/…`, `#card/…`,
 * `#doc/…`, `#app/…`, `#item/<canvas>/<id>`; `remember.ts`), the way the link says it opens
 * (`@decks/pen`, `linkOpenFor`: its `?open=`, else a card or a drawn item on the canvas and the rest
 * in a tab). On the canvas, the view flies to it, on its own canvas when that is another; in a tab,
 * the tab it names opens in front, or comes forward. ⌘ or Ctrl (`browser`) always opens a new tab of
 * this window, whatever the link says: a drawn item's is its canvas, framed on it. An address that
 * names nothing, or something no longer in the deck, says so and opens nothing.
 */
export function openAt(link: { address: string; browser?: true }): void {
	const open = link.browser ? "tab" : linkOpenFor(link.address);
	const item = itemLinkOf(link.address);
	if (item) return void flyToItem(item.canvas, item.id, open === "tab");
	const tab = tabAt(withLinkOpen(link.address, undefined));
	if (!tab) return void notice("warn", m.tabs_link_nothing({ address: link.address }));
	if (kindOf(tab.kind)?.has?.(tab.target) === false) return void notice("warn", goneWords(tab.kind, tab.target));
	// A card on the canvas: the view flies to it there. A card on no canvas has nowhere to fly to, so it opens as its tab.
	const home = tab.kind === "card" ? canvasOfPath(tab.target) : undefined;
	if (open === "canvas" && home) return void flyToItem(home, tab.target, false);
	openTab(tab.kind, tab.target);
}

/** The closest a link's flight comes: life size. */
const FLY_ZOOM = 1;

/** How long a canvas brought in front takes to land on its own view, before a flight to an item on it. */
const ARRIVE_MS = 450;

/** Until `test` holds, or `ms` passes: a canvas tab takes a moment to come in front and draw. */
async function until(test: () => boolean, ms = 3000): Promise<boolean> {
	const end = Date.now() + ms;
	while (!test()) {
		if (Date.now() > end) return false;
		await new Promise((resolve) => setTimeout(resolve, 60));
	}
	return true;
}

/**
 * The view on one item of a canvas: that canvas in front (its tab, opened when it is not the one on
 * screen, or when `fresh` asks for it as a tab of its own), then the camera flown to hold the item,
 * and a card selected. The item's box is read from the server, which has every canvas.
 */
async function flyToItem(canvas: string, id: string, fresh: boolean): Promise<void> {
	const read = await act<{ items: Array<{ box?: { x1: number; y1: number; x2: number; y2: number }; card?: string }> }>("canvas.read", [{ canvas, of: id, depth: 0 }]);
	const found = read?.items?.[0];
	if (!found?.box) return void notice("warn", m.tabs_link_nothing({ address: `#item/${canvas}/${id}` }));
	const arriving = fresh || !onCanvas() || canvasOnScreen()?.name !== canvas;
	if (arriving) {
		openTab("canvas", canvas);
		await until(() => onCanvas() && canvasOnScreen()?.name === canvas);
	}
	const shown = await until(() => !!document.querySelector("iframe.canvas-frame, .canvas"));
	if (!shown) return;
	const { x1, y1, x2, y2 } = found.box;
	const fly = (animate: boolean) => {
		const frame = document.querySelector("iframe.canvas-frame, .canvas");
		if (!frame) return;
		const view = { width: frame.clientWidth, height: frame.clientHeight };
		// Held, not filled: a small item is seen at life size at most, with what is round it.
		const framed = fitInto([{ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }], view, canvasBox(view));
		moveCamera({ ...framed, zoom: Math.min(framed.zoom, FLY_ZOOM) }, { animate });
	};
	if (arriving) {
		// A canvas just brought in front lands on its own opening view a moment after (`app/landing.ts`): the flight goes after that, and once more in case it was late.
		await new Promise((resolve) => setTimeout(resolve, ARRIVE_MS));
		fly(false);
		await new Promise((resolve) => setTimeout(resolve, ARRIVE_MS));
	}
	fly(!arriving);
	if (found.card) setSelected(found.card);
}

/** A link whose target is gone, said by its kind. */
function goneWords(kind: string, target: string): string {
	if (kind === "canvas") return m.tabs_link_gone_canvas({ target });
	if (kind === "card") return m.tabs_link_gone_card({ target });
	if (kind === "document") return m.tabs_link_gone_document({ target });
	if (kind === "app") return m.tabs_link_gone_app({ target });
	return m.tabs_link_gone({ target });
}
