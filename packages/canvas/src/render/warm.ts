import type { ToWorker } from "./types.ts";
import { detect, type Detected, type StageModule } from "./backends/detect.ts";

/**
 * The engine, started before there is a canvas to draw: its worker made and its script loaded, the
 * backend found, the engine's module compiled here and handed to the worker, which opens its device.
 *
 * All of that is the same whatever canvas comes, and from a far device it is most of a second: the
 * worker's script alone is 570 KB, fetched whole each time, since a frame has no cache. A frame kept
 * spare by its page (`frame/outside/surface.tsx`) does it while nothing is waiting (`warmEngine`),
 * and the engine of the first canvas it is given takes what was made (`takeWarm`) instead of making
 * it. One at a time: an engine that finds nothing warm starts as it always did.
 */
export interface Warm {
	worker: Worker;
	detected: Detected;
	stage: StageModule;
}

let warm: Promise<Warm | undefined> | undefined;

/** Start warming, once: `startWorker` and `moduleOf` are the engine's own (`engine.ts`), given so this file holds no second way to do either. */
export function warmEngine(startWorker: () => Worker, moduleOf: (stage: StageModule) => WebAssembly.Module | undefined): void {
	warm ??= (async () => {
		const worker = startWorker();
		try {
			const detected = await detect();
			const stage = await detected.backend.load();
			worker.postMessage({ type: "boot", backend: detected.backend.name, lowMemory: detected.lowMemory, module: moduleOf(stage) } satisfies ToWorker);
			return { worker, detected, stage };
		} catch {
			// Not to be had (no backend, a module that would not load): the engine that comes finds out for itself, and says so.
			worker.terminate();
			return undefined;
		}
	})();
}

/** What was warmed, to the one engine that asks first; nothing when nothing was. */
export function takeWarm(): Promise<Warm | undefined> | undefined {
	const one = warm;
	warm = undefined;
	return one;
}
