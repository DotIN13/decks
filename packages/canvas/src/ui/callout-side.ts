import type { Accessor } from "solid-js";
import { createEffect, createSignal, on, onCleanup, untrack } from "solid-js";
import { toScreen } from "../camera/camera.ts";
import { canvasBox } from "../camera/insets.ts";
import { COARSE } from "../edit/core/touch-rules.ts";
import type { PageCalloutProps } from "./callout-props.ts";

/** The gap between the pill and the card's edge, in screen pixels. */
const GAP = 10;

/** What `createCalloutSide` reads of `PageCallout` (`Callout.tsx`). */
export interface CalloutSideNeeds {
	readonly props: PageCalloutProps;
	readonly width: Accessor<number>;
	readonly element: HTMLDivElement | undefined;
}

/** Which side of what is picked the pill sits on, above or below, chosen once things rest so it does not jump while they move. */
export function createCalloutSide(d: CalloutSideNeeds) {
	/* The pill's own height, measured: it goes above the card only if it fits there whole. */
	const [tall, setTall] = createSignal(40);

	/** Where the selection's top and bottom middles are on screen, with the camera as it is now. */
	const edges = () => {
		const { box, camera, view } = d.props;
		return {
			top: toScreen(camera, view, { x: box.x + box.w / 2, y: box.y }),
			bottom: toScreen(camera, view, { x: box.x + box.w / 2, y: box.y + box.h }),
		};
	};

	/*
	 * Which edge the pill is on, chosen when the selection appears and again only when what it is on
	 * moves or changes size: never as the camera moves, so a pan carries the pill with its edge, off
	 * the screen with it, rather than sending it looking for room. Of the two edges, the one whose
	 * slot is on screen, clear of floating chrome and covering no other card or item; else the one
	 * covering less of them. With neither on screen when it was chosen (the camera on its way to the
	 * selection), it is chosen again once the camera has stopped.
	 */
	const choose = (): { below: boolean; sure: boolean } => {
		const { camera, view } = d.props;
		const room = canvasBox(view);
		const { top, bottom } = edges();
		const x = top.x;
		const half = d.width() / 2;
		const gap = d.props.gap ?? GAP;
		const canvas = d.element?.parentElement?.getBoundingClientRect();
		// Chrome floating over the canvas (the composer, a toolbar, a float): the room leaves out only what is docked.
		const underChrome = (slot: { from: number; to: number }) => {
			if (!canvas || typeof document === "undefined") return false;
			const y = canvas.top + (slot.from + slot.to) / 2;
			return [x - half + 8, x, x + half - 8].some((at) => {
				const hit = document.elementFromPoint(canvas.left + at, y);
				return !!hit && !hit.closest(".stage");
			});
		};
		const slots = [
			{ from: top.y - gap - tall(), to: top.y - gap, below: false },
			{ from: bottom.y + gap, to: bottom.y + gap + tall(), below: true },
		].filter((slot) => slot.from >= room.y + 4 && slot.to <= room.y + room.height - 4 && !underChrome(slot));
		if (!slots.length) return { below: false, sure: false };
		// Under a finger the pill goes below whenever below is on screen: never over what the hand holds, and the same place every time.
		if (COARSE) return { below: slots.some((slot) => slot.below), sure: true };
		const others = d.props.obstacles?.() ?? [];
		const covered = (slot: { from: number; to: number }) => {
			let area = 0;
			for (const other of others) {
				const a = toScreen(camera, view, { x: other.x, y: other.y });
				const b = toScreen(camera, view, { x: other.x + other.w, y: other.y + other.h });
				const w = Math.min(x + half, b.x) - Math.max(x - half, a.x);
				const h = Math.min(slot.to, b.y) - Math.max(slot.from, a.y);
				if (w > 0 && h > 0) area += w * h;
			}
			return area;
		};
		const best = slots.map((slot) => ({ slot, area: covered(slot) })).reduce((p, q) => (q.area < p.area ? q : p));
		return { below: best.slot.below, sure: true };
	};

	const [side, setSide] = createSignal<{ below: boolean; sure: boolean }>({ below: false, sure: false });

	/*
	 * Chosen once the box has stopped changing, not at every step it moves: choosing reads the page's
	 * layout (the canvas's rect, elementFromPoint for each slot), which at every step of a drag or a
	 * glide cost more than the drawing did. The edge it had rides with the box meanwhile; out of
	 * sight (hidden while something moves) it is chosen when it shows again.
	 */
	let chooseSoon: ReturnType<typeof setTimeout> | undefined;

	onCleanup(() => clearTimeout(chooseSoon));

	createEffect(
		on([() => d.props.box.x, () => d.props.box.y, () => d.props.box.w, () => d.props.box.h, d.width, tall], (_now, was) => {
			clearTimeout(chooseSoon);
			if (untrack(() => d.props.hidden)) return setSide((one) => ({ ...one, sure: false }));
			// The first time, at once: the pill has nowhere to be yet.
			if (was === undefined || !untrack(side).sure) return setSide(untrack(choose));
			// Placed once on touch: a change of the item's size does not send it to the other edge, so it never hops.
			if (COARSE) return;
			chooseSoon = setTimeout(() => setSide(untrack(choose)), 80);
		}),
	);

	createEffect(
		on(
			() => d.props.hidden,
			(hidden) => {
				if (!hidden && !untrack(side).sure) setSide(untrack(choose));
			},
		),
	);

	const place = () => {
		const { top, bottom } = edges();
		const gap = d.props.gap ?? GAP;
		const below = side().below;
		// Centred on what it is for, and slid inside the screen when that middle is on it but the pill
		// would hang off an edge (a note at a phone's edge): its arrow still points at the middle.
		const half = d.width() / 2;
		const room = canvasBox(d.props.view);
		let x = top.x;
		if (half > 0 && top.x >= room.x && top.x <= room.x + room.width) x = Math.max(room.x + half + 8, Math.min(room.x + room.width - half - 8, top.x));
		return { x, y: below ? bottom.y + gap : top.y - gap, below, arrow: half > 0 ? half + top.x - x : undefined };
	};

	return {
		setTall,
		place,
	};
}
