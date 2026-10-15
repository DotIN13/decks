// The scene asks the page to measure an item's words: `Module.measure(handle, maxWidth, withNode)`,
// set by `src/scene.ts`, answers with a width and a height.
addToLibrary({
	scene_measure: (handle, maxWidth, withNode, out) => {
		const size = Module["measure"](handle, maxWidth, withNode);
		HEAPF64[out >> 3] = size.w;
		HEAPF64[(out >> 3) + 1] = size.h;
	},
});
