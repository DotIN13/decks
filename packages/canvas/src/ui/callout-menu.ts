import { createEffect, createSignal, on, onCleanup } from "solid-js";
import type { PageCalloutProps } from "./callout-props.ts";

/** What `createCalloutMenu` reads of `PageCallout` (`Callout.tsx`). */
export interface CalloutMenuNeeds {
	readonly element: HTMLDivElement | undefined;
	readonly props: PageCalloutProps;
}

/** The pill's More menu: open or shut, where it opens, and shut again by a pick. */
export function createCalloutMenu(d: CalloutMenuNeeds) {
	/*
	 * A card's ⋯ menu: what is done less often, under the pill, gone at a press anywhere else, at Escape,
	 * or when the pill hides for a movement.
	 */
	const [more, setMore] = createSignal(false);

	let moreButton: HTMLButtonElement | undefined;

	/*
	 * Where the menu opens, measured once it is drawn: always down, under the pill, as the person asked;
	 * its left edge under the ⋯ button, as a menu bar's menu hangs from its title, kept on the canvas.
	 */
	const [menuAt, setMenuAt] = createSignal<{ left: number }>();

	const placeMenu = (menu: HTMLDivElement) => {
		const canvas = d.element?.parentElement?.getBoundingClientRect();
		if (!d.element || !moreButton || !canvas) return;
		const pill = d.element.getBoundingClientRect();
		const button = moreButton.getBoundingClientRect();
		const w = menu.offsetWidth;
		const left = Math.max(canvas.left + 8 - pill.left, Math.min(button.left - 4 - pill.left, canvas.right - 8 - w - pill.left));
		setMenuAt({ left });
	};

	createEffect(on(more, (open) => open || setMenuAt(undefined)));

	createEffect(on(() => d.props.hidden, (hidden) => hidden && setMore(false)));

	createEffect(() => {
		if (!more()) return;
		const away = (event: Event) => {
			if (d.element && event.target instanceof Node && d.element.contains(event.target)) return;
			setMore(false);
		};
		const key = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			setMore(false);
		};
		window.addEventListener("pointerdown", away, true);
		window.addEventListener("keydown", key, true);
		onCleanup(() => {
			window.removeEventListener("pointerdown", away, true);
			window.removeEventListener("keydown", key, true);
		});
	});

	const pick = (run?: () => void) => () => {
		setMore(false);
		run?.();
	};

	return {
		get moreButton() { return moreButton; },
		set moreButton(next) { moreButton = next; },
		more,
		setMore,
		placeMenu,
		menuAt,
		pick,
	};
}
