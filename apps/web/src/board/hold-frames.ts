/**
 * A board's animation frames, held while the camera moves.
 *
 * A board's page runs on the app's own thread (it is a same-origin frame), so a board that animates
 * — a three.js scene, a chart that eases, a game — draws a frame of its own on every frame of a pan
 * or a zoom, and the canvas waits for it. Measured: one three.js board drew on every step of a pan.
 * While the camera moves, a request for the next frame is kept instead of granted, and every kept
 * request is granted the moment the camera rests. A loop that asks for its next frame from inside
 * its frame therefore stops at the start of the movement and carries on after it.
 *
 * The page keeps its own `requestAnimationFrame`; this wraps it on the frame's window, as the
 * page sees it, and gives it back on `detach`.
 */
export interface FrameHold {
	hold(on: boolean): void;
	detach(): void;
}

export function holdFrames(win: Window): FrameHold {
	const grant = win.requestAnimationFrame;
	const revoke = win.cancelAnimationFrame;
	const held = new Map<number, FrameRequestCallback>();
	// Kept requests get ids of their own, below zero, so a cancel can tell them from the page's.
	let nextId = -1;
	let holding = false;
	win.requestAnimationFrame = (callback) => {
		if (!holding) return grant.call(win, callback);
		const id = nextId--;
		held.set(id, callback);
		return id;
	};
	win.cancelAnimationFrame = (id) => {
		if (id < 0) held.delete(id);
		else revoke.call(win, id);
	};
	const release = () => {
		const waiting = [...held.values()];
		held.clear();
		for (const callback of waiting) grant.call(win, callback);
	};
	return {
		hold(on) {
			if (on === holding) return;
			holding = on;
			if (!on) release();
		},
		detach() {
			holding = false;
			release();
			win.requestAnimationFrame = grant;
			win.cancelAnimationFrame = revoke;
		},
	};
}
