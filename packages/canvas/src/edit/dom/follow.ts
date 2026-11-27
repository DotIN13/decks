import { slopFor } from "../core/touch-rules.ts";
import type { Pt } from "../core/model.ts";
import { pointerInput, type Editor } from "./controller.ts";
import { type Client, type PointerHost } from "./pointer.ts";

/** What `createFollow` reads of `createPointer` (`pointer.ts`), each read when it is used. */
export interface FollowNeeds {
	readonly host: PointerHost;
	readonly cameraWatchers: Set<() => void>;
	readonly editor: Editor;
	readonly worldAt: (event: Client) => Pt;
}

export function createFollow(d: FollowNeeds) {
	/**
	 * Follow one press to its release: `move` on each step past the pointer's slop (`touch-rules.ts`: 3 px for a mouse, 8 for a finger), `done` at the end.
	 *
	 * The pointer is captured by `on`, the canvas unless said otherwise, and the click that ends the
	 * press goes to whatever captured it — so a press on a card's title bar keeps it on the bar, or
	 * its double-click would reach the canvas and make a note.
	 *
	 * The camera can move while the press is held (a wheel, a glide), and then the last step runs
	 * again: a `move` that reads the pointer in world space (`worldAt`) follows the cursor.
	 */
	const follow = (event: PointerEvent, move: (e: PointerEvent) => void, done: (moved: boolean, e: PointerEvent) => void, on: HTMLElement = d.host.element(), abandon?: () => void) => {
		try {
			on.setPointerCapture(event.pointerId);
		} catch {
			// Refused for a pointer the browser no longer has; the listeners still end the press.
		}
		const start = { x: event.clientX, y: event.clientY };
		const slop = slopFor(event.pointerType);
		let moved = false;
		let last: PointerEvent | undefined;
		let over = false;
		const onMove = (e: PointerEvent) => {
			if (e.pointerId !== event.pointerId || released(e)) return;
			if (!moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < slop) return;
			moved = true;
			last = e;
			move(e);
		};
		const replay = () => {
			if (moved && last) move(last);
		};
		/** A mouse move with no button held: the release went somewhere this never heard, so it is over. */
		const released = (e: PointerEvent) => {
			if (e.pointerType !== "mouse" || (e.buttons & 1) !== 0) return false;
			finish(e);
			return true;
		};
		const watch = (e: PointerEvent) => {
			if (e.pointerId === event.pointerId) released(e);
		};
		/*
		 * A second finger landing while one follows a press is a pinch, which the canvas's pool takes
		 * from here (`input.ts`): the press is abandoned, not released where it was, so a resize or a
		 * carry that had begun is put back rather than landed half done.
		 */
		const other = (e: PointerEvent) => {
			if (!abandon || e.pointerType !== "touch" || e.pointerId === event.pointerId || over) return;
			over = true;
			d.cameraWatchers.delete(replay);
			on.removeEventListener("pointermove", onMove);
			on.removeEventListener("pointerup", finish);
			on.removeEventListener("pointercancel", finish);
			on.removeEventListener("lostpointercapture", finish);
			window.removeEventListener("pointermove", watch, true);
			window.removeEventListener("pointerup", finish, true);
			window.removeEventListener("pointercancel", finish, true);
			window.removeEventListener("pointerdown", other, true);
			abandon();
		};
		if (abandon && event.pointerType === "touch") window.addEventListener("pointerdown", other, true);
		d.cameraWatchers.add(replay);
		/*
		 * Ended once, by whichever of these comes first: the release or a cancel at the element that
		 * captured the pointer, the same anywhere in the window, the capture being lost (the element
		 * left the page, or the browser took it back), or a move with no button held. Listening on
		 * the captured element alone, a release it never heard left the drag following the cursor and
		 * the camera after the button was up: zoomed out to 20%, moving a card or a group.
		 */
		const finish = (e: PointerEvent) => {
			if (over || e.pointerId !== event.pointerId) return;
			over = true;
			d.cameraWatchers.delete(replay);
			on.removeEventListener("pointermove", onMove);
			on.removeEventListener("pointerup", finish);
			on.removeEventListener("pointercancel", finish);
			on.removeEventListener("lostpointercapture", finish);
			window.removeEventListener("pointermove", watch, true);
			window.removeEventListener("pointerup", finish, true);
			window.removeEventListener("pointercancel", finish, true);
			window.removeEventListener("pointerdown", other, true);
			done(moved, e);
		};
		on.addEventListener("pointermove", onMove);
		on.addEventListener("pointerup", finish);
		on.addEventListener("pointercancel", finish);
		on.addEventListener("lostpointercapture", finish);
		window.addEventListener("pointermove", watch, true);
		window.addEventListener("pointerup", finish, true);
		window.addEventListener("pointercancel", finish, true);
	};

	/**
	 * Follow a press the editor took to its lift (`editor/core/gesture.ts`): each move and the lift
	 * told to it, in canvas coordinates. `on` captures the pointer, the canvas unless said otherwise.
	 */
	const followEditor = (event: PointerEvent, on?: HTMLElement) =>
		follow(
			event,
			(e) => d.editor.input({ type: "move", ...pointerInput(e, d.worldAt(e)) }),
			(_moved, e) => d.editor.input({ type: "release", ...pointerInput(e, d.worldAt(e)) }),
			on,
			() => d.editor.input({ type: "cancel" }),
		);

	/*
	 * A finger pressing a handle, an arrow's end or a block's grip is the editor's, and these presses
	 * stop at their element: the canvas never hears them, so the finger was not in its pool, and a
	 * pinch begun on a handle could not happen. Put in the pool here, and kept from the browser's
	 * scroll (`keepTouch`); a second finger then makes the pinch and abandons the press (`follow`).
	 */
	const fingerIn = (event: PointerEvent) => {
		if (event.pointerType !== "touch") return;
		d.host.keepTouch?.(event);
		d.host.beginTouch(event);
	};

	return {
		followEditor,
		fingerIn,
		follow,
	};
}
