import type { FrameChrome } from "@decks/canvas";

/**
 * What every form's composition is handed: the frame's chrome contract, and the shared parts' wiring
 * that does not differ by form (`frame/chrome.tsx` makes it once). A form decides only where the parts go.
 */
export type FormParts = {
	chrome: FrameChrome;
	/** A tool column made a float: dragged by its grip, stowed by a throw at an edge (the desk's and the tablet's). */
	floatTools: (tools: HTMLElement, grip: HTMLElement) => { unstow: () => void };
	step: (direction: "undo" | "redo") => void;
	setPen: (on: boolean) => void;
};
