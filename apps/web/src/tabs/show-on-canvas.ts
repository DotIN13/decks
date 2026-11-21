import type { Page } from "@decks/protocol";
import { flyToPages } from "../app/links.ts";
import { stages } from "../state/canvases.ts";
import { act } from "../state/decks.ts";
import { m } from "@decks/i18n";
import { notice } from "../state/notices.ts";
import { setSelected } from "../state/selection.ts";
import type { Tab } from "./kind.ts";
import { canvasOfPath } from "./kinds/card.tsx";
import { canvasOnScreen, onCanvas, openTab, showCanvas } from "./tabs.ts";

/**
 * From a tab back to the canvas: what the tab holds, found where it sits on a canvas, with that canvas
 * brought forward, the item selected and the camera flown to it (the header's On canvas).
 *
 * A card is on the canvas its folder is in, and so is a document kept in a canvas's files. An app is
 * no canvas's: it is looked for on the canvas the chat's camera is on, and a window is put there when
 * it has none, as the Apps tab's Show on canvas does. A card is flown to once that canvas's cards are
 * here (`frameWhenPlaced`); an app's window and a document have no page in the deck's list, so they are
 * asked for in the canvas's drawing.
 */
export async function showOnCanvas(tab: Tab, d: { frameWhenPlaced: (path: string) => void }): Promise<void> {
	const target = tab.target ?? "";
	const canvas = tab.kind === "app" ? canvasOnScreen()?.name : canvasOfPath(target);
	if (!canvas) return void notice("info", tab.kind === "document" ? m.tabs_document_no_canvas() : m.tabs_on_no_canvas());
	const forward = () => (canvas === canvasOnScreen()?.name ? showCanvas() : openTab("canvas", canvas));
	if (tab.kind === "card") {
		forward();
		return d.frameWhenPlaced(target);
	}
	type Placed = { id?: string; metadata?: { type?: string; name?: string; path?: string }; box?: { x1: number; y1: number; x2: number; y2: number } };
	const read = await act<{ items: Placed[] }>("canvas.read", [{ canvas, depth: 0 }]);
	const mine = (one: Placed) =>
		tab.kind === "app" ? one.metadata?.type === "decks.app" && one.metadata.name === target : one.metadata?.type === "decks.document" && !!one.metadata.path && (one.metadata.path === target || target.endsWith(`/${one.metadata.path}`));
	let item = read?.items.find(mine);
	if (!item && tab.kind === "app") {
		const at = await act<{ x1: number; y1: number }>("canvas.space", [{ w: 1100, h: 760 }, { canvas }]);
		item = await act<Placed>("canvas.insert", [{ type: "app", app: target }, { canvas, ...(at ? { at } : {}) }]);
	}
	if (!item?.id || !item.box) return void notice("info", m.tabs_not_on_canvas({ canvas: stages().find((one) => one.name === canvas)?.title ?? canvas }));
	forward();
	if (!(await inFront(canvas))) return;
	const { x1, y1, x2, y2 } = item.box;
	const path = `item:${item.id}`;
	setSelected(path);
	flyToPages([{ path, x: x1, y: y1, w: x2 - x1, h: y2 - y1 } as Page], { animate: true });
}

/** Whether a canvas has come in front, waited for a few seconds at most: a canvas not open yet takes a moment to start. */
function inFront(canvas: string): Promise<boolean> {
	const until = Date.now() + 4000;
	return new Promise((resolve) => {
		const look = () => {
			if (onCanvas() && canvasOnScreen()?.name === canvas) return void setTimeout(() => resolve(true), 120);
			if (Date.now() > until) return resolve(false);
			setTimeout(look, 50);
		};
		look();
	});
}
