// Everything the editor draws over the canvas, as one value: its parts' types and `deriveOverlay`,
// which puts together the outlines, handles and distances from their own files.
import { type ArrowSide, type PenNode } from "@decks/pen";
import type { Box, Guide } from "../snap.ts";
import { type ArrowHandles, type RouteDraft } from "./arrows.ts";
import type { Rect } from "./model.ts";
import { type RadiusStart } from "./resize.ts";
import type { SceneQuery } from "./scene.ts";
import { type HoverInput, type OutlineInput, dropBox, gripBox, gripHidden, hoverBox, kinOutlines, selectionFrame, selectionOutlines } from "./outlines.ts";
import { type HandleInput, arrowAnchors, arrowEnds, itemHandles, pageHandles, radiusHandle } from "./handles.ts";
import { distances } from "./measure.ts";
export { type OutlineInput, glideShift, selectionOutlines, hoverBox, kinOutlines, sizeLabel, selectionFrame, gripBox, dropBox, gripHidden, insertBox, draftBox, draftCurve } from "./outlines.ts";
export { itemHandles, arrowAnchors, radiusHandle, pageHandles, arrowEnds, pageHandleList, HANDLE_HIT_PX, hitReach, handleAt, anchorAt, radiusInset, radiusShown } from "./handles.ts";
export { measure, distances } from "./measure.ts";

/** A move in progress, by how much. */
export type Offset = { dx: number; dy: number };
/** Two corners, as a drag has them. */
export type Corners = { x1: number; y1: number; x2: number; y2: number };
/**
 * One outline round something selected. `id` is the item's, `page:<path>` for a card, board, document or app, and empty
 * for the marquee: the page keys on these, so they are kept as they were.
 */
export type Outline = Rect & {
	id: string;
	role: "item" | "page" | "marquee";
	/** Notes and cards have a board's corners, and so does the outline round one. */
	round?: true;
	/** A card's own corner (`PageBox.corners`), which its outline follows rather than a board's. */
	corner?: number;
};
/** The selected board's eight handles. */
export type PageHandles = Outline & { path: string };
/** The outline round what the pointer is over: an item (`id`) or a board (`board`). */
export type HoverBox = Rect & { id?: string; board?: true; round?: true; corner?: number };
/** Where a card block's grip goes: level with the middle of the block's first line, at its left edge. */
export type GripBox = { id: string; x: number; y: number };
/** The frame a drag would drop into. */
export type DropBox = Rect & { id: string };
/**
 * What the selection, or the item under the pointer, sits in and holds: a light solid outline
 * round each parent, a light dashed one round each child.
 */
export type KinBox = Rect & { id: string; kin: "parent" | "child"; of: "selection" | "hover"; round?: true };
/**
 * One box round everything selected and its size under it, in stage pixels rounded (`"120 × 36"`).
 * `many` when more than one thing is selected: each is outlined thin, and this box is the strong one.
 */
