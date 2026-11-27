import type { JSX } from "solid-js";

/** What the editor over a card is given (`CardEditor.tsx`). */
export interface CardEditorProps {
	value: string;
	/** Where the deck's files are, for the card's pictures. */
	base: string;
	/** A new empty line before this block, the caret in it: a double-click in a gap of the card. */
	insertAt?: number;
	/** Where the caret goes, a screen point: a double-click on the card's words. */
	caretAt?: { x: number; y: number };
	/** Items in the card the editor keeps but cannot type into, by id: what to call each (`card-frame.ts`). */
	held?: Record<string, string>;
	/** The camera's zoom: the editor is drawn in the canvas's units, its style bar in the screen's. */
	zoom: number;
	class?: string;
	style: JSX.CSSProperties;
	onInput(markdown: string): void;
	onCommit(markdown: string): void;
	/** Escape: with the words as they are now, for a card just made, which keeps them. */
	onCancel(markdown: string): void;
}
