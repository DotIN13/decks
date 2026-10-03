import assert from "node:assert/strict";
import { test } from "node:test";
import { holdFrames } from "./hold-frames.ts";

/** A window whose frames run when `tick` is called. */
const fakeWindow = () => {
	let id = 0;
	const queue = new Map<number, FrameRequestCallback>();
	const win = {
		requestAnimationFrame: (cb: FrameRequestCallback) => (queue.set(++id, cb), id),
		cancelAnimationFrame: (at: number) => void queue.delete(at),
	} as unknown as Window;
	const tick = () => {
		const now = [...queue.values()];
		queue.clear();
		for (const cb of now) cb(0);
	};
	return { win, tick, pending: () => queue.size };
};

test("a loop stops while the camera moves and carries on when it rests", () => {
	const { win, tick, pending } = fakeWindow();
	let frames = 0;
	const loop = () => {
		frames++;
		win.requestAnimationFrame(loop);
	};
	const hold = holdFrames(win);
	win.requestAnimationFrame(loop);
	tick();
	assert.equal(frames, 1);
	hold.hold(true);
	tick();
	tick();
	assert.equal(frames, 2, "the frame already granted runs, and the next is kept");
	assert.equal(pending(), 0);
	hold.hold(false);
	tick();
	assert.equal(frames, 3, "rest grants the kept request");
	hold.detach();
});

test("a kept request can still be cancelled, and detach gives the page its own functions back", () => {
	const { win, tick } = fakeWindow();
	const own = win.requestAnimationFrame;
	const hold = holdFrames(win);
	hold.hold(true);
	let ran = false;
	const id = win.requestAnimationFrame(() => (ran = true));
	win.cancelAnimationFrame(id);
	hold.hold(false);
	tick();
	assert.equal(ran, false);
	hold.detach();
	assert.equal(win.requestAnimationFrame, own);
});
