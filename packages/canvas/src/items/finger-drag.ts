import { HOLD_MS, slopFor } from "../edit/core/touch-rules.ts";
import type { ItemSlotExtras, ItemSlotProps } from "./item-slot-props.ts";

/** What `createFingerDrag` reads of `ItemSlot` (`item-slot.tsx`). */
export interface FingerDragNeeds {
	readonly props: ItemSlotProps & ItemSlotExtras;
}

/** A finger's drag on a live item: it moves the item by its body, as a mouse does by its title. */
export function createFingerDrag(d: FingerDragNeeds) {
	/*
	 * A finger on the item, as a finger on the drawing is: it pans the canvas, selected or not (`panTouch`:
	 * the cover keeps the browser's scroll off, so the canvas's own pool pans), and only a tap selects; a tap
	 * on the item already selected activates it. Held still for `HOLD_MS`, the item is selected and the
	 * finger is claimed (`claimTouch`): moving from there carries it, moved once, on the lift. A tap is a
	 * lift near where the finger landed, with no second finger down meanwhile and no moving canvas caught
	 * by it: a pinch or a pan that began on an item never selects it.
	 */
	const fingerDrag = (event: PointerEvent) => {
		if (event.button !== 0) return;
		event.preventDefault();
		const wasSelected = d.props.selected;
		d.props.gestures.panTouch(event.pointerId);
		// Whether this finger caught a glide or a coast: the canvas judges it as the press bubbles on to it.
		let stopping = false;
		queueMicrotask(() => (stopping = d.props.gestures.caught()));
		const from = { x: event.clientX, y: event.clientY };
		const origin = { x: d.props.card.x, y: d.props.card.y };
		const scale = d.props.zoom || 1;
		let to: { x: number; y: number } | undefined;
		let travelled = false;
		let other = false;
		let over = false;
		/** Held still: the item is selected and the finger carries it from here. */
		let held = false;
		const hold = setTimeout(() => {
			if (travelled || other || d.props.gestures.pinching()) return;
			held = true;
			d.props.gestures.claimTouch(event.pointerId);
			if (!d.props.selected) d.props.view.select();
		}, HOLD_MS);
		const second = (next: PointerEvent) => {
			if (next.pointerType === "touch" && next.pointerId !== event.pointerId) other = true;
		};
		const move = (next: PointerEvent) => {
			if (next.pointerId !== event.pointerId) return;
			if (other || d.props.gestures.pinching()) return finish(true);
			if (!travelled && Math.hypot(next.clientX - from.x, next.clientY - from.y) < slopFor("touch")) return;
			travelled = true;
			clearTimeout(hold);
			if (!held) return;
			to = { x: origin.x + (next.clientX - from.x) / scale, y: origin.y + (next.clientY - from.y) / scale };
			d.props.view.dragging(to);
		};
		const finish = (abandon = false) => {
			if (over) return;
			over = true;
			clearTimeout(hold);
			window.removeEventListener("pointerdown", second, true);
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", end);
			window.removeEventListener("pointercancel", cancel);
			d.props.view.dragging(null);
			if (to && !abandon && !other) return d.props.onMove(Math.round(to.x), Math.round(to.y));
			if (abandon || other || stopping) return;
			if (travelled || held) return;
			// A tap: on the item already selected it is activated, and its page takes the fingers from here; on any other it selects it.
			if (wasSelected) {
				if (!d.props.active) d.props.onActivate?.();
			} else d.props.view.select();
		};
		const end = (done: PointerEvent) => done.pointerId === event.pointerId && finish();
		const cancel = (done: PointerEvent) => done.pointerId === event.pointerId && finish(true);
		window.addEventListener("pointerdown", second, true);
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", end);
		window.addEventListener("pointercancel", cancel);
	};

	return {
		fingerDrag,
	};
}
