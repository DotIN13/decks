/**
 * The worker's tiles as the page takes them in: as bytes or as pictures (`pixelsFirst`), how much
 * of a frame the taking may spend (`tileBudget`), and where a tile sits on the stage (`tileArea`).
 */
import { knobs } from "../debug.ts";

/**
 * Whether the worker hands its tiles to the page as their bytes rather than as pictures: under
 * WebKit (Safari, and every browser on iOS and iPadOS), whose copy of a worker's picture into a
 * texture (`copyExternalImageToTexture`) costs the page's thread about 2 ms a 512-pixel tile on an
 * iPad mini 6, against 0.17 ms to write its bytes (`writeTexture`): a pinch's tiles took 180 to 300
 * ms of it. Chromium copies a picture in about 0.04 ms at the median (now and then 12 ms, waiting
 * on the GPU process, which is why tiles are taken in outside the frame's callback: `takeTilesSoon`),
 * and keeps pictures: as bytes, zooming was as smooth (14 to 20 frames of 180 over 9 ms either
 * way), but a fast pan was filled in 17 to 48 ms instead of 7 to 8, every tile waiting for its read
 * back from the worker's device. WebKit is told by its user agent: AppleWebKit without Chrome's,
 * Chromium's or Edge's name (Chrome on a Mac says AppleWebKit too; Chrome on iOS says CriOS, and is
 * WebKit). `knobs.tilePixels` (true or false), set before the stage opens, says it instead.
 */
export function pixelsFirst(): boolean {
	const forced = knobs.tilePixels;
	if (typeof forced === "boolean") return forced;
	return webKit();
}

/** WebKit (Safari, and every browser on iOS and iPadOS), by its user agent, as `pixelsFirst` tells it. */
export function webKit(): boolean {
	const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
	return /AppleWebKit\//.test(agent) && !/(Chrome|Chromium|Edg|HeadlessChrome)\//.test(agent);
}

/**
 * How much of a frame the page spends taking the worker's tiles in (`takeTiles`): this many
 * milliseconds, and under WebKit, whose clock counts whole milliseconds, no more than `bytes` tiles
 * of bytes (about 0.3 ms each on an iPad mini) or `pictures` tiles of pictures (about 2 ms) a frame
 * either; what is left waits for the next frame, the window's tiles first. A pinch's tiles taken in
 * all at once held frames on an iPad mini for 40 to 100 ms. Three tiles of bytes a frame, tried
 * first, made a pinch's tiles take 300 ms to come in where all at once took 65 (WebKit as an iPad
 * mini on a Mac). `knobs.tileBudget` changes it, for measuring.
 */
const TILE_BUDGET = { ms: 4, bytes: 12, pictures: 2 };
export const tileBudget = (): typeof TILE_BUDGET => ({ ...TILE_BUDGET, ...knobs.tileBudget });
/** A tile's place on the stage, `[x, y, side]`, from its key (`scale` is an `f32`'s bits). */
const tileScale = new DataView(new ArrayBuffer(4));
export function tileArea(t: { scale: number; x: number; y: number }): [number, number, number] {
	tileScale.setUint32(0, t.scale);
	const side = TILE_SIDE / tileScale.getFloat32(0);
	return [t.x * side, t.y * side, side];
}
const TILE_SIDE = 512;
