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
	/** `backend` is the page's (`"webgpu"` or `"webgl2"`): the worker opens the same first. */
	| { type: "init"; doc: string; dark: boolean; backend?: string }
	| { type: "doc"; doc: string; dark: boolean }
	| { type: "edits"; edits: string }
	| { type: "font"; name: string; bytes: Uint8Array; fallback: boolean }
	/** `width` × `height`: the picture's own size, when the bitmap was made smaller to fit. */
	| { type: "picture"; url: string; bitmap: ImageBitmap; width?: number; height?: number }
	| { type: "icon"; key: string; shape: string }
	| { type: "view"; view: string }
	| { type: "lift"; ids: string[] }
	| { type: "drop"; ids: string[] }
	| { type: "camera"; x: number; y: number; zoom: number; dpr: number; width: number; height: number; moving: boolean }
	| { type: "dropped"; keys: Array<[number, number, number]> };

/** Messages from it. */
export type FromWorker =
	/** The worker is drawing, with this graphics API (`"webgpu"` or `"webgl2"`). */
	| { type: "ready"; backend: string }
	| { type: "tiles"; tiles: Array<{ scale: number; x: number; y: number; bitmap: ImageBitmap }> }
	| { type: "landed"; ids: string[] }
	| { type: "discarded"; keys: Array<[number, number, number]> }
	| { type: "wanted"; urls: string[] }
	| { type: "resync" }
	| { type: "error"; message: string };
