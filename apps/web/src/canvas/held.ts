/**
 * The end of a drag that holds a button down: the first sign, from any of the documents it can
 * cross, that the button is up.
 *
 * The release alone is not enough, and every way a wheel-press pan kept following a mouse with no
 * button held came from trusting it. A board's page moves under the pointer as the pan lands, so the
 * release can happen over the app while only the board was listening; a window that loses focus
 * mid-drag never hears it; a lost capture sends it to some other element; and a Chrome on Windows
 * that starts its own autoscroll on the middle button takes the release for itself. So the drag also
 * ends on a move with its button no longer in `buttons`, on a release or a cancel anywhere in these
 * documents, on a lost capture, and on a window that blurs or hides.
 *
 * Returns the function that stops listening, which `end` also does, once.
 */
export function untilReleased(options: {
	/** The documents the pointer may be over while the drag lasts: the app's, and a board's when it started there. */
	docs: readonly Document[];
	/** `buttons` bits that hold this drag: 4 for the middle button, 1 for the primary one. */
	held: number;
	/** The element holding the pointer capture, whose loss ends the drag. */
	capture?: Element;
	end: () => void;
}): () => void {
	let done = false;
	const stop = () => {
		if (done) return;
		done = true;
		for (const doc of options.docs) {
			doc.removeEventListener("pointermove", moved, true);
			doc.removeEventListener("pointerup", finish, true);
			doc.removeEventListener("pointercancel", finish, true);
			doc.removeEventListener("visibilitychange", hidden);
			doc.defaultView?.removeEventListener("blur", blurred);
		}
		options.capture?.removeEventListener("lostpointercapture", finish);
	};
	const finish = () => {
		if (done) return;
		stop();
		options.end();
	};
	// A real move only: a replayed one from an embedded page says nothing about the buttons.
	const moved = (event: PointerEvent) => {
		if (event.isTrusted && event.pointerType === "mouse" && (event.buttons & options.held) === 0) finish();
	};
	/*
	 * Focus moving into a board's page blurs the app's window too, and that is not the window losing
	 * focus: only a blur that leaves no document of the app focused ends the drag. Asked a moment later,
	 * once the focus has landed.
	 */
	const blurred = () => {
		setTimeout(() => {
			if (!options.docs.some((doc) => doc.hasFocus())) finish();
		}, 0);
	};
	const hidden = (event: Event) => {
		if ((event.target as Document).visibilityState === "hidden") finish();
	};
	for (const doc of options.docs) {
		doc.addEventListener("pointermove", moved, true);
		doc.addEventListener("pointerup", finish, true);
		doc.addEventListener("pointercancel", finish, true);
		doc.addEventListener("visibilitychange", hidden);
		doc.defaultView?.addEventListener("blur", blurred);
	}
	options.capture?.addEventListener("lostpointercapture", finish);
	return stop;
}
