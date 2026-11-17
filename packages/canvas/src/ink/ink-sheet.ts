import { onCleanup, onMount } from "solid-js";
import { penSeen, setInkSelection } from "./ink.ts";
import type { LiveInk } from "../render/types.ts";
import { type CanvasInkProps } from "./CanvasInk.tsx";

/** What `mountInkSheet` reads of `CanvasInk` (`CanvasInk.tsx`), each read when it is used. */
export interface MountInkSheetNeeds {
	readonly palm: (_event: PointerEvent) => boolean;
	readonly palms: Set<number>;
	readonly fingerDown: (event: PointerEvent) => void;
	readonly onDown: (event: PointerEvent) => void;
	readonly onMove: (event: PointerEvent) => void;
	readonly onUp: (event: PointerEvent) => void;
	readonly cancel: () => void;
	readonly waiting: Map<string, { ink: LiveInk; timer: ReturnType<typeof setTimeout>; }>;
	readonly settle: (id: string) => void;
	readonly frame: number;
	readonly props: CanvasInkProps;
}

export function mountInkSheet(d: MountInkSheetNeeds) {
	/*
	 * The pencil's touches are this sheet's alone. Safari on an iPad keeps a pencil press that comes
	 * hard after a stroke for its own gestures (Scribble's handwriting, a double tap) and never hands
	 * the page its pointerdown: the next stroke did nothing. Cancelling the browser's default for the
	 * stylus's touch events, which pointer events cannot do, keeps every press a stroke. Fingers are
	 * left alone: they pan and pinch.
	 */
	let sheet: SVGSVGElement | undefined;

	onMount(() => {
		if (!sheet) return;
		const own = (event: TouchEvent) => {
			for (const touch of Array.from(event.changedTouches)) {
				if ((touch as Touch & { touchType?: string }).touchType === "stylus") {
					if (event.cancelable) event.preventDefault();
					return;
				}
			}
		};
		const options = { passive: false } as const;
		/*
		 * Once a pencil has been used the glass lets fingers through (`data-pencil`, ink.css), so a finger
		 * pans by the stage's own scrolling and presses a card as it would without the draw tool: the
		 * glass's `touch-action: none` had stopped every finger pan, and it lay over every card. The
		 * pencil (and a mouse) is caught on its way down instead, on the stage it now lands on, and
		 * the stylus's touches are still kept from scrolling it there.
		 */
		const stage = (sheet.closest(".stage") ?? sheet.parentElement ?? sheet) as HTMLElement;
		const onGlass = (event: Event) => event.target instanceof Node && !!sheet?.contains(event.target);
		const caught = (event: PointerEvent) => {
			if (!penSeen() || onGlass(event)) return;
			if (event.pointerType === "touch") {
				if (d.palm(event)) {
					d.palms.add(event.pointerId);
					event.preventDefault();
					event.stopPropagation();
				} else d.fingerDown(event);
				return;
			}
			d.onDown(event);
		};
		const followed = (event: PointerEvent) => {
			if (!penSeen() || onGlass(event)) return;
			if (event.type === "pointermove") d.onMove(event);
			else d.onUp(event);
		};
		// A palm while the pencil is on the glass, or a moment after, does not scroll the stage either.
		const palmScroll = (event: TouchEvent) => {
			if (penSeen() && d.palm(event as unknown as PointerEvent) && event.cancelable) event.preventDefault();
		};
		for (const type of ["touchstart", "touchmove", "touchend"] as const) {
			sheet.addEventListener(type, own, options);
			stage.addEventListener(type, own, options);
		}
		stage.addEventListener("touchmove", palmScroll, options);
		stage.addEventListener("pointerdown", caught, true);
		for (const type of ["pointermove", "pointerup", "pointercancel", "lostpointercapture"] as const) stage.addEventListener(type, followed, true);
		onCleanup(() => {
			for (const type of ["touchstart", "touchmove", "touchend"] as const) {
				sheet?.removeEventListener(type, own);
				stage.removeEventListener(type, own);
			}
			stage.removeEventListener("touchmove", palmScroll);
			stage.removeEventListener("pointerdown", caught, true);
			for (const type of ["pointermove", "pointerup", "pointercancel", "lostpointercapture"] as const) stage.removeEventListener(type, followed, true);
		});
	});

	onCleanup(() => {
		d.cancel();
		setInkSelection(undefined);
		for (const id of [...d.waiting.keys()]) d.settle(id);
		cancelAnimationFrame(d.frame);
		// The engine's copies go with the sheet.
		d.props.layer.previews.ink([]);
	});

	return {
		get sheet() {
			return sheet;
		},
		set sheet(next) {
			sheet = next;
		},
	};
}
