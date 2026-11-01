/**
 * What the engine paints over the canvas, as rectangles on the screen: none of it is an element any
 * more (`stage_paint::overlay`), so what has to know where an outline is on screen asks here. The
 * stage answers (`Stage.tsx`); Properties places its popover by it, and the browser checks read it
 * as `__decksOverlayRects()`.
 */
export type ScreenRect = { x: number; y: number; width: number; height: number; left: number; top: number; right: number; bottom: number };
export type OverlayRects = {
	/** Each outline: an item's, a board's (`page`), or the marquee's (`marquee`). */
	selection: Array<ScreenRect & { page: boolean; marquee: boolean }>;
	/** The one box round everything selected, which says its size. */
	frame: ScreenRect[];
	/** The outline under the pointer, a board's or an item's. */
	hover: Array<ScreenRect & { page: boolean }>;
	/** What an arrow's end would join, and the frame a drop would go into (`drop`). */
	joins: Array<ScreenRect & { drop: boolean }>;
	/** Where between a frame's children a drop would go. */
	insert: ScreenRect[];
	/** The snapping guides, each line as its bounding box. */
	guides: ScreenRect[];
};

let answer: (() => OverlayRects | undefined) | undefined;

/** The stage says how to work it out; called again by a stage that mounts after another unmounted. */
export function answerOverlayRects(how: (() => OverlayRects | undefined) | undefined) {
	answer = how;
	(globalThis as { __decksOverlayRects?: () => OverlayRects | undefined }).__decksOverlayRects = how;
}

export function overlayRects(): OverlayRects | undefined {
	return answer?.();
}
