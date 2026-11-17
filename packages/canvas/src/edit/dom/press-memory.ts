import { onCleanup } from "solid-js";
import { type BareTap, type LastTap } from "../core/dispatch.ts";

/** What the pointer remembers from one press to the next: when the camera was last dragged, what the last press landed on, and the last taps. */
export function createPressMemory() {
	/**
	 * When the camera was last dragged, so a double-click can tell itself apart from a pan.
	 *
	 * Chromium fires `dblclick` after two presses whatever happened between them, and a quick
	 * pan is two presses with a lot happening between them — so without this, dragging the
	 * canvas about would leave a new note behind at the end of it.
	 */
	let pannedAt = 0;

	/**
	 * What the last press landed on, before anything it did moved: a double-click's second press on a
	 * handle whose edit is drawn at once (an arrow's bend put back) leaves bare canvas under the
	 * pointer by the time `dblclick` comes, and that is not a double-click on the canvas or on what is
	 * under it now (a note there would open for typing).
	 */
	let pressedOn: EventTarget | null = null;

	const notePress = (event: PointerEvent) => {
		pressedOn = event.target;
	};

	addEventListener("pointerdown", notePress, true);

	onCleanup(() => removeEventListener("pointerdown", notePress, true));

	let lastBareTap: BareTap | undefined;

	/** The last tap on a drawn item, so a second one soon after on the same item opens its words. */
	let lastTap: LastTap | undefined;

	return {
		get lastBareTap() { return lastBareTap; },
		set lastBareTap(next) { lastBareTap = next; },
		get lastTap() { return lastTap; },
		set lastTap(next) { lastTap = next; },
		get pressedOn() { return pressedOn; },
		set pressedOn(next) { pressedOn = next; },
		get pannedAt() { return pannedAt; },
		set pannedAt(next) { pannedAt = next; },
	};
}
