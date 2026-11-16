import { defineFeature, type Feature } from "../kernel/types.ts";
import { canvasCalls } from "./canvas-calls.ts";
import { Clips } from "./clips.ts";
import { frameCalls } from "./frame-calls.ts";
import { itemCalls } from "./item-calls.ts";
import { CanvasStore } from "./store.ts";

// The canvas feature: item.*, canvas.* (but screenshot and export) and
// frame.*, and the canvases every other feature reaches by ctx.canvas(name).

export function canvasFeature(options: { clock?: () => number } = {}): Feature {
	const store = new CanvasStore();
	if (options.clock) store.clock = options.clock;
	const clips = new Clips(store);
	return defineFeature({
		name: "canvas",
		calls: [...itemCalls(store, clips), ...canvasCalls(store), ...frameCalls(store)],
		canvases: (kernel) => store.bind(kernel),
		start: () => store.load(),
	});
}
