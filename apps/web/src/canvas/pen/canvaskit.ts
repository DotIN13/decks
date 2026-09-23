import type { CanvasKit } from "canvaskit-wasm";

/**
 * CanvasKit, loaded once and only when a stage has something to draw.
 *
 * Skia compiled to WebAssembly: the same engine Chrome draws the page with, and the one pen.dev's
 * renderer and OpenPencil's are built on. It is seven megabytes, so it is a separate chunk that a
 * stage with no drawing never fetches; the wasm file goes through Vite as an asset, so it is
 * cached with the rest of the build.
 */

let loading: Promise<CanvasKit> | undefined;

export function canvasKit(): Promise<CanvasKit> {
	loading ??= (async () => {
		const [{ default: init }, { default: wasm }] = await Promise.all([import("canvaskit-wasm"), import("canvaskit-wasm/bin/canvaskit.wasm?url")]);
		return init({ locateFile: () => wasm });
	})();
	return loading;
}
