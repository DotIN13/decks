import { createEffect, createMemo, createSignal, on, onCleanup, untrack, type Accessor } from "solid-js";
import { ENGINE, MOVING } from "../render/device.ts";

/** What `createPinchPictures` reads of `createItemsLayer` (`items-layer.tsx`). */
export interface PinchPicturesNeeds {
	readonly scaling: Accessor<boolean>;
}

/** A pinch on pictures: whether the awake cards are hidden while the scale moves, and drawn as their pictures by the sheet. */
export function createPinchPictures(d: PinchPicturesNeeds) {
	/**
	 * A pinch on pictures: while the scale moves, the awake cards are hidden and the sheet draws each as
	 * its picture, so the page stretches one sheet and lays out, paints and layers no card.
	 *
	 * By the engine's table (`render/device.ts`, `MOVING`): off everywhere today. Measured in a simulated
	 * iPad (`scripts/card-zoom.mjs`, Playwright's iPad Pro 11, CPU 4×, 3 cards awake): it changed nothing
	 * a pinch costs. Late frames in WebKit 2.0 and 2.0 per pinch off against 2.0 and 0.2 on, noise
	 * either way; Chromium's paint, raster and layer work 4, 15 and 7 ms per pinch off, 5, 14 and 7 on;
	 * the main thread's 71–98 ms off, 84–117 on, since each pinch tells the engine twice that its cards
	 * changed. `?card-pictures=1` or `=0` in the page's address tries the other way, for a measure on a real device.
	 */
	const PINCH_ON_PICTURES = (() => {
		const asked = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("card-pictures");
		return asked === "1" ? true : asked === "0" ? false : MOVING[ENGINE].card === "cover";
	})();

	/** The awake cards are hidden: from the first step of a scale until it rests (`canvas.css`, `data-card-pictures`). */
	const cardsHidden = createMemo(() => PINCH_ON_PICTURES && d.scaling());

	/**
	 * The sheet draws the awake cards as pictures rather than holes: from the first step of a scale, and
	 * two frames past its rest, so a card shown again has painted under its picture before the hole
	 * opens over it, and no frame shows it blank.
	 */
	const [cardPictures, setCardPictures] = createSignal(false);

	{
		let raf: number | undefined;
		createEffect(
			on(cardsHidden, (hidden) => {
				if (raf !== undefined) cancelAnimationFrame(raf);
				raf = undefined;
				if (hidden) return setCardPictures(true);
				if (!untrack(cardPictures)) return;
				raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => ((raf = undefined), setCardPictures(false)))));
			}),
		);
		onCleanup(() => raf !== undefined && cancelAnimationFrame(raf));
	}

	return {
		cardPictures,
		cardsHidden,
	};
}
