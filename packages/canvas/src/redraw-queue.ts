/**
 * Redraws spread over frames, a few per frame, each board at most once.
 *
 * When the camera rests after a pinch every board in view wants drawing again at its new
 * size, and drawing sixteen documents in one frame is one long frame — measured at 118ms
 * on the server this was built on, 515ms at 4× CPU throttle. Spread over four frames it is
 * four short ones, and the boards fill in over a tenth of a second rather than the canvas
 * freezing for one.
 *
 * Keyed, so a board asked for twice while it waits is drawn once; and cancellable, so a
 * board whose document went away between the ask and the frame is skipped rather than drawn
 * from nothing. The frame source is injectable, which is what lets `redraw-queue.test.ts`
 * run it without a browser.
 */
export interface RedrawQueue {
	/** Ask for a redraw. Replaces an earlier ask under the same key. */
	add(key: string, draw: () => void): void;
	/** Take an ask back. */
	cancel(key: string): void;
	/** How many asks are waiting. */
	size(): number;
	/** Drop everything waiting, and the frame that was going to run it. */
	clear(): void;
}

export function createRedrawQueue(options: {
	/** How many draws one frame may run. */
	perFrame?: number;
	/** `requestAnimationFrame`, or a stand-in. */
	frame?: (callback: () => void) => number;
	cancelFrame?: (id: number) => void;
} = {}): RedrawQueue {
	const perFrame = Math.max(1, options.perFrame ?? 4);
	const frame = options.frame ?? ((callback) => requestAnimationFrame(callback));
	const cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id));
	const waiting = new Map<string, () => void>();
	let scheduled: number | undefined;

	const run = () => {
		scheduled = undefined;
		let done = 0;
		for (const [key, draw] of waiting) {
			if (done >= perFrame) break;
			waiting.delete(key);
			done++;
			try {
				draw();
			} catch {
				// One board that will not draw must not stop the ones behind it.
			}
		}
		if (waiting.size > 0) scheduled = frame(run);
	};

	return {
		add(key, draw) {
			waiting.set(key, draw);
			if (scheduled === undefined) scheduled = frame(run);
		},
		cancel(key) {
			waiting.delete(key);
		},
		size: () => waiting.size,
		clear() {
			waiting.clear();
			if (scheduled !== undefined) cancelFrame(scheduled);
			scheduled = undefined;
		},
	};
}
