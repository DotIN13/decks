/**
 * A resize handle held by the pointer, and let go however that happens.
 *
 * The side panel's right edge and the line above the conversation are both handles of this kind,
 * and both had learned the same lesson separately: a drag must end however the button comes up.
 * On the handle, anywhere in the window, outside it, over a board's frame (which swallows the
 * pointer), on a lost capture, or when the window loses focus. A mouse moved with no button held
 * ends it too, so a release nobody reported cannot leave the handle stuck to the pointer.
 *
 * `move` is told each step of the drag; `end` is told once, after the capture is released.
 */
export function holdHandle(event: PointerEvent, move: (moved: PointerEvent) => void, end: () => void): void {
	const handle = event.currentTarget as HTMLElement;
	try {
		handle.setPointerCapture(event.pointerId);
	} catch {
		// A capture refused still leaves the window listeners below.
	}
	let done = false;
	const step = (moved: PointerEvent) => {
		// A mouse moved with no button held has been let go of somewhere; a finger or a pen ends on its own pointerup.
		if (moved.pointerType === "mouse" && moved.buttons === 0) return finish();
		move(moved);
	};
	const finish = () => {
		if (done) return;
		done = true;
		window.removeEventListener("pointermove", step, true);
		window.removeEventListener("pointerup", finish, true);
		window.removeEventListener("pointercancel", finish, true);
		window.removeEventListener("blur", finish);
		handle.removeEventListener("lostpointercapture", finish);
		try {
			handle.releasePointerCapture(event.pointerId);
		} catch {
			// Already gone.
		}
		end();
	};
	window.addEventListener("pointermove", step, true);
	window.addEventListener("pointerup", finish, true);
	window.addEventListener("pointercancel", finish, true);
	window.addEventListener("blur", finish);
	handle.addEventListener("lostpointercapture", finish);
}
