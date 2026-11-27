import { batch } from "solid-js";
import { isBareSecondTap, TAP_MS, TAP_SLOP_PX, type BareTap } from "../core/dispatch.ts";
import { HOLD_MS, slopFor } from "../core/touch-rules.ts";
import type { Pt } from "../core/model.ts";
import { pointerInput, type Editor } from "./controller.ts";
import { type Client, type PointerHost } from "./pointer.ts";

/** What `createTapToDeselect` reads of `createPointer` (`pointer.ts`), each read when it is used. */
export interface TapToDeselectNeeds {
	readonly host: PointerHost;
	readonly worldAt: (event: Client) => Pt;
	readonly editor: Editor;
	lastBareTap: BareTap | undefined;
}

export function createTapToDeselect(d: TapToDeselectNeeds) {
	/**
	 * A tap on bare canvas lets go of the drawn items and boards selected, as a click there does
	 * (`penPress`, the marquee). On the lift, not the landing: a finger that pans or becomes a pinch
	 * keeps the selection, so you can look around something you have picked.
	 */
	const tapToDeselect = (event: PointerEvent) => {
		const pointer = event.pointerId;
		const from = { x: event.clientX, y: event.clientY };
		const since = performance.now();
		let pinched = false;
		let travelled = false;
		let held = false;
		/** Held, then moved: the finger draws a marquee from where it was held (`editor/core/gesture.ts`). */
		let boxing = false;
		const stopping = d.host.caught?.() ?? false;
		const second = (e: PointerEvent) => {
			if (e.pointerType === "touch" && e.pointerId !== pointer) pinched = true;
		};
		window.addEventListener("pointerdown", second, true);
		/*
		 * A finger held still on bare canvas: the canvas's menu at the finger (`holdMenu`), and the finger is
		 * the editor's from here, kept from scrolling the canvas. Lifted, nothing more happens; moved, the menu
		 * goes and the finger selects, drawing a marquee from where it was held. One finger alone pans.
		 */
		const hold = setTimeout(() => {
			if (pinched || travelled || !d.host.editable() || d.host.drawing()) return;
			held = true;
			d.host.claim(pointer);
			d.host.keepTouch?.(event);
			d.host.holdMenu?.({ ids: [], at: from, canvas: d.worldAt(event) });
		}, HOLD_MS);
		const done = () => {
			clearTimeout(hold);
			window.removeEventListener("pointerdown", second, true);
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", cancel);
		};
		const cancel = (e: PointerEvent) => {
			if (e.pointerId !== pointer) return;
			done();
			if (boxing) d.editor.input({ type: "cancel" });
		};
		const move = (e: PointerEvent) => {
			if (held && e.pointerId === pointer) {
				if (!boxing) {
					if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < slopFor("touch")) return;
					boxing = true;
					d.host.holdMenu?.(undefined);
					if (!d.editor.input({ type: "press-canvas", ...pointerInput(event, d.worldAt(event)) })) return;
				}
				d.editor.input({ type: "move", ...pointerInput(e, d.worldAt(e)) });
				return;
			}
			if (e.pointerId !== pointer && e.pointerType === "touch") pinched = true;
			// Judged on the furthest the finger went: a pan that comes back to where it began is still a pan.
			else if (e.pointerId === pointer && Math.hypot(e.clientX - from.x, e.clientY - from.y) >= TAP_SLOP_PX) travelled = true;
			if (pinched || travelled) clearTimeout(hold);
		};
		const up = (e: PointerEvent) => {
			if (e.pointerId !== pointer) return;
			done();
			if (boxing) return void d.editor.input({ type: "release", ...pointerInput(e, d.worldAt(e)) });
			if (held) return;
			if (pinched || travelled || stopping || performance.now() - since > TAP_MS) return;
			batch(() => {
				d.editor.select([]);
				d.editor.pickPages([]);
			});
			// A second tap close by, soon after: a note there, as a double-click is with a mouse.
			const now = performance.now();
			const twice = isBareSecondTap(d.lastBareTap, { x: e.clientX, y: e.clientY }, now);
			d.lastBareTap = twice ? undefined : { x: e.clientX, y: e.clientY, at: now };
			if (twice && d.host.editable() && !d.host.drawing()) d.host.noteAt(e);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", cancel);
	};

	return {
		tapToDeselect,
	};
}
