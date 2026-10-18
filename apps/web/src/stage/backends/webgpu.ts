/**
 * WebGPU's device can be lost (a driver reset, the GPU process restarting, a laptop switching
 * cards). wgpu hears it and the engine says so (`PageEngine.lost()`, `WorkerEngine.lost()`), but
 * no event reaches the page, so the stage asks: a lost device is started again on the same canvas,
 * which keeps its WebGPU context and can be configured anew.
 */

/** How often the engine is asked whether its device is gone. */
const EVERY_MS = 1000;

/** Call `restored` (there is nothing to wait for) once `isLost` says the device is gone. */
export function watch(_canvas: EventTarget, on: { lost: () => void; restored: () => void; isLost: () => boolean }): () => void {
	const timer = setInterval(() => {
		if (!on.isLost()) return;
		clearInterval(timer);
		on.lost();
		on.restored();
	}, EVERY_MS);
	return () => clearInterval(timer);
}
