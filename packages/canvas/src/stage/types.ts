import type { Frame } from "@decks/pen";

/** A drag or a resize in progress: moved by `dx dy`, and sized `w h` when resizing. */
export interface PenPreview {
	dx: number;
	dy: number;
	w?: number;
	h?: number;
	/** A corner radius being dragged; `null` takes it off. */
	radius?: number | null;
	/** Fields changed on the item, as an `update` op's `set`: a colour being dragged. `null` takes one off. */
	set?: Record<string, unknown>;
}

/**
 * The edits that made a drawing from the one before it (`from`): the stage's engines apply them in
 * place of working out what changed, when `from` is the drawing they hold. A host that hears a
 * drawing's changes as edits (the Decks app's `stage.pen.delta`, a mounted canvas's own `onEdits`)
 * hands them along with the drawing they make.
 */
export interface DocEdits {
	from: import("@decks/pen").PenDocument;
	edits: readonly import("@decks/pen").PenEdit[];
}

/** A board as the stage places it: its box, whether its page is showing, and its picture. */
export interface SceneBoard {
	path: string;
	x: number;
	y: number;
	w: number;
	h: number;
	/** Its page is showing: nothing is drawn for it under the pages. */
	live: boolean;
	/** Where its picture is, when it is not live: an absolute URL. */
	picture?: string;
	/** Have the picture ready while the board is live, so a drag can carry it at once. */
	ready?: boolean;
	/** The writer's colour, when the board is news. */
	news?: string;
	/** Draw the news mark as an outline: the board has no page to draw its glow. */
	glow?: boolean;
}

/** A stroke of ink the drawing does not hold yet, as the page shaped it (`strokeShape`), in stage pixels. */
export interface LiveInk {
	id: string;
	/** SVG path data: a filled outline, or a centre line stroked `size` wide. */
	d: string;
	filled: boolean;
	/** A CSS colour, already resolved for the scheme. */
	color: string;
	size: number;
	opacity: number;
}

/** A markdown card's links and wide tables, for a press to be answered with. */
export interface CardGeometry {
	id: string;
	order: number;
	box: Frame;
	pad: number;
	links: Array<{ x: number; y: number; w: number; h: number; href: string; scroller: number | null }>;
	scrollers: Array<{ x: number; y: number; w: number; h: number; content: number }>;
}

/** What a press found: the item, its node, and the box it covers. */
export interface PenHit {
	id: string;
	node: import("@decks/pen").PenNode;
	box: Frame;
}

/** Messages to the render worker (`render.worker.ts`). */
export type ToWorker =
	/**
	 * `backend` is the page's (`backends/detect.ts`): the worker loads the same build and opens the
	 * same API. `lowMemory` is the page's guess too, so both draw with as many samples a pixel.
	 */
	/**
	 * `fontsDue`: the page is fetching the drawing's fonts, which come as `fonts` messages; `docDue`:
	 * the page has no drawing yet (`doc` is empty), which comes as a `doc` message. The worker paints
	 * nothing until they have, or for 300 ms, rather than paint every tile twice.
	 */
	/** First, as soon as the page has the engine: the backend's build, as the page's compiled module when it has one, for the worker to open its device with before the drawing comes. */
	| { type: "boot"; backend: string; lowMemory?: boolean; module?: WebAssembly.Module }
	/** `pixels`: hand tiles over as their bytes, not as pictures (`pixelsFirst` in `engine.ts`); WebGPU only. */
	| { type: "init"; doc: string; dark: boolean; backend?: string; lowMemory?: boolean; fontsDue?: boolean; docDue?: boolean; pixels?: boolean }
	/** Tiles from now on as their bytes, or as pictures: for measuring one way against the other in one page. */
	| { type: "pixels"; on: boolean }
	| { type: "doc"; doc: string; dark: boolean }
	| { type: "edits"; edits: string }
	/** The page is fetching fonts: as `fontsDue`, while the worker has not yet painted its first view. */
	| { type: "fontsDue" }
	/**
	 * Font files that came together, in the chain's order: laid out and painted once for all of them.
	 * `due`: how many files the page is still fetching.
	 */
	| { type: "fonts"; fonts: Array<{ name: string; bytes: Uint8Array; fallback: boolean }>; due: number }
	/** `width` × `height`: the picture's own size, when the bitmap was made smaller to fit. */
	| { type: "picture"; url: string; bitmap: ImageBitmap; width?: number; height?: number }
	/**
	 * An image fill or a card's picture for the worker to fetch from `address` and decode, keep, and
	 * hand to the page as `picture` (`url` is its address in the drawing); no wider or taller than `max`.
	 */
	| { type: "fetchPicture"; url: string; address: string; max: number }
	| { type: "icon"; key: string; shape: string }
	| { type: "view"; view: string }
	| { type: "lift"; ids: string[] }
	| { type: "drop"; ids: string[] }
	/** `zooming`: the zoom changed while the camera moves, so tiles are painted at the power of two under it; a pan keeps the exact scale. */
	| { type: "camera"; x: number; y: number; zoom: number; dpr: number; width: number; height: number; moving: boolean; zooming?: boolean }
	| { type: "dropped"; keys: Array<[number, number, number]> };

/**
 * A tile painted by the worker: a picture (`bitmap`), or its bytes, RGBA8 premultiplied with rows
 * `stride` bytes apart (`pixels`), as the worker was asked (`init`'s `pixels`).
 */
export type TileFromWorker = { scale: number; x: number; y: number } & ({ bitmap: ImageBitmap; pixels?: undefined } | { pixels: ArrayBuffer; stride: number; bitmap?: undefined });

/** Messages from it. */
export type FromWorker =
	/** The worker is drawing, with this graphics API (`"webgpu"` or `"webgl2"`). */
	| { type: "ready"; backend: string }
	/**
	 * A batch of tiles; `left` is how many the window and its margin still need at the scale wanted
	 * after it, and `got` how many messages the worker had taken when it painted them (for `sharpAt`);
	 * `rest` what the window still needs at the scale it wants at rest, while the camera moves too (for `settledAt`).
	 */
	| { type: "tiles"; tiles: TileFromWorker[]; left: number; got: number; rest?: number; overview?: number }
	| { type: "landed"; ids: string[] }
	| { type: "discarded"; keys: Array<[number, number, number]> }
	| { type: "wanted"; urls: string[] }
	/** A picture asked for with `fetchPicture`, decoded and kept by the worker, for the page to keep too. */
	| { type: "picture"; url: string; bitmap: ImageBitmap; width: number; height: number }
	| { type: "resync" }
	| { type: "error"; message: string }
	/** The worker could not open a device: the stage shows the notice (`backends/notice.ts`). */
	| { type: "failed"; message: string }
	/** The worker's device or context was lost: the page starts both engines again. */
	| { type: "lost" };
