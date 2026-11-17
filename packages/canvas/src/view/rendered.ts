import type { Page, Camera } from "@decks/protocol";
import { createEffect, createMemo, createSelector, type Accessor } from "solid-js";
import { type Viewport } from "../camera/camera.ts";
import type { CanvasEngine } from "../render/engine.ts";
import type { CanvasEditor } from "../edit/dom/index.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";

/**
 * How many awake items may be put on layers of their own while the scale moves before it stops being a saving.
 *
 * A layer is a picture the compositor keeps and can stretch without waking the main
 * thread, and that trade is a good one until there are so many that compositing them
 * costs more than drawing them. It reverses, and it was measured rather than guessed —
 * 1400×900 at 4× CPU throttle, milliseconds of work per finger movement while pinching:
 *
 *     12 documents in view   56 on layers · 134 without
 *     40 documents in view  126 on layers · 181 without
 *    120 documents in view  700 on layers · 523 without   ← the trade has reversed
 *
 * Those documents were boards' iframes, which the canvas no longer runs. What goes on a layer now
 * is an awake card's root, a document's editor or an app's window (`canvas.css`, `data-scaling`),
 * a few elements each, and only those are counted: a board is its picture on the sheet and has no
 * layer to make. Measured on a canvas of 65 cards, all on screen below 25%, a ctrl-wheel zoom
 * across 2%–400% in headed Chrome: with the cards over the old 48 and so off layers, Chrome drew
 * every card again at every step and a third of the frames were late (97 of 300 over 16.7 ms,
 * p95 35 ms); on layers, 0–6 of 495, and a frame mid-zoom as sharp as at rest. 128 is twice what
 * was measured.
 */
const LAYER_BUDGET = 128;

/** What `createRendered` reads of `createItemsLayer` (`items-layer.tsx`), each read when it is used. */
export interface RenderedNeeds {
	readonly props: CanvasViewProps;
	readonly view: () => Viewport;
	readonly moving: Accessor<boolean>;
	readonly panning: Accessor<boolean>;
	readonly scaling: Accessor<boolean>;
	readonly gliding: Accessor<boolean>;
	readonly pageSlot: Accessor<Map<string, number>>;
	readonly editor: CanvasEditor;
	readonly liveCards: Accessor<ReadonlyMap<string, number>>;
	readonly livePaths: Accessor<ReadonlySet<string>>;
	readonly keptPaths: Accessor<ReadonlySet<string>>;
	readonly leavingPaths: Accessor<ReadonlySet<string>>;
	readonly penLayer: CanvasEngine;
	readonly cardsHidden: Accessor<boolean>;
	readonly isVisible: (board: Page) => boolean;
}

export function createRendered(d: RenderedNeeds) {
	/**
	 * The items that have a slot on the page at all: the awake ones (`items/awake.ts`: live, kept and
	 * leaving), the selected item, one being dragged or resized, and the sleeping item under the pointer,
	 * which gets its bar and edge band to move it by. A sleeping item is its picture on the sheet and
	 * nothing else, at any zoom, its title painted over it by the engine: 400 nodes cost a pan step 10 ms
	 * of the page's time, and each camera step reached every one. The stage finds the one under a press
	 * itself (`editor/dom/pointer.ts`, `pictureUnder`).
	 */
	const rendered = createMemo<readonly Page[]>((was) => {
		const boards = d.props.boards;
		if (d.view().width === 0) return was ?? [];
		/*
		 * Only at rest: a pan or a zoom keeps the nodes it started with, and the items it brings in are
		 * drawn by the sheet until it stops. Making a zoom's new nodes mid-pinch, title bars and all,
		 * held camera steps for up to 52 ms on an iPad mini.
		 */
		const moved = was !== undefined && (d.moving() || d.panning() || d.scaling() || d.gliding());
		const found = new Set(
			moved
				? was.flatMap((board) => {
						const at = d.pageSlot().get(board.path);
						return at === undefined ? [] : [at];
					})
				: [],
		);
		const keep = (path: string | undefined) => {
			const at = path === undefined ? undefined : d.pageSlot().get(path);
			if (at !== undefined) found.add(at);
		};
		// The sleeping item under the pointer: its bar and edge band, never mid-gesture.
		if (!moved) keep(d.editor.hoverPicture());
		for (const path of d.liveCards().keys()) keep(path);
		keep(d.props.selected);
		for (const path of d.livePaths()) keep(path);
		for (const path of d.keptPaths()) keep(path);
		for (const path of d.leavingPaths()) keep(path);
		for (const path of d.editor.heldPages()) keep(path);
		const next = [...found]
			.sort((a, b) => a - b)
			.map((at) => boards[at]!);
		// The same boards as last frame, which is nearly every frame of a pan: the same array, so nothing downstream runs.
		return was && was.length === next.length && next.every((board, i) => board === was[i]) ? was : next;
	});

	/** `rendered`, as a set to look a board up in. */
	const slotPaths = createMemo(() => new Set(rendered().map((board) => board.path)));

	/** Whether a board has a node: each board's slot is told only when its own answer changes. */
	const isRendered = createSelector(slotPaths, (path: string, paths) => paths.has(path));

	/**
	 * The items whose node takes a press: those in `rendered` but a kept card asleep, which is its picture
	 * on the sheet as any sleeping card is, so the stage finds it under a press itself (`pictureUnder`).
	 */
	const renderedPaths = createMemo<ReadonlySet<string>>(() => {
		const kept = d.keptPaths();
		return kept.size === 0 ? slotPaths() : new Set([...slotPaths()].filter((path) => !kept.has(path)));
	});

	// The engine writes click shapes only over cards with a node (`writeHits`): told the set as it changes.
	createEffect(() => d.penLayer.questions.setNodes(renderedPaths()));

	/** The awake items may go on layers while the scale moves: few enough of them near the window. Worked out once per change, not per read. */
	const layered = createMemo(() => d.scaling() && rendered().filter((board) => ((board.card && !d.cardsHidden()) || board.item) && d.isVisible(board)).length <= LAYER_BUDGET);

	/** The camera as of its last rest. */
	const restCamera = createMemo<Camera>((was) => (was !== undefined && (d.moving() || d.scaling() || d.panning() || d.gliding()) ? was : d.props.camera));

	return {
		renderedPaths,
		restCamera,
		isRendered,
		layered,
	};
}
