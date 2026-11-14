import { createSignal, onCleanup } from "solid-js";
import { canHover } from "../../lib/media.ts";

// The agent menu's behaviour: the hover card follows the row pointed at and
// lingers 80 ms after; the find field's words; a pick closes the menu first.

export type Anchor = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;

/** A row's anchor for the card: the row's height, the menu's width. */
export function anchorFor(row: HTMLElement): Anchor {
	const at = row.getBoundingClientRect();
	const card = row.closest(".popover")?.getBoundingClientRect();
	return { top: at.top, bottom: at.bottom, height: at.height, left: card?.left ?? at.left, right: card?.right ?? at.right, width: (card?.right ?? at.right) - (card?.left ?? at.left) };
}

export function createMenu() {
	const [over, setOver] = createSignal<{ id: string; at: Anchor } | undefined>();
	const [held, setHeld] = createSignal<{ id: string; at: Anchor } | undefined>();
	const [find, setFind] = createSignal("");
	const timers = { exit: undefined as ReturnType<typeof setTimeout> | undefined, dismiss: undefined as (() => void) | undefined };
	onCleanup(() => clearTimeout(timers.exit));
	const point = (id: string, at: Anchor) => {
		if (!canHover()) return;
		clearTimeout(timers.exit);
		setOver({ id, at });
		setHeld({ id, at });
	};
	const unpoint = (id: string) => {
		clearTimeout(timers.exit);
		timers.exit = setTimeout(() => setOver((was) => (was?.id === id ? undefined : was)), 80);
	};
	const pick = (run: () => void) => {
		timers.dismiss?.();
		run();
	};
	return { over, held, find, setFind, point, unpoint, pick, timers, pointed: () => (over() ?? held())?.id };
}