export type SelectionFrame = Rect & { many: boolean; label: string };
/** One red line of the distances Alt shows, and the pixels it measures at its middle; `dashed` carries an edge out to meet it. */
export type MeasureLine = { x1: number; y1: number; x2: number; y2: number; label?: string; dashed?: true };
/** What Alt shows between the selection and the item under the pointer: both boxes, and the lines between. */
export type Distances = { from: Rect; to: Rect; lines: MeasureLine[] };
/** A side an arrow end can keep to on what it would join, and the one it is near. */
type SideHint = { box: Box; side?: ArrowSide };
/** A shape being drawn with a tool, corner to corner. */
export type Draft = Corners & { tool: string };
/** The corner radius handle: the box, the radius now, the most it can be. */
export type RadiusHandle = Outline & RadiusStart;
/** Everything drawn over the canvas. */
export type Overlay = {
	outlines: Outline[];
	/** One item that can be sized: its eight handles. */
	handles?: Outline;
	/** The four places an arrow can leave the one selected item from. */
	anchors?: Outline;
	pageHandles?: PageHandles;
	radius?: RadiusHandle;
	/** A radius being dragged, which the handle follows before the drawing does. */
	radiusDrag?: { id: string; radius: number };
	arrow?: ArrowHandles;
	hover?: HoverBox;
	/** The parents and children of the selection and of what is hovered. */
	kin: readonly KinBox[];
	selectionFrame?: SelectionFrame;
	/** Alt held over another item, in edit mode, with something selected. */
	distances?: Distances;
	grip?: GripBox;
	/** The grip is hidden, not taken away, while anything is carried or sized: it keeps the pointer it captured. */
	gripHidden: boolean;
	drop?: DropBox;
	/** Where in the frame the drop lands: a line along the boundary it would take. */
	insert?: Rect;
	/**
	 * The other places a drag could land near the pointer (`drop.ts`, `nearDrops`): slot lines in
	 * frames that arrange their children, and frames that do not, both dashed.
	 */
	slots: readonly Rect[];
	slotFrames: readonly Rect[];
	joins: readonly Box[];
	sides: readonly SideHint[];
	guides: readonly Guide[];
	draft?: Draft;
	route?: RouteDraft;
	endDraft?: Corners;
};
/** Everything `deriveOverlay` reads: the parts' inputs, and what passes straight through. */
export type OverlayInput = OutlineInput &
	Omit<HandleInput, "drag"> &
	Omit<HoverInput, "item" | "board" | "busy" | "boards" | "selected" | "typing"> & {
		hoverItem?: string | undefined;
		hoverPage?: string | undefined;
		panning: boolean;
		/** The camera's zoom: handles hide on a box too small on the screen to wear them. */
		zoom?: number | undefined;
		/** A press in hand: what is hovered is not outlined with its kin, nor measured to. */
		gesture?: boolean | undefined;
		/** Alt is held: the distances from the selection to what is hovered. */
		alt?: boolean | undefined;
		/** The drag in hand, as the pointer has it (the radius handle hides for it at once). */
		pointerDrag: Offset;
		resizable: boolean;
		block?: string | undefined;
		lineOf: (id: string, node: PenNode) => { top: number; height: number };
		dropInto?: string | null | undefined;
		dropAt?: { line: Rect } | undefined;
		dropNear?: { slots: readonly Rect[]; frames: readonly Rect[] } | undefined;
		radiusDrag?: { id: string; radius: number } | undefined;
		joins: readonly Box[];
		sides: readonly SideHint[];
		guides: readonly Guide[];
		draft?: Draft | undefined;
		route?: RouteDraft | undefined;
		endDraft?: Corners | undefined;
	};
/** Everything drawn over the canvas, from the editor's state and the scene. */
export function deriveOverlay(input: OverlayInput, scene: SceneQuery): Overlay {
	const outlines = selectionOutlines(input, scene);
	const handles = itemHandles(outlines, scene, input.zoom);
	const handleInput = { editable: input.editable, drafting: input.drafting, resizing: input.resizing, drag: input.pointerDrag };
	const busy = !!input.pageDrag || input.panning;
	const hover = hoverBox({ editing: input.editing, item: input.hoverItem, typing: input.typing, board: input.hoverPage, selected: input.selected, busy, boards: input.boards, glide: input.glide }, scene);
	const grip = gripBox({ block: input.block, busy, editing: input.editing }, scene, input.lineOf);
	const kin = kinOutlines({ selection: input.selection, drag: input.drag, glide: input.glide, resizing: input.resizing, typing: input.typing, editing: input.editing, hover: input.hoverItem, busy: busy || !!input.gesture }, scene);
	const frame = selectionFrame(outlines);
	return {
		outlines,
		kin,
		selectionFrame: frame,
		distances: distances({ editing: input.editing, alt: !!input.alt, busy: busy || !!input.gesture || !!input.marquee, selection: frame, over: hover }),
		handles,
		anchors: arrowAnchors(handles, handleInput, scene),
		pageHandles: pageHandles(outlines, { resizable: input.resizable, carrying: !!input.pageDrag || !!input.ownDrag, boards: input.boards, zoom: input.zoom }),
		radius: radiusHandle(handles, handleInput, scene),
		radiusDrag: input.radiusDrag,
		arrow: arrowEnds(input, scene),
		hover,
		grip,
		gripHidden: gripHidden(input.pointerDrag, input.resizing),
		drop: dropBox(input.dropInto, scene),
		insert: input.dropAt?.line,
		slots: input.dropNear?.slots ?? [],
		slotFrames: input.dropNear?.frames ?? [],
		joins: input.joins,
		sides: input.sides,
		guides: input.guides,
		draft: input.draft,
		route: input.route,
		endDraft: input.endDraft,
	};
}
