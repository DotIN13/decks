import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRedrawQueue } from "./redraw-queue.ts";

/** A frame source that runs only when told to. */
const clock = () => {
	const frames: Array<() => void> = [];
	return {
		frame: (callback: () => void) => {
			frames.push(callback);
			return frames.length;
		},
		cancelFrame: (id: number) => {
			frames[id - 1] = () => {};
		},
		tick: () => {
			const due = frames.splice(0);
			for (const callback of due) callback();
		},
		pending: () => frames.length,
	};
};

describe("redraw queue", () => {
	it("runs a few per frame and the rest on the frames after", () => {
		const c = clock();
		const queue = createRedrawQueue({ perFrame: 4, frame: c.frame, cancelFrame: c.cancelFrame });
		const drawn: string[] = [];
		for (let i = 0; i < 10; i++) queue.add(`b${i}`, () => drawn.push(`b${i}`));
		assert.equal(c.pending(), 1, "one frame asked for, however many were added");
		c.tick();
		assert.equal(drawn.length, 4);
		assert.equal(queue.size(), 6);
		c.tick();
		c.tick();
		assert.equal(drawn.length, 10);
		assert.equal(c.pending(), 0, "nothing scheduled once the queue is empty");
	});

	it("draws a board once however often it was asked, with the latest draw", () => {
		const c = clock();
		const queue = createRedrawQueue({ perFrame: 4, frame: c.frame, cancelFrame: c.cancelFrame });
		const drawn: string[] = [];
		queue.add("a", () => drawn.push("first"));
		queue.add("a", () => drawn.push("second"));
		c.tick();
		assert.deepEqual(drawn, ["second"]);
	});

	it("skips a cancelled ask and survives a draw that throws", () => {
		const c = clock();
		const queue = createRedrawQueue({ perFrame: 4, frame: c.frame, cancelFrame: c.cancelFrame });
		const drawn: string[] = [];
		queue.add("gone", () => drawn.push("gone"));
		queue.add("bad", () => {
			throw new Error("no document");
		});
		queue.add("ok", () => drawn.push("ok"));
		queue.cancel("gone");
		c.tick();
		assert.deepEqual(drawn, ["ok"]);
	});

	it("clear drops the waiting draws and the frame", () => {
		const c = clock();
		const queue = createRedrawQueue({ perFrame: 4, frame: c.frame, cancelFrame: c.cancelFrame });
		const drawn: string[] = [];
		queue.add("a", () => drawn.push("a"));
		queue.clear();
		c.tick();
		assert.deepEqual(drawn, []);
		assert.equal(queue.size(), 0);
	});
});
