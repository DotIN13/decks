import type { Touches } from "../camera/touch.ts";
import type { KeptTouches } from "./fingers.ts";
import type { Setter } from "solid-js";
import type { Camera } from "@decks/protocol";
import { pan } from "../camera/camera.ts";
import type { CameraController } from "../camera/controller.ts";
import { untilReleased } from "../edit/held.ts";
import type { ItemSlotProps } from "../items/item-slot-props.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";
import type { ViewInputDeps } from "./input.ts";

/** What `createPresses` reads of `createViewInput` (`input.ts`), each read when it is used. */
export interface PressesNeeds {
	readonly claimed: Set<number>;
	readonly keptTouches: KeptTouches;
	readonly touches: Touches;
	readonly fingers: { keptTouches: KeptTouches; touches: Touches; claimed: Set<number>; poolPans: boolean; caught: boolean; beginTouch: (event: PointerEvent) => void; };
	readonly el: () => HTMLDivElement;
	readonly props: CanvasViewProps;
	readonly setPanning: Setter<boolean>;
	readonly pushCamera: (cam: Camera) => void;
	readonly ctl: CameraController;
	readonly deps: ViewInputDeps;
}

export function createPresses(d: PressesNeeds) {
	/** What an item's slot asks of the canvas's fingers: a finger its bar or edge took carries the item, and the camera does not pan with it. */
	const gestures: ItemSlotProps["gestures"] = {
		claimTouch: (id) => {
			d.claimed.add(id);
			d.keptTouches.add(id);
		},
		pinching: () => d.touches.count() > 1,
		panTouch: (id) => {
			d.fingers.poolPans = true;
			d.keptTouches.add(id);
		},
		caught: () => d.fingers.caught,
	};

	/**
	 * The camera dragged from a press (`editor/core/dispatch.ts`, `pan`): with the middle button, with
	 * Space held, or on bare canvas, which lets the selected card go (`deselect`).
	 */
	const panFrom = (event: PointerEvent, how: { deselect: boolean; middle: boolean }) => {
		const { middle } = how;
		event.preventDefault();
		const element = d.el();
		if (how.deselect) d.props.onSelect(undefined);
		element.setPointerCapture(event.pointerId);
		d.setPanning(true);

		let last = { x: event.clientX, y: event.clientY };
		const move = (moveEvent: PointerEvent) => {
			d.pushCamera(pan(d.ctl.now(), moveEvent.clientX - last.x, moveEvent.clientY - last.y));
			last = { x: moveEvent.clientX, y: moveEvent.clientY };
			d.deps.editor().panned();
		};
		// Ended on any sign the button is up, not only its release (`held.ts`).
		const stop = untilReleased({ docs: [document], held: middle ? 4 : 1, capture: element, end: () => finish() });
		const finish = () => {
			stop();
			element.removeEventListener("pointermove", move);
			d.setPanning(false);
		};
		element.addEventListener("pointermove", move);
	};

	return {
		panFrom,
		gestures,
	};
}
