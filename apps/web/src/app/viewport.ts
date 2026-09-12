/**
 * The part of the window a person can actually see.
 *
 * On a desktop these are the same thing and this file does nothing. On a phone they
 * come apart the moment a keyboard appears: the layout viewport stays the size it was —
 * that is what stops a fixed-position app reflowing every time somebody types — and the
 * *visual* viewport shrinks to what is left above the keys. Nothing in CSS knows about
 * the difference, so an input bar positioned 12px from the bottom of the window sits
 * 300px behind the keyboard, which is exactly where the composer was.
 *
 * The answer is one custom property. `--keyboard` is how much of the bottom is covered,
 * and the chrome that lives at the bottom adds it to its own offset; when nothing is
 * covering anything it is 0 and every rule reads as it always did. Set from script
 * because there is no CSS unit for this — `dvh` describes the whole viewport, not the
 * inset, and would move the dock by resizing the app.
 *
 * The same property does a second job for free: anything that shrinks the visual viewport
 * — the keyboard, and a page zoom on a browser that still allows one — moves the dock with
 * it rather than leaving it off screen.
 */

/** How much of the layout viewport the browser is covering, in CSS pixels. */
export function obscured(): { top: number; bottom: number } {
	const view = window.visualViewport;
	if (!view) return { top: 0, bottom: 0 };
	return {
		top: Math.max(0, Math.round(view.offsetTop)),
		bottom: Math.max(0, Math.round(window.innerHeight - view.height - view.offsetTop)),
	};
}

/**
 * Keep `--keyboard` on the document root true, for as long as the app is running.
 *
 * Both events matter and for different reasons: `resize` is the keyboard opening and
 * closing, and `scroll` is the visual viewport being moved about *without* changing
 * size, which is what iOS does when it scrolls a focused field into view. Watching only
 * the first leaves the dock 40px out after every such nudge.
 */
export function trackVisualViewport(): () => void {
	const view = window.visualViewport;
	if (!view) return () => {};
	const root = document.documentElement;

	const apply = () => {
		const { bottom } = obscured();
		// Written only when it changes: this fires on every frame of a keyboard
		// animation, and a style write per frame invalidates the whole chrome each time.
		if (root.style.getPropertyValue("--keyboard") === `${bottom}px`) return;
		root.style.setProperty("--keyboard", `${bottom}px`);
	};

	view.addEventListener("resize", apply);
	view.addEventListener("scroll", apply);
	apply();
	return () => {
		view.removeEventListener("resize", apply);
		view.removeEventListener("scroll", apply);
		root.style.removeProperty("--keyboard");
	};
}

/**
 * Refuse to zoom the page, on the browsers that ignore being told not to.
 *
 * `user-scalable=no` in the viewport meta is honoured by Android and ignored by iOS Safari,
 * which has fired `gesturestart` / `gesturechange` / `gestureend` for a pinch since long
 * before it stopped honouring the meta. Cancelling those is the only thing left that stops
 * a two-finger pinch scaling the app.
 *
 * It does not touch the canvas. The board pinch is built on pointer and touch events
 * (`canvas/touch.ts`, `canvas/frame-gestures.ts`) and Safari fires both streams for the same
 * fingers, so the gesture that zooms the boards is unaffected — which is the whole point of
 * this: one pinch, one thing zoomed, and it is the thing under your fingers.
 *
 * Registered non-passive, because a passive listener cannot cancel anything, and on the
 * *document* rather than the app root: a gesture that begins over a board's frame is still
 * Safari's page zoom, and the frame is a separate document with its own root.
 */
export function blockPageZoom(): () => void {
	const stop = (event: Event) => event.preventDefault();
	const events = ["gesturestart", "gesturechange", "gestureend"];
	for (const name of events) document.addEventListener(name, stop, { passive: false });
	return () => {
		for (const name of events) document.removeEventListener(name, stop);
	};
}
