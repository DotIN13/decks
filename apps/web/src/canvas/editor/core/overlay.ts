/**
 * What the editor draws over the canvas, derived: the selection's outlines, the handles that size
 * an item or a board, the four places an arrow leaves from, an arrow's own handles, the corner
 * radius handle, the outline round what the pointer is over, a card block's grip, the frame a drag
 * would drop into and the line where, what an arrow's end would join, the snapping guides and the
 * drafts of what is being drawn.
 *
 * In stage pixels throughout. What is a screen size (a handle's width, a line's) is divided by the
 * zoom where it is drawn (`dom/OverlayLayer.tsx`), with the helpers at the bottom of this file.
 *
 * Each part is its own function, so the page can keep one memo per part and redraw only the part
 * whose inputs changed; `deriveOverlay` is all of them at once.
 */
import { ARROW, arrowRoute, isArrow, sidePoint, type ArrowSide, type PenNode } from "@decks/pen";
import type { Box, Guide } from "../../pen/snap.ts";
import { arrowHandles, type ArrowHandles, type RouteDraft } from "./arrows.ts";
import type { BoardBox, Pt, Rect } from "./model.ts";
import { childrenOf, marqueeRect, parentOf } from "./pick.ts";
import { HANDLES, radiusStart, type Handle, type RadiusStart } from "./resize.ts";
import type { SceneQuery } from "./scene.ts";

/** A move in progress, by how much. */
export type Offset = { dx: number; dy: number };
/** Two corners, as a drag has them. */
export type Corners = { x1: number; y1: number; x2: number; y2: number };

/**
 * One outline round something selected. `id` is the item's, `board:<path>` for a board, and empty
 * for the marquee: the page keys on these, so they are kept as they were.
 */
export type Outline = Rect & {
	id: string;
	role: "item" | "board" | "marquee";
	/** Notes and cards have a board's corners, and so does the outline round one. */
	round?: true;
};
/** The selected board's eight handles (six for a slide deck, sized by its width). */
export type BoardHandles = Outline & { path: string; slides: boolean };
/** The outline round what the pointer is over: an item (`id`) or a board (`board`). */
export type HoverBox = Rect & { id?: string; board?: true; round?: true };
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
/** A side an arrow end can keep to on what it would join, and the one it is near. */
export type SideHint = { box: Box; side?: ArrowSide };
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
	boardHandles?: BoardHandles;
	radius?: RadiusHandle;
	/** A radius being dragged, which the handle follows before the drawing does. */
	radiusDrag?: { id: string; radius: number };
	arrow?: ArrowHandles;
	hover?: HoverBox;
	/** The parents and children of the selection and of what is hovered. */
	kin: readonly KinBox[];
	selectionFrame?: SelectionFrame;
	grip?: GripBox;
	/** The grip is hidden, not taken away, while anything is carried or sized: it keeps the pointer it captured. */
	gripHidden: boolean;
	drop?: DropBox;
	/** Where in the frame the drop lands: a line along the boundary it would take. */
	insert?: Rect;
	joins: readonly Box[];
	sides: readonly SideHint[];
	guides: readonly Guide[];
	draft?: Draft;
	route?: RouteDraft;
	endDraft?: Corners;
};


export type OutlineInput = {
	selection: readonly string[];
	/** The item being typed into, which its editor outlines. */
	typing?: string | undefined;
	/** The selection's drag as the canvas shows it (nothing while the carried picture is on its way). */
	drag: Offset;
	/** An item being resized, as the sheet has drawn it. */
	resize?: (Rect & { id: string }) | undefined;
	boards: readonly BoardBox[];
	/** Boards picked up with the drawing (a marquee, Shift and a title bar). */
	boardPicks: readonly string[];
	/** Boards being dragged. */
	boardDrag?: { paths: readonly string[]; dx: number; dy: number } | undefined;
	/** A board moving itself, by a finger on its edge. */
	ownDrag?: { path: string; x: number; y: number } | undefined;
	/** The board the app has selected, and the one in the focus view. */
	selected?: string | undefined;
	focus?: string | undefined;
	/** A board being resized by its handles. */
	boardResize?: (Rect & { path: string }) | undefined;
	marquee?: Corners | undefined;
};

