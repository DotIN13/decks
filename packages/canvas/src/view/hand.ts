import type { Accessor } from "solid-js";
import { createSignal, onCleanup, onMount } from "solid-js";
import { handTool } from "../edit/pen-tools.ts";
import { handPans } from "../edit/core/dispatch.ts";

/** What `createHand` reads of `createViewInput` (`input.ts`), each read when it is used. */
export interface HandNeeds {
	readonly spaceHeld: Accessor<boolean>;
	readonly el: () => HTMLDivElement;
	readonly panFrom: (event: PointerEvent, how: { deselect: boolean; middle: boolean; }) => void;
}

export function createHand(d: HandNeeds) {
	/** A press pans: Space is held, or the host's hand tool is on (`state/pen-tools.ts`). */
	const grabbing = () => d.spaceHeld() || handTool();

	/** A press is held on the canvas (not on a pill): the drawn items' pill steps aside until it lets go. */
	const [pressHeld, setPressHeld] = createSignal(false);

	/** When the canvas last scrolled: within `COAST_MS` of it, with no finger down, the browser is still coasting after a flick. */
	let lastScroll = 0;

	const COAST_MS = 100;

	onMount(() => {
		const element = d.el();
		const press = (event: PointerEvent) => {
			if (!(event.target as Element | null)?.closest?.(".card-callout")) setPressHeld(true);
		};
		const release = () => setPressHeld(false);
		element.addEventListener("pointerdown", press, { capture: true, passive: true });
		/*
		 * The hand (or Space held) pans from a press anywhere on the canvas, whatever is selected: on an
		 * item's bar or edge, a handle, a grip or an anchor too, which otherwise would carry, size or join
		 * it (`core/dispatch.ts`, `handPans`). Taken here, before any of them hears the press. A press on
		 * bare canvas goes on to the editor, which pans it already. A card's page is a frame of its own and
		 * never sends its presses here, so words in it still select.
		 */
		const hand = (event: PointerEvent) => {
			const target = event.target as Element | null;
			if (target === element) return;
			const control = !!target?.closest?.("button, input, textarea, select, a[href], [contenteditable]:not([contenteditable='false']), [role=button], [role=menu], .pen-text");
			if (!handPans({ hand: grabbing(), pointer: event.pointerType === "touch" ? "touch" : event.pointerType === "pen" ? "pen" : "mouse", button: event.button, control })) return;
			event.stopPropagation();
			d.panFrom(event, { deselect: false, middle: false });
		};
		element.addEventListener("pointerdown", hand, { capture: true });
		window.addEventListener("pointerup", release, true);
		window.addEventListener("pointercancel", release, true);
		onCleanup(() => {
			element.removeEventListener("pointerdown", press, { capture: true });
			element.removeEventListener("pointerdown", hand, { capture: true });
			window.removeEventListener("pointerup", release, true);
			window.removeEventListener("pointercancel", release, true);
		});
	});

	return {
		get lastScroll() {
			return lastScroll;
		},
		set lastScroll(next) {
			lastScroll = next;
		},
		COAST_MS,
		grabbing,
		pressHeld,
	};
}
