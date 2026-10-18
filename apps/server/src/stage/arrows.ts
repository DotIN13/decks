import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { arrowEndItem, isPointEnd, type ArrowRouter, type Frame } from "@decks/pen";
import { initSync, routeArrow } from "@decks/stage";

/**
 * The server's arrow router: the stage engine's own (`stage_scene::arrows`, through `routeArrow`),
 * so a path saved after an edit is the path the page routes while the same arrow is dragged. The
 * engine's module is the one `text.ts` loads to measure words; it is loaded here on first use, at
 * once, since a save cannot wait for it.
 */
let loaded = false;
function load(): void {
	if (loaded) return;
	initSync({ module: readFileSync(fileURLToPath(new URL("stage_web_bg.wasm", import.meta.resolve("@decks/stage")))) });
	loaded = true;
}

export const rustRouter: ArrowRouter = (metadata, end, strokeWidth) => {
	load();
	const meta = (metadata ?? {}) as { from?: unknown; to?: unknown };
	const ends: Record<string, [number, number, number, number]> = {};
	for (const one of [meta.from, meta.to]) {
		if (isPointEnd(one)) continue;
		const name = arrowEndItem(one);
		const box: Frame | undefined = name === undefined ? undefined : end(name);
		if (!box) return undefined;
		ends[name!] = [box.x, box.y, box.w, box.h];
	}
	const routed = routeArrow(JSON.stringify(metadata ?? {}), JSON.stringify(ends), strokeWidth);
	if (!routed) return undefined;
	const shape = JSON.parse(routed) as { x: number; y: number; width: number; height: number; geometry: string };
	return { ...shape, viewBox: [0, 0, shape.width, shape.height] };
};
