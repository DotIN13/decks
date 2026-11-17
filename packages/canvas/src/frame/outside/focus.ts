import type { Accessor } from "solid-js";
import { onCleanup } from "solid-js";

/** What `createFrameFocus` reads of the frame's host (`host.tsx`). */
export interface FrameFocusNeeds {
	readonly frameAt: Accessor<HTMLIFrameElement | undefined>;
}

/** Whether the person is using the frame: it has the focus, or had it a moment ago, or a press is down. */
export function createFrameFocus(d: FrameFocusNeeds) {
	/*
	 * Whether you are using the canvas: the frame has focus, or had it a moment ago (the popover's Enter
	 * moves focus out to the composer as the comment is handed over). Drafts for the composer are taken
	 * only then: a card's script runs as the frame's own code, and could otherwise slip one in at any time.
	 */
	let frameLeftAt = 0;

	let frameHadFocus = false;

	const FOCUS_GRACE = 2000;

	const frameFocused = () => {
		const frame = d.frameAt();
		return !!frame && document.activeElement === frame && document.hasFocus();
	};

	/*
	 * And only just after a press or a key of yours: a script in the frame can focus it without one
	 * (Chrome lets a sandboxed frame take focus from a timer), but cannot make one, and a press or a key
	 * in the frame counts on this page too (`navigator.userActivation`, a few seconds long).
	 */
	const pressed = () => (typeof navigator === "undefined" || !navigator.userActivation ? true : navigator.userActivation.isActive);

	const frameInUse = () => (frameFocused() || (frameLeftAt > 0 && Date.now() - frameLeftAt < FOCUS_GRACE)) && pressed();

	if (typeof window !== "undefined") {
		const noteFocus = () => {
			const now = frameFocused();
			if (frameHadFocus && !now) frameLeftAt = Date.now();
			frameHadFocus = now;
		};
		// Focus going into the frame blurs this window; focus coming out lands on something here.
		const onBlur = () => setTimeout(noteFocus, 0);
		window.addEventListener("blur", onBlur);
		window.addEventListener("focus", noteFocus);
		document.addEventListener("focusin", noteFocus, true);
		onCleanup(() => {
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("focus", noteFocus);
			document.removeEventListener("focusin", noteFocus, true);
		});
	}

	return {
		frameInUse,
	};
}
