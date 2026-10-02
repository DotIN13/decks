import { StageScene, type SceneInput, type SceneOutput } from "./scene.ts";

/**
 * The stage's drawing, painted off the page's thread (`scene.ts`, `layer.ts`).
 *
 * The page sends what changed; this lays the drawing out, records it, paints each frame into an
 * `OffscreenCanvas` and hands the finished bitmap back. The page's only work per frame is to swap
 * that bitmap in and place it, so a pan or a pinch never waits on Skia.
 */

interface WorkerScope {
	postMessage(message: SceneOutput, transfer: Transferable[]): void;
	onmessage: ((event: MessageEvent<SceneInput | { type: "init"; origin: string }>) => void) | null;
}
const scope = self as unknown as WorkerScope;

let scene: StageScene | undefined;
/*
 * Once per worker. WebKit evaluates a module worker's entry again when a chunk imports it, and a
 * second handler with no scene behind it took every message after that (`vite.config.ts` keeps the
 * entry out of the shared chunk; this keeps a second evaluation harmless if it ever is).
 */
if (!scope.onmessage) scope.onmessage = (event) => {
	const message = event.data;
	if (message.type === "init") {
		scene = new StageScene({
			post: (out, transfer) => scope.postMessage(out, transfer ?? []),
			canvas: () => new OffscreenCanvas(1, 1),
			snapshot: (canvas) => (canvas as OffscreenCanvas).transferToImageBitmap(),
			origin: message.origin,
		});
		return;
	}
	scene?.receive(message);
};
