import type { Setter } from "solid-js";
import { type Hsv, hexToHsv } from "./color-math.ts";
import type { ColorPickerProps } from "./color-picker-props.ts";

/** What `createColorDrag` reads of `ColorPicker` (`ColorPicker.tsx`). */
export interface ColorDragNeeds {
	readonly props: ColorPickerProps;
	readonly hex: () => string;
	readonly commit: (value?: string) => void;
	readonly setHsv: Setter<Hsv>;
}

/** A drag in the picker's square or strip, and a colour picked from the screen. */
export function createColorDrag(d: ColorDragNeeds) {
	/** A drag across an element, as fractions of it: drawn at every step, saved on release. */
	const dragOver = (event: PointerEvent, el: HTMLElement, move: (fx: number, fy: number) => void) => {
		event.preventDefault();
		el.setPointerCapture(event.pointerId);
		const at = (e: PointerEvent) => {
			const r = el.getBoundingClientRect();
			move(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
			d.props.onLive?.(d.hex());
		};
		at(event);
		const moved = (e: PointerEvent) => at(e);
		const up = () => {
			el.removeEventListener("pointermove", moved);
			el.removeEventListener("pointerup", up);
			el.removeEventListener("pointercancel", up);
			d.commit();
		};
		el.addEventListener("pointermove", moved);
		el.addEventListener("pointerup", up);
		el.addEventListener("pointercancel", up);
	};

	const dropper = typeof window !== "undefined" && "EyeDropper" in window;

	const pickFromScreen = async () => {
		try {
			const Dropper = (window as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
			const picked = await new Dropper().open();
			d.setHsv(hexToHsv(picked.sRGBHex));
			d.commit(picked.sRGBHex.toLowerCase());
		} catch {
			// Closed with Escape: nothing picked.
		}
	};

	return {
		dragOver,
		dropper,
		pickFromScreen,
	};
}