const rounded = (scene: SceneQuery, id: string): true | undefined => {
	const type = scene.item(id)?.node.type;
	return type === "note" || type === "prompt" || type === "context" ? true : undefined;
};
const outline = (id: string, role: Outline["role"], box: Rect, round?: true): Outline => ({ id, role, x: box.x, y: box.y, w: box.w, h: box.h, ...(round ? { round } : {}) });

/**
 * Where each selected item is now, moved by any drag and sized by any resize in progress; each
 * board picked up and the app's selected board; and the marquee. Never an arrow (its own two end
 * handles show it) or the item typed into. Only an item the sheet has drawn: its drawn box.
 */
export function selectionOutlines(input: OutlineInput, scene: SceneQuery): Outline[] {
	const out: Outline[] = [];
	const { drag } = input;
	for (const id of input.selection) {
		if (id === input.typing) continue;
		if (input.resize?.id === id) {
			out.push(outline(id, "item", input.resize, rounded(scene, id)));
			continue;
		}
		const item = scene.item(id)?.node;
		if (item && isArrow(item)) continue;
		const box = scene.drawn(id);
		if (box) out.push(outline(id, "item", { x: box.x + drag.dx, y: box.y + drag.dy, w: box.w, h: box.h }, rounded(scene, id)));
	}
	const moving = input.boardDrag;
	const carried = input.ownDrag;
	for (const path of input.boardPicks) {
		const board = input.boards.find((candidate) => candidate.path === path);
		if (!board) continue;
		const shift = moving?.paths.includes(path) ? moving : { dx: 0, dy: 0 };
		out.push(outline(`board:${path}`, "board", { x: board.x + shift.dx, y: board.y + shift.dy, w: board.w, h: board.h }));
	}
	// The board the app has selected, outlined as a drawn item is, so the two look alike at every zoom.
	const chosen = input.selected;
	const board = chosen && chosen !== input.focus && !input.boardPicks.includes(chosen) ? input.boards.find((candidate) => candidate.path === chosen) : undefined;
	if (board) {
		const sized = input.boardResize;
		const shift = moving?.paths.includes(board.path) ? moving : { dx: 0, dy: 0 };
		// Carried by a finger on its edge: outlined where the finger has it.
		const at = carried?.path === board.path ? carried : { x: board.x + shift.dx, y: board.y + shift.dy };
		out.push(outline(`board:${board.path}`, "board", sized?.path === board.path ? sized : { x: at.x, y: at.y, w: board.w, h: board.h }));
	}
	if (input.marquee) out.push(outline("", "marquee", marqueeRect(input.marquee)));
	return out;
}

/** One item selected, and not a joined arrow (which the server redraws) or a group: it gets handles. */
export function itemHandles(outlines: readonly Outline[], scene: SceneQuery): Outline | undefined {
	if (outlines.length !== 1 || outlines[0]!.role !== "item") return undefined;
	const node = scene.item(outlines[0]!.id)?.node;
	// A group is as big as what is in it, and pen does not scale children, so it moves but is not sized.
	if (!node || node.metadata?.type === ARROW || node.type === "group") return undefined;
	return outlines[0]!;
}

/** What the arrow anchors and the radius handle wait for: an edit allowed, and nothing being drawn, sized or carried. */
export type HandleInput = { editable: boolean; drafting: boolean; resizing: boolean; drag: Offset };

/** One drawn item selected, not a line or words, and nothing being drawn or sized: where an arrow can leave it. */
export function arrowAnchors(handles: Outline | undefined, input: Omit<HandleInput, "drag">, scene: SceneQuery): Outline | undefined {
	if (!handles || input.drafting || input.resizing || !input.editable) return undefined;
	const node = scene.item(handles.id)?.node;
	if (!node || node.type === "path" || node.type === "text") return undefined;
	return handles;
}

/**
 * The one selected item's corner radius, when it has corners to round (`resize.ts`, `radiusStart`):
 * not while it is sized or carried.
 */
