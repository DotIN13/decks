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
 * The same property does a second job for free: pinch-zooming the *page* (which the
 * canvas allows, since `viewport-fit=cover` and a scalable viewport are what make text
 * legible for someone who needs it larger) also shrinks the visual viewport, and the
 * dock follows it down rather than sitting off screen.
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
