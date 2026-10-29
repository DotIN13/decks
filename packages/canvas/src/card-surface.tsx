import { createEffect, on, onCleanup, untrack } from "solid-js";
import { INTERACTIVE, mountCard, scrollsInside, type MountedCard } from "./card.ts";
import { scheme } from "./lib/theme.ts";

/**
 * A card's surface in a board's place (`plain-board.tsx`): a host element whose shadow root holds the
 * card (`card.ts`). Where a board's frame needs a bridge to hand the stage its gestures, a card's
 * events reach the stage as they are; this only decides which of them are the card's own.
 *
 * - **A mouse or pen press** inside the card is the card's: it never starts a marquee or a pan, and it
 *   selects the card. The card moves by its bar and its edge, as a live board does.
 * - **A finger** pans the canvas across a card, unless it lands on one of the card's controls.
 * - **A wheel** scrolls what inside the card can take it, and pans the canvas otherwise; a pinch always zooms.
 * - **Keys** typed into the card's own fields stay in it, so Delete in a text box deletes a letter, not the card.
 */
export function CardSurface(props: {
	page: string;
	path: string;
	trusted: boolean;
	rev: number;
	reload?: number | undefined;
	size: () => { w: number; h: number };
	selected: boolean;
	onSelect: () => void;
	onShown: () => void;
}) {
	let host!: HTMLDivElement;
	let mounted: MountedCard | undefined;
	let asked = 0;
	const load = async () => {
		const ask = ++asked;
		let html = "";
		try {
			const url = new URL(props.page, location.href);
			url.searchParams.set("raw", "1");
			const response = await fetch(url, { cache: "no-cache" });
			html = response.ok ? await response.text() : "";
		} catch {
			html = "";
		}
		if (ask !== asked || !host) return;
		mounted?.dispose();
		// A closed root is made once per element: a new file gets a new element.
		const fresh = document.createElement("div");
		fresh.className = "card-host";
		// Sized here, not by the card's sheet: a root contained in size with no size of its own is nothing tall.
		fresh.style.cssText = "width: 100%; height: 100%";
		host.replaceChildren(fresh);
		mounted = mountCard(fresh, {
			html,
			url: new URL(props.page, location.href).href.replace(/[?#].*$/, ""),
			path: props.path,
			trusted: props.trusted,
			theme: untrack(scheme),
			size: untrack(props.size),
		});
		props.onShown();
	};
	createEffect(on(() => [props.page.replace(/[?#].*$/, ""), props.rev, props.reload] as const, () => void load()));
	createEffect(() => mounted?.setTheme(scheme()));
	createEffect(() => mounted?.setSize(props.size()));
	onCleanup(() => {
		asked++;
		mounted?.dispose();
	});

	const own = (event: Event) => event.composedPath().some((target) => target instanceof Element && target.matches?.(INTERACTIVE));
	const editable = (event: Event) => {
		const target = event.composedPath()[0];
		return target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.localName));
	};
	return (
		<div
			class="card-surface"
			ref={(element) => {
				host = element;
				element.addEventListener("pointerdown", (event) => {
					if (event.pointerType === "touch") {
						if (own(event)) event.stopPropagation();
						return;
					}
					if (event.button !== 0 && event.button !== 2) return;
					if (!props.selected) props.onSelect();
					event.stopPropagation();
				});
				for (const type of ["pointerup", "click", "dblclick", "contextmenu"]) element.addEventListener(type, (event) => (event as PointerEvent).pointerType !== "touch" && event.stopPropagation());
				element.addEventListener(
					"wheel",
					(event) => {
						if (event.ctrlKey) return;
						if (scrollsInside(event.composedPath(), element, event.deltaX, event.deltaY)) event.stopPropagation();
					},
					{ passive: true },
				);
				for (const type of ["keydown", "keyup", "keypress"]) element.addEventListener(type, (event) => editable(event) && event.stopPropagation());
			}}
			style={{ width: "100%", height: "100%" }}
		/>
	);
}