export function radiusHandle(handles: Outline | undefined, input: Omit<HandleInput, "drafting">, scene: SceneQuery): RadiusHandle | undefined {
	if (!handles || input.resizing || input.drag.dx !== 0 || input.drag.dy !== 0 || !input.editable) return undefined;
	const node = scene.item(handles.id)?.node;
	return node ? radiusStart(node, handles) : undefined;
}

/** The selected board's box, when it alone is selected, can be resized, and is not being carried. */
export function boardHandles(outlines: readonly Outline[], input: { resizable: boolean; carrying: boolean; boards: readonly BoardBox[] }): BoardHandles | undefined {
	if (!input.resizable || input.carrying || outlines.length !== 1 || outlines[0]!.role !== "board") return undefined;
	const path = outlines[0]!.id.slice("board:".length);
	const board = input.boards.find((candidate) => candidate.path === path);
	if (!board) return undefined;
	return { ...outlines[0]!, path, slides: !!board.slides };
}

/** The two ends of the one selected arrow as drawn, and its middle, for the handles that pick them up. */
export function arrowEnds(input: { selection: readonly string[]; boardPicks: readonly string[]; drag: Offset }, scene: SceneQuery): ArrowHandles | undefined {
	if (input.selection.length !== 1 || input.boardPicks.length) return undefined;
	return arrowHandles(scene, input.selection[0]!, input.drag);
}

export type HoverInput = {
	/** Hover outlines are edit mode's. */
	editing: boolean;
	/** The item under the pointer. */
	item?: string | undefined;
	typing?: string | undefined;
	/** The board under the pointer. */
	board?: string | undefined;
	selected?: string | undefined;
	/** A board drag or a pan, which a board's hover outline waits out. */
	busy: boolean;
	boards: readonly BoardBox[];
};

/**
 * The hovered item's box as it is drawn now, or the board under the pointer. No box round an
 * arrow, the item typed into, or the board selected (it has its own outline).
 */
export function hoverBox(input: HoverInput, scene: SceneQuery): HoverBox | undefined {
	const id = input.item;
	if (!input.editing) return undefined;
	const hovered = id ? scene.item(id)?.node : undefined;
	const bounds = id && id !== input.typing && !(hovered && isArrow(hovered)) ? scene.drawn(id) : undefined;
	if (bounds) return { ...bounds, id, ...(rounded(scene, id!) ? { round: true as const } : {}) };
	const path = input.board;
	const board = path && path !== input.selected && !input.busy ? input.boards.find((candidate) => candidate.path === path) : undefined;
	return board ? { x: board.x, y: board.y, w: board.w, h: board.h, board: true } : undefined;
}

export type KinInput = {
	selection: readonly string[];
	/** The selection's drag as the canvas shows it: children are not outlined while it moves. */
	drag: Offset;
	resizing: boolean;
	typing?: string | undefined;
	/** Edit mode, which outlines what the pointer is over and its kin. */
	editing: boolean;
	/** The item under the pointer, and whether a gesture or a pan is in hand, which hover waits out. */
	hover?: string | undefined;
	busy: boolean;
};

/**
 * What the selection sits in and holds, and what the hovered item does: each selected item's
 * parents, all the way up, as light solid outlines; the one selected item's children, if it holds
 * any (a group's, a frame's), as light dashed ones, not while it moves or is sized. In edit mode,
 * the item under the pointer's parent, solid, and its children, dashed. Never what is selected
 * itself, the item typed into, or a board's blocks (a board draws its own).
 */
