import type { ComponentKind } from "@decks/protocol";

/** The tool in hand on the canvas: select, or a kind of block to put on a board. */
export type Tool = "select" | ComponentKind;

/**
 * What a click on a board means: **browse** reads it (text selects, a game plays), **edit**
 * moves and sizes what is on the canvas.
 */
export type CanvasMode = "browse" | "edit";

/** Whether a key or a paste belongs to something being typed in. */
export function typingInto(target: EventTarget | null): boolean {
	const element = target as HTMLElement | null;
	if (!element) return false;
	return Boolean(element.isContentEditable) || element.tagName === "TEXTAREA" || element.tagName === "INPUT";
}
