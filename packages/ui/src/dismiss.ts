/**
 * Put away every open menu, popover and picker of this document.
 *
 * Each of them closes on a press anywhere else or on Escape, heard on its own document. The canvas
 * frame is a document of its own: a press in the page (the side panel, the composer, the top bar)
 * never reaches the frame's listeners, and a press in the frame never reaches the page's. So the
 * frame's bridge tells the other side (`frame/inside/frame.tsx`, `frame/outside/host.tsx`), which
 * calls `dismissMenus()`, and everything that opens listens with `onDismiss`.
 *
 * Unlike a press, this moves no focus: a menu put away this way does not hand the keyboard back to
 * its button, which would pull it out of the document the person just pressed in.
 */
const EVENT = "decks:dismiss";

export function dismissMenus(): void {
	if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** Call `close` when menus are put away from elsewhere; returns what stops listening. */
export function onDismiss(close: () => void): () => void {
	if (typeof window === "undefined") return () => {};
	const listener = () => close();
	window.addEventListener(EVENT, listener);
	return () => window.removeEventListener(EVENT, listener);
}