export function kinOutlines(input: KinInput, scene: SceneQuery): KinBox[] {
	const out: KinBox[] = [];
	const selected = new Set(input.selection);
	const seen = new Set<string>();
	const add = (id: string, kin: KinBox["kin"], of: KinBox["of"]) => {
		if (selected.has(id) || seen.has(id) || id === input.typing) return;
		const node = scene.item(id)?.node;
		if (node && isArrow(node)) return;
		const box = scene.drawn(id);
		if (!box) return;
		seen.add(id);
		out.push({ id, kin, of, x: box.x, y: box.y, w: box.w, h: box.h, ...(rounded(scene, id) ? { round: true as const } : {}) });
	};
	const moving = !!(input.drag.dx || input.drag.dy);
	if (!input.typing) {
		for (const id of input.selection) for (let up = parentOf(scene, id); up; up = parentOf(scene, up)) add(up, "parent", "selection");
		const one = input.selection.length === 1 ? input.selection[0]! : undefined;
		if (one && !moving && !input.resizing) for (const child of childrenOf(scene, one)) add(child, "child", "selection");
	}
	const over = input.hover;
	if (input.editing && over && !input.busy && !selected.has(over) && over !== input.typing) {
		const up = parentOf(scene, over);
		if (up) add(up, "parent", "hover");
		for (const child of childrenOf(scene, over)) add(child, "child", "hover");
	}
	return out;
}

/** The size a box is said to be: its width and height in stage pixels, rounded. */
export const sizeLabel = (box: { w: number; h: number }) => `${Math.round(box.w)} × ${Math.round(box.h)}`;

/**
 * One box round every selected item and board (not the marquee), and its size. None with nothing
 * outlined.
 */
export function selectionFrame(outlines: readonly Outline[]): SelectionFrame | undefined {
	const picked = outlines.filter((one) => one.role !== "marquee");
	if (!picked.length) return undefined;
	const x1 = Math.min(...picked.map((one) => one.x));
	const y1 = Math.min(...picked.map((one) => one.y));
	const x2 = Math.max(...picked.map((one) => one.x + one.w));
	const y2 = Math.max(...picked.map((one) => one.y + one.h));
	const box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
	return { ...box, many: picked.length > 1, label: sizeLabel(box) };
}

/**
 * Where the hovered block's grip goes, in edit mode: in the card's left margin, centred on the block's first
 * line as the layout sets it (`lineOf`, the page's measure: a heading's is taller than a paragraph's).
 */
export function gripBox(input: { block?: string | undefined; busy: boolean; editing: boolean }, scene: SceneQuery, lineOf: (id: string, node: PenNode) => { top: number; height: number }): GripBox | undefined {
	const id = input.block;
	// A grip answers the pointer before a press: edit mode's, as the hover outline is.
	if (!id || input.busy || !input.editing) return undefined;
	const box = scene.box(id);
	const node = scene.node(id);
	if (!box || !node) return undefined;
	const line = lineOf(id, node);
	return { id, x: box.x, y: box.y + line.top + line.height / 2 };
}

/** Where the frame a drag would drop into is, for the outline that says so. */
export function dropBox(into: string | null | undefined, scene: SceneQuery): DropBox | undefined {
	if (!into) return undefined;
	const box = scene.box(into);
	return box ? { ...box, id: into } : undefined;
}

/** Everything `deriveOverlay` reads: the parts' inputs, and what passes straight through. */
export type OverlayInput = OutlineInput &
	Omit<HandleInput, "drag"> &
	Omit<HoverInput, "item" | "board" | "busy" | "boards" | "selected" | "typing"> & {
		hoverItem?: string | undefined;
		hoverBoard?: string | undefined;
		panning: boolean;
		/** A press in hand: what is hovered is not outlined with its kin. */
		gesture?: boolean | undefined;
		/** The drag in hand, as the pointer has it (the radius handle hides for it at once). */
		pointerDrag: Offset;
		resizable: boolean;
		block?: string | undefined;
		lineOf: (id: string, node: PenNode) => { top: number; height: number };
		dropInto?: string | null | undefined;
		dropAt?: { line: Rect } | undefined;
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
	const handles = itemHandles(outlines, scene);
	const handleInput = { editable: input.editable, drafting: input.drafting, resizing: input.resizing, drag: input.pointerDrag };
	const busy = !!input.boardDrag || input.panning;
	const hover = hoverBox({ editing: input.editing, item: input.hoverItem, typing: input.typing, board: input.hoverBoard, selected: input.selected, busy, boards: input.boards }, scene);
	const grip = gripBox({ block: input.block, busy, editing: input.editing }, scene, input.lineOf);
	const kin = kinOutlines({ selection: input.selection, drag: input.drag, resizing: input.resizing, typing: input.typing, editing: input.editing, hover: input.hoverItem, busy: busy || !!input.gesture }, scene);
	return {
		outlines,
		kin,
		selectionFrame: selectionFrame(outlines),
		handles,
		anchors: arrowAnchors(handles, handleInput, scene),
		boardHandles: boardHandles(outlines, { resizable: input.resizable, carrying: !!input.boardDrag || !!input.ownDrag, boards: input.boards }),
		radius: radiusHandle(handles, handleInput, scene),
		radiusDrag: input.radiusDrag,
		arrow: arrowEnds(input, scene),
		hover,
		grip,
		gripHidden: gripHidden(input.pointerDrag, input.resizing),
		drop: dropBox(input.dropInto, scene),
		insert: input.dropAt?.line,
		joins: input.joins,
		sides: input.sides,
		guides: input.guides,
		draft: input.draft,
		route: input.route,
		endDraft: input.endDraft,
	};
}

