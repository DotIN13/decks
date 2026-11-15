/**
 * A WebGL 2 context can be lost (the GPU process restarting, too many contexts, a phone reclaiming
 * memory) and given back. The engine prevents the lost event's default, which is what asks the
 * browser to give it back (`crates/gpu/src/targets/webgl.rs`); everything on the context is gone by
 * then, so when it is restored the stage starts its engine again on the same canvas.
 *
 * The page's canvas is an `HTMLCanvasElement`, the worker's an `OffscreenCanvas`: both are event
 * targets for these two events.
 */

/** `lost` when the canvas's context goes, `restored` when it is back. */
export function watch(canvas: EventTarget, on: { lost: () => void; restored: () => void; isLost: () => boolean }): () => void {
	const lost = () => on.lost();
	const restored = () => on.restored();
	canvas.addEventListener("webglcontextlost", lost);
	canvas.addEventListener("webglcontextrestored", restored);
	return () => {
		canvas.removeEventListener("webglcontextlost", lost);
		canvas.removeEventListener("webglcontextrestored", restored);
	};
}
