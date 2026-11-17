import type { Tab } from "./kind.ts";
import { placeLink } from "./link.ts";
import { cameraCanvasTab, onCanvas } from "./tabs.ts";

/** How far a press moves before it is a drag, in pixels: under it, it is the press on the tab it always was. */
const SLOP = 8;

/**
 * A tab dragged from the row onto the canvas leaves a link to itself there, a chip where it is let
 * go (`link.ts`, `placeLink`): how something already open is pointed at from a canvas.
 *
 * The press is the tab's own until it has moved; then a small copy of the tab follows the pointer,
 * marked when it is over a canvas that would take it, and letting go there places the chip. Let go
 * anywhere else, nothing happens, and either way the tab itself is not pressed. There is nothing to
 * drop on while a card, a document or an app is in front, and a canvas takes no link to itself.
 */
export function dragToCanvas(tab: Tab, title: () => string): { press: (event: PointerEvent) => void; wasDrag: () => boolean } {
	let dragged = false;
	/** Whether the canvas on screen is under a point of the window, and would take this tab's link. */
	const takes = (x: number, y: number): boolean => onCanvas() && tab !== cameraCanvasTab() && !!document.elementFromPoint(x, y)?.closest('.surface[data-surface="stage"]');
	const press = (event: PointerEvent) => {
		dragged = false;
		if (event.button !== 0 || event.pointerType === "touch" || tab.target === undefined) return;
		const chip = event.currentTarget as HTMLElement;
		const from = { x: event.clientX, y: event.clientY };
		let ghost: HTMLElement | undefined;
		const move = (at: PointerEvent) => {
			if (!ghost) {
				if (Math.hypot(at.clientX - from.x, at.clientY - from.y) < SLOP) return;
				dragged = true;
				ghost = document.createElement("div");
				ghost.className = "tab-ghost";
				ghost.textContent = title();
				document.body.append(ghost);
			}
			ghost.style.transform = `translate(${at.clientX + 12}px, ${at.clientY + 10}px)`;
			ghost.dataset.over = String(takes(at.clientX, at.clientY));
		};
		const end = (at: PointerEvent) => {
			chip.removeEventListener("pointermove", move);
			chip.removeEventListener("pointerup", end);
			chip.removeEventListener("pointercancel", end);
			if (!ghost) return;
			// What is under the pointer, not the copy that follows it.
			ghost.remove();
			if (at.type === "pointerup" && takes(at.clientX, at.clientY)) void placeLink({ kind: tab.kind, target: tab.target }, { x: at.clientX, y: at.clientY });
		};
		// The pointer is the tab's from the press on: a quick drag is over the canvas's frame before it has moved far, and the frame would take its moves.
		chip.setPointerCapture(event.pointerId);
		chip.addEventListener("pointermove", move);
		chip.addEventListener("pointerup", end);
		chip.addEventListener("pointercancel", end);
	};
	return {
		press,
		/** Whether the press that just ended was a drag: its click is then not a press on the tab. Asked once. */
		wasDrag: () => {
			const was = dragged;
			dragged = false;
			return was;
		},
	};
}
