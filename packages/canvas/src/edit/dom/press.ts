import { decidePress } from "../core/dispatch.ts";
import type { Pt } from "../core/model.ts";
import { type Picked, type PickOptions } from "../core/pick.ts";
import { pressTarget } from "./press-target.ts";
import { type Client, type PointerHost } from "./pointer.ts";

/** What `createPress` reads of `createPointer` (`pointer.ts`), each read when it is used. */
export interface PressNeeds {
	readonly host: PointerHost;
	readonly onCanvas: (target: EventTarget | null) => boolean;
	readonly pickAtHere: (at: Pt, options?: PickOptions) => Picked | undefined;
	readonly worldAt: (event: Client) => Pt;
	readonly pictureUnder: (event: Client) => string | undefined;
	readonly penPress: (event: PointerEvent) => boolean;
	readonly dragPage: (path: string, event: PointerEvent, on?: HTMLElement) => boolean;
	readonly selectPage: (path: string) => void;
	readonly touchOnDrawing: (event: PointerEvent) => void;
	readonly tapToDeselect: (event: PointerEvent) => void;
}

export function createPress(d: PressNeeds) {
	/**
	 * A press on the canvas (`core/dispatch.ts` decides what it starts). The drawing, in either mode:
	 * an armed tool makes its item; otherwise a press on an item picks it up, a shift-press adds it
	 * to the selection or takes it out, and a drag on empty canvas draws a marquee. A finger goes to
	 * the canvas's pool, and on the drawing it taps and carries. The camera pans with Space and a
	 * drag, the middle button, a scroll or a pinch: that is the canvas's (`PointerHost`, `pan`).
	 *
	 * Touch is asked of the event rather than of the screen size: a laptop with a touchscreen has
	 * both, and each pointer should mean what it means. `preventDefault` is not called for a finger —
	 * the frames' `touch-action` is what stops the browser scrolling, and swallowing the default
	 * here would take focus away from the composer mid-sentence.
	 */
	const onPointerDown = (event: PointerEvent) => {
		const element = d.host.element();
		const kind = event.pointerType;
		/*
		 * A Pencil on bare canvas is a stroke, whatever tool is in hand: the pen comes on by itself and
		 * the press starts the stroke, as on an iPad's own apps. On an item it still selects and moves
		 * as a pointer does, and a finger is never this.
		 */
		if (kind === "pen" && event.button === 0 && d.host.editable() && !d.host.drawing() && d.host.tool() === "select" && d.onCanvas(event.target) && !d.pickAtHere(d.worldAt(event)) && !d.pictureUnder(event) && d.host.pencil?.(event)) return;
		const act = decidePress({
			pointer: kind === "touch" || kind === "pen" ? kind : "mouse",
			button: event.button,
			target: pressTarget(element, event.target),
			editable: d.host.editable(),
			drawing: d.host.drawing(),
			tool: d.host.tool(),
			space: d.host.spaceHeld(),
			fingers: d.host.fingers(),
			onItem: () => !!d.pickAtHere(d.worldAt(event)),
			picture: () => d.pictureUnder(event),
		});
		// A finger that presses something rather than the canvas is the editor's, not the browser's to scroll with.
		if (kind === "touch" && act.do !== "touch" && act.do !== "pan") d.host.keepTouch?.(event);
		switch (act.do) {
			case "make":
			case "press":
				d.penPress(event);
				return;
			case "picture":
				if (!act.carry || !d.dragPage(act.path, event, element)) d.selectPage(act.path);
				return;
			case "touch":
				// The touch first: it clears the selection for a finger on bare canvas, which a card's picture lies on,
				// so selecting the card before it was undone by the same press.
				d.host.beginTouch(event);
				if (act.picture) {
					d.selectPage(act.picture);
					return;
				}
				if (act.then === "drawing") d.touchOnDrawing(event);
				else if (act.then === "deselect") d.tapToDeselect(event);
				return;
			case "pan":
				d.host.pan(event, { deselect: act.deselect, middle: act.middle });
				return;
			case "nothing":
				return;
		}
	};

	return {
		onPointerDown,
	};
}
