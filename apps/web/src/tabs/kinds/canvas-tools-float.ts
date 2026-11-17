import { insets, insetsMoving } from "@decks/canvas/camera";
import { setPenToolsAt } from "@decks/canvas/tools";
import { createEffect, onCleanup } from "solid-js";
import type { Floats } from "../../app/floats.ts";

/**
 * The canvas's tools as floats, beside the composer and the conversation (`floats.ts`): the tool
 * column, and the pen tray under its own key. Taken by the grip at its head, one goes anywhere in the
 * canvas's column, from the side panel's edge to the window's and down to its foot; dropped near an
 * edge it stands against it, dropped on the composer or the conversation it takes the nearest place
 * clear of them, as they do of it; and a hard throw at either edge tucks it behind that edge with its
 * tab showing. Not on a phone, where the column is a row at the foot and the tray a strip at the head.
 *
 * Home is the stylesheet's own place, so it is measured whenever the float is standing there rather
 * than worked out again here, with the column's middle only until it first has been.
 */
export function createToolsFloat({ workBox, mountFloat }: Floats, phone: () => boolean) {
	return (tools: HTMLElement, grip: HTMLElement, key = "pen-tools"): { unstow: () => void } => {
		let seen: { x: number; y: number } | undefined;
		const home = () => {
			const work = document.querySelector(".work")?.getBoundingClientRect();
			if (!tools.hasAttribute("data-floating") && !tools.hasAttribute("data-stowed")) {
				const r = tools.getBoundingClientRect();
				seen = { x: r.left - (work?.left ?? 0), y: r.top - (work?.top ?? 0) };
			}
			const box = workBox();
			return seen ?? { x: box.x + 12, y: box.y + box.h / 2 - tools.offsetHeight / 2 };
		};
		const cssPx = (name: string, fallback: number) => parseFloat(getComputedStyle(tools).getPropertyValue(name)) || fallback;
		/*
		 * Where the column stands, said to the canvas: a card's style bar keeps clear of it (`penToolsAt`).
		 * On the canvas's own screen, so less where the frame is; nothing while it is tucked away.
		 */
		let saying = 0;
		let again: ReturnType<typeof setTimeout> | undefined;
		const measure = () => {
			// The frame fills the canvas's layer, which is there before the frame is.
			const frame = (document.querySelector("iframe.canvas-frame") ?? document.querySelector(".surface-layer[data-layer='stage']"))?.getBoundingClientRect() ?? { left: 0, top: 0 };
			const at = tools.getBoundingClientRect();
			setPenToolsAt(!at.width || tools.hasAttribute("data-stowed") ? undefined : { left: at.left - frame.left, top: at.top - frame.top, right: at.right - frame.left, bottom: at.bottom - frame.top });
		};
		/* Now, and once more when things have come to rest: the side panel slides in and the column glides home, and a place measured mid-way is not where either ends up. */
		const sayWhere = () => {
			cancelAnimationFrame(saying);
			saying = requestAnimationFrame(measure);
			clearTimeout(again);
			again = setTimeout(measure, 600);
		};
		const float = mountFloat(tools, key, grip, "button, input, label", home, "top", { tab: () => cssPx("--stowtab-w", 20) }, phone);
		createEffect(() => {
			insets();
			phone();
			// While the side panel is dragged a float follows it step by step, cheaply; it is put back properly once the drag ends.
			if (insetsMoving()) return float.follow();
			float.restore();
		});
		// Only the column's place is said: the pen tray stands clear of where a card is typed into.
		if (key !== "pen-tools") {
			onCleanup(() => float.dispose());
			return { unstow: () => float.unstow() };
		}
		/* Wherever the float system puts it (a drop, a glide, a tuck, a side panel that moved it), it is measured again. */
		const placed = new MutationObserver(sayWhere);
		placed.observe(tools, { attributes: true, attributeFilter: ["style", "data-floating", "data-stowed"] });
		sayWhere();
		const sized = new ResizeObserver(sayWhere);
		sized.observe(tools);
		addEventListener("resize", sayWhere);
		addEventListener("transitionend", sayWhere, true);
		onCleanup(() => {
			cancelAnimationFrame(saying);
			clearTimeout(again);
			sized.disconnect();
			placed.disconnect();
			removeEventListener("resize", sayWhere);
			removeEventListener("transitionend", sayWhere, true);
			setPenToolsAt(undefined);
			float.dispose();
		});
		return { unstow: () => float.unstow() };
	};
}
