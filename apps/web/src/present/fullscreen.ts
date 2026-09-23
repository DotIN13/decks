/**
 * The Fullscreen API, from the app's side: asking for it, and noticing when it ends.
 *
 * ### Why an overlay has to care
 *
 * Escape is the **browser's** key while the API is engaged. Chrome takes it to leave
 * fullscreen itself and never dispatches it to the page — so an overlay that only listens for
 * Escape does not hear the first press at all, and the person presses again. That is the whole
 * of "Escape needs pressing twice": once to leave the browser's fullscreen, which the app does
 * not see, and once to close the overlay, which it does.
 *
 * The fix is to make the browser's own exit mean ours: a `fullscreenchange` with nothing in
 * fullscreen any more *is* somebody leaving, whoever did it. Which is also the only signal that
 * covers the other ways out of fullscreen that no key produces — a swipe from the top edge on a
 * phone, the browser's own chrome, another tab taking the screen.
 *
 * The overlay is still the presentation when the API is refused or absent: it is a fixed layer
 * *first*, and `requestFullscreen` is best-effort on top (`present/Present.tsx`). So this never
 * assumes the API engaged — with nothing in fullscreen, no `fullscreenchange` fires and Escape
 * reaches the page as usual.
 */

/** The part of `Document` this needs, so a test can supply one. */
export interface FullscreenHost {
	addEventListener(type: string, listener: () => void): void;
	removeEventListener(type: string, listener: () => void): void;
	readonly fullscreenElement: Element | null;
}

/**
 * Call `whenLeft` when the document is no longer in fullscreen — by Escape, by the browser's
 * own chrome, by anything. Returns the unsubscribe, because the overlay that asked is the
 * overlay that is going away.
 */
export function onFullscreenLeft(doc: FullscreenHost, whenLeft: () => void): () => void {
	const listener = () => {
		if (!doc.fullscreenElement) whenLeft();
	};
	doc.addEventListener("fullscreenchange", listener);
	return () => doc.removeEventListener("fullscreenchange", listener);
}

/**
 * Ask for fullscreen, and do not care whether it is granted.
 *
 * Deliberately unawaited and deliberately silent: a refusal is not a failure, because the
 * overlay already fills the window. A sandboxed frame, a browser without the API and a person
 * who said no are all the same case here.
 */
export function enterFullscreen(element: Element | null | undefined): void {
	void element
		?.requestFullscreen?.()
		.catch(() => {});
}

/** Leave it, if we are in it. The `fullscreenchange` that follows is handled by the caller. */
export function exitFullscreen(doc: Pick<Document, "fullscreenElement" | "exitFullscreen">): void {
	if (doc.fullscreenElement) void doc.exitFullscreen().catch(() => {});
}
