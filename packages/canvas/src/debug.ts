/**
 * What reaches the canvas from outside, for measuring and for the browser checks, and nothing the app
 * itself depends on. Two objects, the only names the canvas puts on `globalThis`:
 *
 * - `knobs` (`__decksKnobs`): switches the engine and the camera read. A check or a profiling run sets
 *   one before the stage opens (an init script) or between gestures; what was set before this module
 *   loaded is kept.
 * - `probes` (`__decksProbes`): what the stage and the engine hand out so a check can ask where things
 *   are without a click shape to measure: every board's rectangle on screen, a drawn item's, the camera
 *   as a transform, the engine itself.
 *
 * The checks read them as `window.__decksProbes?.boards?.()` and set them as
 * `(globalThis.__decksKnobs ??= {}).tilePixels = true`.
 */

export interface Knobs {
	/** Paint tiles at half density while a zoom changes (`engine/engine.ts`); false paints them sharp, for measuring. */
	halfZoom: boolean;
	/** During a fast zoom, skip the levels between the one shown and the one wanted; false paints every level. */
	skipLevels: boolean;
	/** Once the stage is first sharp, make in idle time what a first gesture would (`warm`); false leaves it out. */
	warm: boolean;
	/** Keep a pinch's tails after the fingers lift (`camera/controller.ts`); the checks that measure a pinch set it. */
	pinchTail: boolean;
	/** Hand every camera through to a board unrounded (`camera/controller.ts`), for measuring. */
	exactBoardCamera: boolean;
	/** Tiles come from the worker as bytes (true) or bitmaps (false), instead of as the browser decides (`pixelsFirst`). */
	tilePixels?: boolean;
	/** How much of a frame taking tiles in may spend (`TILE_BUDGET`): ms, bytes-tiles and picture-tiles. */
	tileBudget?: { ms?: number; bytes?: number; pictures?: number };
	/** The board pictures' GPU budget, in MB, instead of the device's (`device.ts`). */
	pictureMB?: number;
	/** How many board pictures go to the GPU a frame, instead of `PICTURES_PER_FRAME`. */
	picturesPerFrame?: number;
	/** Image fills fetched and decoded on the page, twice, as before the worker did it: for measuring the two in one page. */
	picturesOnPage?: boolean;
	/** The lasso's live ink shaped whole every frame instead of by its new points (`ink/StageInk.tsx`). */
	inkWhole?: boolean;
	/** The live ink drawn on the glass as an `.ink-live` path again, for a check to read its shape. */
	inkOnSvg?: boolean;
}

const DEFAULT_KNOBS: Knobs = { halfZoom: true, skipLevels: true, warm: true, pinchTail: false, exactBoardCamera: false };

/** The stage's answers for the checks, set as the stage and the engine come up; undefined before. */
export interface Probes {
	/** Every board on the canvas and where it is on screen, node or picture. */
	boards?: () => Array<{ path: string; node: boolean; rect: DOMRect }>;
	/** Where a drawn item is on screen. */
	penBox?: (id: string) => DOMRect | undefined;
	/** The camera as the world's transform used to say it: `translate(half the window) scale(zoom) translate(−camera)`. */
	cameraTransform?: () => string;
	/** The frame a drop at a screen point would go into, and the point in world coordinates. */
	frameUnder?: (clientX: number, clientY: number) => { frame: string | null; world: { x: number; y: number } };
	/** The board picture under a screen point, if a picture is drawn there. */
	pictureAt?: (x: number, y: number) => string | undefined;
	/** The card under a screen point and the slot between its blocks there (`app/files.ts` drops files into it). */
	cardAt?: (x: number, y: number) => { card: string; index: number; inner: number } | undefined;
	/** The stage engine itself (`StageEngine`), whatever it holds. */
	rust?: unknown;
	/** The engine's counters and what a drag carries, as the checks read them. */
	engine?: { stats: () => Record<string, unknown>; readonly carried: { paths: Set<string>; dx: number; dy: number } };
	/** The sheet's counters: frames shown, tiles taken, when it was first sharp and settled. */
	sheet: Record<string, unknown> & { shown?: number; ink?: number; tiles?: number; pixelTiles?: number; sharpAt?: number; settledAt?: number };
}

type Global = typeof globalThis & { __decksKnobs?: Partial<Knobs>; __decksProbes?: Probes };
const g = globalThis as Global;

/** The knobs, with whatever a page set before this module loaded kept. */
export const knobs: Knobs = Object.assign(DEFAULT_KNOBS, g.__decksKnobs);
g.__decksKnobs = knobs;

export const probes: Probes = Object.assign({ sheet: { shown: 0, tiles: 0 } }, g.__decksProbes);
g.__decksProbes = probes;
