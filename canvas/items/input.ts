import { zoomKey } from "../camera/zoom-keys.ts";
import { INTERACTIVE, scrollsInside } from "./card.ts";

/**
 * What a press, a wheel or a key inside an awake item is: the item's own, or the stage's. One rule
 * for a card's root, a document's editor and an app's window (`card-surface.tsx`, `item-surfaces.tsx`):
 *
 * - **A mouse or pen press** inside the item is the item's: it selects the item and reaches the control
 *   under it in the same press, and never starts a marquee or a pan. The item moves by its bar and its edge.
 *   With Shift or ⌘ it is offered to the editor first (`onAddPress`), which adds the item to the selection.
 * - **A finger** pans the canvas across the item, unless it lands on one of the item's controls; a
 *   primary finger selects the item as it would a picture.
 * - **A wheel** scrolls what inside the item can take it, and pans the canvas otherwise; a pinch always zooms.
 * - **Keys** pressed while the focus is in the item are the item's: a press in a card puts the focus in it
 *   (its body takes the focus), and its scripts hear the keys there; Delete, the arrows, Space and the
 *   letters do nothing to the canvas. Escape leaves the item, the focus back on the canvas and the item
 *   still selected, where Delete and the arrows act on it again; ⌘+, ⌘− and ⌘0 zoom from anywhere.
 *
 * `target` is where the listeners go (a card's closed shadow root, which alone can tell a press on the
 * card's button from one on its background; an element otherwise), `host` the element whose own
 * scrolling counts as inside.
 */
interface OwnInput {
	selected: () => boolean;
	onSelect: () => void;
	/** A Shift or ⌘ press offered to the editor: true when it took it. */
	onAddPress?: ((event: PointerEvent, on: HTMLElement) => boolean) | undefined;
}

/** Whether the event's target is one of the item's own controls. */
const onControl = (event: Event) => event.composedPath().some((target) => target instanceof Element && target.matches?.(INTERACTIVE));

export function ownInput(target: EventTarget, host: HTMLElement, input: OwnInput): void {
	target.addEventListener("pointerdown", (event) => {
		const press = event as PointerEvent;
		if (press.pointerType === "touch") {
			// A finger's press goes on to the stage, which pans or pinches with it, and picks the item as a finger on a picture does; a press on a control keeps it.
			if (onControl(press)) press.stopPropagation();
			else if (press.isPrimary && !input.selected()) input.onSelect();
			return;
		}
		if (press.button !== 0 && press.button !== 2) return;
		if (press.button === 0 && (press.shiftKey || press.metaKey) && !onControl(press) && input.onAddPress?.(press, host)) return;
		if (!input.selected()) input.onSelect();
		press.stopPropagation();
	});
	for (const type of ["pointerup", "click", "dblclick", "contextmenu"]) target.addEventListener(type, (event) => (event as PointerEvent).pointerType !== "touch" && event.stopPropagation());
	target.addEventListener(
		"wheel",
		(event) => {
			const wheel = event as WheelEvent;
			if (wheel.ctrlKey) return;
			if (scrollsInside(wheel.composedPath(), host, wheel.deltaX, wheel.deltaY)) wheel.stopPropagation();
		},
		{ passive: true },
	);
	for (const type of ["keydown", "keyup", "keypress"])
		target.addEventListener(type, (event) => {
			const key = event as KeyboardEvent;
			// The canvas's zoom, wherever the focus is (`stage/input.ts`).
			if (zoomKey(key)) return;
			event.stopPropagation();
			if (type === "keydown" && key.key === "Escape") {
				key.preventDefault();
				leave(host);
			}
		});
}

/** Out of the item: the focus back on the canvas it sits on, the item still selected. */
function leave(host: HTMLElement): void {
	const stage = host.closest<HTMLElement>(".stage");
	if (stage) stage.focus({ preventScroll: true });
	else (document.activeElement as HTMLElement | null)?.blur?.();
}
