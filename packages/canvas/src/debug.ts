/**
 * What the browser checks and the measuring scripts reach from outside the canvas, in one place and
 * with one type each: the knobs they set (before the stage opens, or during a run) and the probes
 * the canvas offers them. Nothing in the canvas reads a probe, and nothing outside sets one; a knob
 * is the other way round. Both live on `globalThis` as `__decksKnobs` and `__decksProbes`, so a
 * check reaches them with `page.evaluate` and a script with the console.
 *
 * A knob set before this module runs (a check's `addInitScript`, the page's `?probe=` parameters)
 * is kept: the object found on `globalThis` is read into the defaults, then replaced by `knobs`.
 */

/** What the stage last did, for the checks and the crash recorder: the sheet's counters, and the engine's. */
export type SheetStats = Record<string, unknown> & { shown?: number; ink?: number; tiles?: number; pixelTiles?: number; sharpAt?: number; settledAt?: number };

export interface Knobs {
	/** While zooming, paint tiles at the power of two under the zoom (the default) rather than sharp, for measuring. */
	halfZoom: boolean;
	/** Keep the pinch's tails (the moving-scale tiles painted after the last finger lifts), as a wheel's pinch does. */
	pinchTail: boolean;
	/** Hand every camera through to the settled camera, rather than only one that moved past a pan's threshold. */
	exactCamera: boolean;
	/** No glide: an edited item lands where it is rather than sliding there. */
	noGlide: boolean;
	/** During a fast zoom, skip the levels between (the default); false paints every level. */
	skipLevels: boolean;
	/** Warm the engines' pipelines once they start (the default); false leaves it out. */
	warm: boolean;
	/** Tiles as pixel bytes (true) or as bitmaps (false), overriding what the backend decides. */
	tilePixels?: boolean | undefined;
	/** Changes to the tile budget: ms a frame, bytes, pictures. */
	tileBudget?: { ms?: number; bytes?: number; pictures?: number } | undefined;
	/** The card-picture budget on the GPU, in MB. */
	pictureMB?: number | undefined;
	/** Card pictures copied to the GPU in one frame. */
	picturesPerFrame?: number | undefined;
	/** Set to an array, each glide frame's main-thread cost in ms is pushed onto it. */
	glideCost?: number[] | undefined;
	/** Set to an array, every step of the stage's finger pool is pushed onto it. */
	touchLog?: unknown[] | undefined;
}

export interface Probes {
	/** The sheet's counters, written by the engine as it draws. */
	sheet: SheetStats;
	/** How many sharper card pictures faded in over the coarser one. */
	pictureFades: number;
	/** How often the items layer rebuilt its list of cards for the engine: a camera step should not. */
	cardLists: number;
	/** How many surfaces were made for each card, and how many times each mounted its file. */
	made: Record<string, { surfaces: number; mounts: number }>;
	/** The stage engine itself (`render/engine.ts`, `StageEngine`). */
	rust?: unknown;
	/** The engine's statistics, and what a drag carries as pictures. */
	engine?: { stats(): Record<string, unknown>; readonly carried: { paths: Set<string> } & Record<string, unknown> } | undefined;
	/** What glides now: each item's shift. */
	glide?: (() => Array<[string, unknown]>) | undefined;
	/** The world's transform as a CSS string, from the camera. */
	cameraTransform?: (() => string) | undefined;
	/** Where a drawn item is on screen. */
	penBox?: ((id: string) => DOMRect | undefined) | undefined;
	/** The frame a drop at a screen point would go into, and the world point. */
	frameUnder?: ((clientX: number, clientY: number) => { frame: string | null; world: { x: number; y: number } }) | undefined;
	/** The card drawn as its picture under a screen point. */
	pictureAt?: ((x: number, y: number) => string | undefined) | undefined;
	/** The card under a screen point and the slot between its blocks there. */
	cardAt?: ((x: number, y: number) => { card: string; index: number; inner: number } | undefined) | undefined;
	/** The cards on screen, each with its node, revision and rectangle. */
	cards?: ((...args: never[]) => unknown) | undefined;
	/** The items the engine is drawing as their pictures now. */
	pictured?: (() => string[]) | undefined;
	/** The items chosen awake and kept asleep, with the selected, hovered and held ones. */
	awake?: (() => unknown) | undefined;
	/** The awake choice alone. */
	liveCards?: (() => unknown) | undefined;
	/** The canvas frame's: its drawing, its news, select items, its camera and its state. */
	frameDrawn?: (() => unknown) | undefined;
	frameNews?: (() => unknown) | undefined;
	frameSelect?: ((ids: string[]) => void) | undefined;
	frameCamera?: (() => unknown) | undefined;
	frameState?: (() => unknown) | undefined;
}

const DEFAULTS: Knobs = { halfZoom: true, pinchTail: false, exactCamera: false, noGlide: false, skipLevels: true, warm: true };

type Globals = { __decksKnobs?: Partial<Knobs>; __decksProbes?: Probes };
const g = globalThis as Globals;

export const knobs: Knobs = { ...DEFAULTS, ...g.__decksKnobs };
export const probes: Probes = g.__decksProbes ?? { sheet: { shown: 0, tiles: 0 }, pictureFades: 0, cardLists: 0, made: {} };
g.__decksKnobs = knobs;
g.__decksProbes = probes;
