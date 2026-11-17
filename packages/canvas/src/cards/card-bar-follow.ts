import { onCleanup } from "solid-js";

/** What `followCard` reads of the editor (`CardEditor.tsx`). */
export interface FollowCardNeeds {
	readonly bar: HTMLDivElement;
	readonly wrap: HTMLDivElement;
	readonly closeMenus: () => void;
	readonly placeBar: () => void;
}

/** The bar while the card moves on screen: gone during a pan or a zoom, back over the words once it rests. */
export function followCard(d: FollowCardNeeds) {
	// A wheel over the toolbar or its menus scrolls them; the canvas, which takes every other wheel
	// for its camera, never hears of it.
	const ownWheel = (event: WheelEvent) => {
		if ((event.target as Element).closest(".pce-menu, .pce-tools")) event.stopPropagation();
	};

	d.bar.addEventListener("wheel", ownWheel, { passive: true });

	onCleanup(() => d.bar.removeEventListener("wheel", ownWheel));

	// Watched once a frame: while the card moves on screen, a pan or a zoom, the bar is gone; once it
	// has rested a moment the bar is put back over the words and fades in.
	let placing = 0;

	let seen = "";

	let movedAt = 0;

	const keep = () => {
		const w = d.wrap.getBoundingClientRect();
		const now = `${Math.round(w.left)},${Math.round(w.top)},${Math.round(w.width)}`;
		if (now !== seen) {
			const first = !seen;
			seen = now;
			if (!first) {
				movedAt = performance.now();
				if (!d.bar.hasAttribute("data-hidden")) {
					d.bar.setAttribute("data-hidden", "");
					d.closeMenus();
				}
			}
		} else if (d.bar.hasAttribute("data-hidden") && performance.now() - movedAt > 140) {
			d.placeBar();
			d.bar.removeAttribute("data-hidden");
		}
		placing = requestAnimationFrame(keep);
	};

	placing = requestAnimationFrame(keep);

	onCleanup(() => cancelAnimationFrame(placing));

}