/** The grip hides while anything is carried or sized. */
export const gripHidden = (drag: Offset, resizing: boolean) => !!(drag.dx || drag.dy || resizing);

/* ---- Where things sit, in stage pixels, with screen sizes divided by the zoom by the caller. ---- */

/** The handles a board has: all eight, or six for a slide deck, whose height follows its width. */
export const boardHandleList = (slides: boolean): readonly Handle[] => (slides ? HANDLES.filter((handle) => handle !== "n" && handle !== "s") : HANDLES);

/** The top-left corner of a `size`-wide handle centred on its edge or corner of `box`. */
export function handleAt(box: Rect, handle: Handle, size: number): Pt {
	return {
		x: box.x + (handle.includes("w") ? 0 : handle.includes("e") ? box.w : box.w / 2) - size / 2,
		y: box.y + (handle.includes("n") ? 0 : handle.includes("s") ? box.h : box.h / 2) - size / 2,
	};
}

/** The centre of the arrow anchor on `side`, `gap` out from the middle of that side. */
export function anchorAt(box: Rect, side: ArrowSide, gap: number): Pt {
	const [x, y] = sidePoint(box, side);
	const [nx, ny] = side === "top" ? [0, -1] : side === "bottom" ? [0, 1] : side === "left" ? [-1, 0] : [1, 0];
	return { x: x + nx * gap, y: y + ny * gap };
}

/** How far in from the corner the radius handle sits: clear of the corner handle, never past the middle. */
export const radiusInset = (radius: number, size: number, most: number) => Math.min(Math.max(radius, size), most);

/** The radius the handle shows: a drag's, while it is this item's, else the item's own. */
export const radiusShown = (handle: { id: string; radius: number }, dragged: { id: string; radius: number } | undefined) => (dragged?.id === handle.id ? dragged.radius : handle.radius);

/** The insert line as a box at least `thick` across, centred on the boundary. */
export function insertBox(line: Rect, thick: number): Rect {
	return {
		x: line.x - (line.w === 0 ? thick / 2 : 0),
		y: line.y - (line.h === 0 ? thick / 2 : 0),
		w: Math.max(line.w, thick),
		h: Math.max(line.h, thick),
	};
}

/** A box drawn corner to corner, whichever way. */
export const draftBox = (draft: Corners): Rect => marqueeRect(draft);

/** The path of an arrow being drawn, curved as the arrow it makes will be. */
export function draftCurve(draft: Corners): string {
	const points = arrowRoute({ x: draft.x1, y: draft.y1, w: 0, h: 0 }, { x: draft.x2, y: draft.y2, w: 0, h: 0 }, "curved");
	const [a, ...rest] = points;
	return points.length === 4 ? `M${a![0]} ${a![1]}C${rest.map((p) => `${p[0]} ${p[1]}`).join(" ")}` : `M${points.map((p) => `${p[0]} ${p[1]}`).join("L")}`;
}
