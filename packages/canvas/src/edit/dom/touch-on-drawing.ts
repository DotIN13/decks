import { TEXTY } from "../core/text.ts";
import { mediaOf } from "@decks/pen";
import { isSecondTap, TAP_MS, type LastTap } from "../core/dispatch.ts";
import { HOLD_MS, slopFor } from "../core/touch-rules.ts";
import type { Pt } from "../core/model.ts";
import { type Picked, type PickOptions } from "../core/pick.ts";
import { pointerInput, type Editor } from "./controller.ts";
import { type Client, type PointerHost, } from "./pointer.ts";

/** What `createTouchOnDrawing` reads of `createPointer` (`pointer.ts`), each read when it is used. */
export interface TouchOnDrawingNeeds {
	readonly worldAt: (event: Client) => Pt;
	readonly pickAtHere: (at: Pt, options?: PickOptions) => Picked | undefined;
	readonly editor: Editor;
	readonly host: PointerHost;
	lastTap: LastTap | undefined;
}

export function createTouchOnDrawing(d: TouchOnDrawingNeeds) {
	/**
	 * A finger on the drawing. On an item already selected it moves the selection (the finger is
	 * claimed, so the camera stays put); anywhere else it is a pan unless it lifts where it landed,
	 * which is a tap: the item is selected, and a second tap on words opens them for typing.
	 */
	const touchOnDrawing = (event: PointerEvent) => {
		const at = d.worldAt(event);
		const hit = d.pickAtHere(at);
		if (!hit) return;
		const pointer = event.pointerId;
		const from = { x: event.clientX, y: event.clientY };
		const since = performance.now();
		const selected = d.editor.items();
		/*
		 * One finger pans, whatever it lands on, selected or not: the finger is the stage's to scroll with,
		 * and a tap selects. Held still first, it selects what it is on (`hold`), and moving from there
		 * carries it: the finger is the editor's from the hold.
		 */
		let carrying = false;
		let moved = false;
		let held = false;
		// A second finger anywhere makes this a pinch, even if this finger never moves; a finger that caught a moving canvas only stopped it.
		let pinched = false;
		const stopping = d.host.caught?.() ?? false;
		const second = (e: PointerEvent) => {
			if (e.pointerType === "touch" && e.pointerId !== pointer) pinched = true;
		};
		window.addEventListener("pointerdown", second, true);
		/*
		 * Held still for `HOLD_MS`: the item is selected and its menu opens at the finger (`holdMenu`); the
		 * finger is claimed so the lift neither taps nor pans, and a carry it had begun is let go.
		 */
		const hold = setTimeout(() => {
			// A finger that stopped a moving canvas and then held still means the hold: only its tap is kept back.
			if (moved || pinched || d.host.fingers() > 1) return;
			held = true;
			d.host.claim(pointer);
			d.host.keepTouch?.(event);
			d.host.onSelect(undefined);
			d.editor.pickPages([]);
			// What it is on joins nothing: it is selected alone, unless it was part of the selection already.
			if (!selected.includes(hit.id)) d.editor.select([hit.id]);
			d.host.holdMenu?.({ ids: d.editor.items().slice(), at: from, canvas: at });
		}, HOLD_MS);
		const done = () => {
			clearTimeout(hold);
			window.removeEventListener("pointerdown", second, true);
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", cancel);
		};
		const abandon = () => {
			done();
			d.editor.input({ type: "cancel" });
		};
		const move = (e: PointerEvent) => {
			if (e.pointerId !== pointer) return;
			// A second finger: this was the start of a pinch, and whatever it carried goes back.
			if (d.host.fingers() > 1) return abandon();
			// A finger may wobble its slop (8 px) before it means to move; past it the carry begins.
			if (!moved && Math.hypot(e.clientX - from.x, e.clientY - from.y) < slopFor("touch")) return;
			clearTimeout(hold);
			// Moved after its hold: the menu goes, and the editor carries the selection from where the finger was held (`editor/core/gesture.ts`, a finger's carry).
			if (!moved && held) {
				carrying = true;
				d.host.holdMenu?.(undefined);
				d.editor.input({ type: "carry", from: { at, client: from }, ...pointerInput(e, d.worldAt(e)) });
			}
			moved = true;
			if (!carrying) return;
			d.editor.input({ type: "move", ...pointerInput(e, d.worldAt(e)) });
		};
		const up = (e: PointerEvent) => {
			if (e.pointerId !== pointer) return;
			done();
			if (held && !moved) return;
			if (moved) {
				if (carrying) d.editor.input({ type: "release", ...pointerInput(e, d.worldAt(e)) });
				else d.editor.input({ type: "cancel" });
				return;
			}
			if (pinched || stopping || performance.now() - since > TAP_MS) return;
			const deep = d.pickAtHere(at, { deep: true });
			// A film or a sound: a tap plays it or pauses it, and selects it as any tap does.
			const playable = deep && mediaOf(deep.node) ? deep : mediaOf(hit.node) ? hit : undefined;
			const media = playable ? mediaOf(playable.node) : undefined;
			if (playable && media) {
				d.lastTap = undefined;
				d.host.toggleMedia(playable.id, media);
				d.host.onSelect(undefined);
				d.editor.pickPages([]);
				d.editor.select([hit.id]);
				return;
			}
			if (isSecondTap(d.lastTap, hit.id, performance.now()) && deep && (d.host.open.liveFile(deep.id) || d.host.open.file(deep.id))) {
				d.lastTap = undefined;
				return;
			}
			if (isSecondTap(d.lastTap, hit.id, performance.now()) && deep && (deep.node.type !== "rectangle" || !d.host.open.cardOf(deep.id)) && d.host.open.cardAt(deep, at, { x: e.clientX, y: e.clientY })) {
				d.lastTap = undefined;
				return;
			}
			if (isSecondTap(d.lastTap, hit.id, performance.now()) && deep && (TEXTY.has(deep.node.type) || d.host.open.shapeOf(deep.id))) {
				d.lastTap = undefined;
				const shape = d.host.open.shapeOf(deep.id);
				if (shape && !TEXTY.has(deep.node.type)) d.host.open.shapeWords(shape);
				else d.host.open.text(deep);
				return;
			}
			const href = d.host.mode() === "browse" ? d.host.linkAt(at) : undefined;
			if (href) return d.editor.openLink(href);
			d.lastTap = { id: hit.id, at: performance.now() };
			// A second tap on the one thing selected keeps it selected.
			if (selected.length === 1 && selected[0] === hit.id) return;
			d.host.onSelect(undefined);
			d.editor.pickPages([]);
			d.editor.select([hit.id]);
		};
		const cancel = (e: PointerEvent) => {
			if (e.pointerId === pointer) abandon();
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", cancel);
	};

	return {
		touchOnDrawing,
	};
}
