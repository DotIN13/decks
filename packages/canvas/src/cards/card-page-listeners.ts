import { onCleanup } from "solid-js";
import { createCardBar, SELECTION_PAUSE_MS } from "./card-bar.ts";

/** What `listenOnPage` reads of the editor (`CardEditor.tsx`). */
export interface ListenOnPageNeeds {
	readonly onPointerMove: (event: PointerEvent) => void;
	readonly endDrag: (cancel: boolean) => void;
	readonly cardBar: ReturnType<typeof createCardBar>;
	readonly showBar: () => void;
	readonly ed: HTMLDivElement;
	readonly bar: HTMLDivElement;
	readonly watch: MutationObserver;
	readonly cardHistory: { changed: () => void; travel: (back: boolean) => void; past: string[]; frame: number | undefined; };
}

/** What the editor hears from the whole page while it is open: the pointer for a drag and a selection, and the selection changing. */
export function listenOnPage(d: ListenOnPageNeeds) {
	const move = (event: PointerEvent) => d.onPointerMove(event);

	const up = () => {
		d.endDrag(false);
		if (d.cardBar.selecting) {
			d.cardBar.selecting = false;
			d.showBar();
		}
	};

	const cancel = () => {
		d.endDrag(true);
		d.cardBar.selecting = false;
	};

	// A press in the words starts a selection; the bar waits for the lift (`up`).
	const press = (event: PointerEvent) => {
		if (event.button !== 0 || !d.ed.contains(event.target as Node)) return;
		d.cardBar.selecting = true;
		clearTimeout(d.cardBar.settleBar);
		d.showBar();
	};

	const selection = () => {
		clearTimeout(d.cardBar.settleBar);
		if (d.cardBar.selecting) return;
		// Up already: it follows the selection. Not up yet: it waits until the selection rests.
		if (!d.bar.hasAttribute("data-off")) d.showBar();
		else d.cardBar.settleBar = setTimeout(d.showBar, SELECTION_PAUSE_MS);
	};

	document.addEventListener("pointerdown", press, true);

	document.addEventListener("pointermove", move);

	document.addEventListener("pointerup", up);

	document.addEventListener("pointercancel", cancel);

	document.addEventListener("selectionchange", selection);

	onCleanup(() => {
		d.watch.disconnect();
		clearTimeout(d.cardBar.settleBar);
		document.removeEventListener("pointerdown", press, true);
		document.removeEventListener("pointermove", move);
		document.removeEventListener("pointerup", up);
		document.removeEventListener("pointercancel", cancel);
		document.removeEventListener("selectionchange", selection);
		if (d.cardHistory.frame !== undefined) cancelAnimationFrame(d.cardHistory.frame);
	});

}
