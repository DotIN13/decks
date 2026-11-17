import type { Setter } from "solid-js";
import { onCleanup, onMount } from "solid-js";
import { onDismiss } from "@decks/ui";
import { holdEscape } from "../edit/pen-tools.ts";
import type { ColorPickerProps } from "./color-picker-props.ts";

/** What `createColorPlace` reads of `ColorPicker` (`ColorPicker.tsx`). */
export interface ColorPlaceNeeds {
	readonly props: ColorPickerProps;
	readonly card: HTMLDivElement | undefined;
	readonly setPlace: Setter<{ left: number; top: number; }>;
}

/** Where the picker opens: under the swatch that asked for it, kept on the screen, and closed by a press elsewhere. */
export function createColorPlace(d: ColorPlaceNeeds) {
	const position = () => {
		const at = d.props.anchor.getBoundingClientRect();
		const width = 232;
		const height = d.card?.offsetHeight ?? 300;
		const left = Math.max(8, Math.min(at.left, window.innerWidth - width - 8));
		const below = at.bottom + 6;
		const top = below + height > window.innerHeight - 8 ? Math.max(8, at.top - height - 6) : below;
		d.setPlace({ left, top });
	};

	onMount(() => {
		position();
		requestAnimationFrame(position);
		const away = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (d.card?.contains(target) || d.props.anchor.contains(target)) return;
			d.props.onClose();
		};
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				d.props.onClose();
			}
		};
		window.addEventListener("pointerdown", away, true);
		window.addEventListener("keydown", key, true);
		window.addEventListener("resize", position);
		const stopDismiss = onDismiss(() => d.props.onClose());
		// Escape shuts the picker and nothing else, wherever the keyboard is (`holdEscape`).
		const letGo = holdEscape();
		onCleanup(() => {
			letGo();
			stopDismiss();
			window.removeEventListener("pointerdown", away, true);
			window.removeEventListener("keydown", key, true);
			window.removeEventListener("resize", position);
		});
	});

}
