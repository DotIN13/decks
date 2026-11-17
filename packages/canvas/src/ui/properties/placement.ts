import { createEffect, createSignal, onCleanup, onMount, on, untrack } from "solid-js";
import { penBoxes, penSelection, penTyping, propsOpen, setPropsOpen } from "../../edit/pen-tools.ts";
import { COARSE } from "../../edit/core/touch-rules.ts";

/** Where the properties panel sits on a touch screen, and what it tells the page of it. */
export function createPlacement() {
	/*
	 * On a touch screen the panel is not a column at the right. On a phone (under 600 px) it is a sheet
	 * at the bottom, under the thumb; on a tablet a popover beside the selection, placed from the
	 * selection's outline on screen when the selection changes, when the drawing changes under it, and
	 * when a pan or a pinch ends: to its right when there is room, else its left, else under it.
	 */
	const [narrow, setNarrow] = createSignal(typeof innerWidth === "number" && innerWidth < 600);

	const [anchor, setAnchor] = createSignal<{ left: number; top: number } | null>(null);

	const PANEL_W = 276;

	const place = () => {
		if (!COARSE || untrack(narrow) || typeof document === "undefined") return setAnchor(null);
		const outline = document.querySelector(".world > .pen-selection, .world > .pen-selection-box");
		const r = outline?.getBoundingClientRect();
		if (!r || r.width === 0) return setAnchor(null);
		const top = Math.max(60, Math.min(r.top, innerHeight - 420));
		// Clear of the pill too, which is centred under the selection and about 220 px wide (`Callout.tsx`): a narrow item's pill reaches past its sides.
		const PILL_HALF = 112;
		const right = Math.max(r.right, (r.left + r.right) / 2 + PILL_HALF);
		const left = Math.min(r.left, (r.left + r.right) / 2 - PILL_HALF);
		if (right + 12 + PANEL_W <= innerWidth - 12) return setAnchor({ left: right + 12, top });
		if (left - 12 - PANEL_W >= 12) return setAnchor({ left: left - 12 - PANEL_W, top });
		return setAnchor({ left: Math.max(12, Math.min(r.left, innerWidth - PANEL_W - 12)), top: Math.min(r.bottom + 12, innerHeight - 420) });
	};

	onMount(() => {
		if (!COARSE) return;
		const onResize = () => { setNarrow(innerWidth < 600); place(); };
		const settle = () => setTimeout(place, 0);
		addEventListener("resize", onResize);
		addEventListener("pointerup", settle, true);
		addEventListener("touchend", settle, true);
		onCleanup(() => { removeEventListener("resize", onResize); removeEventListener("pointerup", settle, true); removeEventListener("touchend", settle, true); });
	});

	createEffect(on([penSelection, penBoxes], () => { if (COARSE) queueMicrotask(place); }));

	// Nothing selected: the drawer is shut, so the next selection does not open it unasked.
	createEffect(on(penSelection, (ids) => { if (!ids.length) setPropsOpen(false); }));

	// The sheet open or shut, said to the page (`events.ts`, `decks-sheet`): its composer makes way, as under an iOS sheet.
	createEffect(on(() => COARSE && narrow() && propsOpen() && penSelection().length > 0 && !penTyping(), (open, was) => {
		if (open === was || typeof document === "undefined") return;
		document.dispatchEvent(new CustomEvent("decks-sheet", { detail: { open } }));
	}));

	return {
		narrow,
		anchor,
	};
}
