import type { PressTarget } from "../editor/core/dispatch.ts";

// Where a press landed: the canvas's own element, something drawn on it, or
// anything else, such as a page. Read the same way by the canvas and the editor.

/** Where an event landed, in `core/dispatch.ts`'s words. */
export function pressTarget(element: HTMLElement, target: EventTarget | null): PressTarget {
	if (target === element) return "stage";
	return onDrawn(target) ? "drawn" : "other";
}

/**
 * A press on a drawn item's click shape (`render/engine.ts`, `attachHits`). Only items over a page
 * have one, to take the press from the page; on bare canvas `pickAt` finds the item.
 */
export function onDrawn(target: EventTarget | null): boolean {
	return !!(target as Element | null)?.closest?.(".pen-hits");
}

/** Bare canvas or something drawn on it: either way not a page, and the canvas's to handle. */
export function onCanvas(element: HTMLElement | undefined, target: EventTarget | null): boolean {
	return target === element || onDrawn(target);
}
