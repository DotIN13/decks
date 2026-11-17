import type { PressTarget } from "../core/dispatch.ts";

/** Where an event landed, in `core/dispatch.ts`'s words. */
export function pressTarget(element: HTMLElement, target: EventTarget | null): PressTarget {
	if (target === element) return "stage";
	return (target as Element | null)?.closest?.(".pen-hits") ? "drawn" : "other";
}
