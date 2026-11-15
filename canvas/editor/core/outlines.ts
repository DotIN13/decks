import { arrowRoute, isArrow, type PenNode } from "@decks/pen";
import type { PageBox, Rect } from "./model.ts";
import { childrenOf, marqueeRect, parentOf } from "./pick.ts";
import type { SceneQuery } from "./scene.ts";
import { type Corners, type DropBox, type GripBox, type HoverBox, type KinBox, type Offset, type Outline, type SelectionFrame } from "./overlay.ts";

export type OutlineInput = {
	selection: readonly string[];
	/** The item being typed into, which its editor outlines. */
	typing?: string | undefined;
	/** The selection's drag as the canvas shows it (nothing while the carried picture is on its way). */
	drag: Offset;
	/** A drop's glide in hand: how far each gliding item is still drawn from where it lands (`glideShift`). */
	glide?: ReadonlyMap<string, Offset> | undefined;
	/** An item being resized, as the sheet has drawn it. */
	resize?: (Rect & { id: string }) | undefined;
	boards: readonly PageBox[];
	/** Boards picked up with the drawing (a marquee, Shift and a title bar). */
	pagePicks: readonly string[];
	/** Boards being dragged. */
	pageDrag?: { paths: readonly string[]; dx: number; dy: number } | undefined;
	/** A board moving itself, by a finger on its edge. */
	ownDrag?: { path: string; x: number; y: number } | undefined;
	/** The board the app has selected. */
	selected?: string | undefined;
	/** A board being resized by its handles. */
	pageResize?: (Rect & { path: string }) | undefined;
	marquee?: Corners | undefined;
};
const rounded = (scene: SceneQuery, id: string): true | undefined => {
	const type = scene.item(id)?.node.type;
	return type === "note" || type === "prompt" || type === "context" ? true : undefined;
};
const NO_SHIFT: Offset = { dx: 0, dy: 0 };
/**
 * How far a drop's glide (`glide.ts`, the engine runs it) still draws an item from where it lands:
 * its own shift, or that of the nearest parent that glides, which carries it. None with no glide.
 */
export function glideShift(glide: ReadonlyMap<string, Offset> | undefined, scene: SceneQuery, id: string): Offset {
	if (!glide?.size) return NO_SHIFT;
	for (let at: string | undefined = id; at; at = scene.item(at)?.parent) {
		const shift = glide.get(at);
		if (shift) return shift;
	}
	return NO_SHIFT;
}
const outline = (id: string, role: Outline["role"], box: Rect, round?: true, corner?: number): Outline => ({ id, role, x: box.x, y: box.y, w: box.w, h: box.h, ...(round ? { round } : {}), ...(corner !== undefined ? { corner } : {}) });
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
		// Moved by the drag in hand, or, once it is let go, by the glide into where it lands.
		const glide = glideShift(input.glide, scene, id);
		if (box) out.push(outline(id, "item", { x: box.x + drag.dx + glide.dx, y: box.y + drag.dy + glide.dy, w: box.w, h: box.h }, rounded(scene, id)));
	}
	const moving = input.pageDrag;
	const carried = input.ownDrag;
	for (const path of input.pagePicks) {
		const board = input.boards.find((candidate) => candidate.path === path);
		if (!board) continue;
		const shift = moving?.paths.includes(path) ? moving : { dx: 0, dy: 0 };
		out.push(outline(`page:${path}`, "page", { x: board.x + shift.dx, y: board.y + shift.dy, w: board.w, h: board.h }, undefined, board.corners?.[0]));
	}
	// The board the app has selected, outlined as a drawn item is, so the two look alike at every zoom.
	const chosen = input.selected;
	const board = chosen && !input.pagePicks.includes(chosen) ? input.boards.find((candidate) => candidate.path === chosen) : undefined;
	if (board) {
		const sized = input.pageResize;
		const shift = moving?.paths.includes(board.path) ? moving : { dx: 0, dy: 0 };
		// Carried by a finger on its edge: outlined where the finger has it.
		const at = carried?.path === board.path ? carried : { x: board.x + shift.dx, y: board.y + shift.dy };
		out.push(outline(`page:${board.path}`, "page", sized?.path === board.path ? sized : { x: at.x, y: at.y, w: board.w, h: board.h }, undefined, board.corners?.[0]));
	}
	if (input.marquee) out.push(outline("", "marquee", marqueeRect(input.marquee)));
	return out;
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
	boards: readonly PageBox[];
	/** A drop's glide in hand, which the hovered item's outline rides with. */
	glide?: ReadonlyMap<string, Offset> | undefined;
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
	const glide = id ? glideShift(input.glide, scene, id) : NO_SHIFT;
	if (bounds) return { ...bounds, x: bounds.x + glide.dx, y: bounds.y + glide.dy, id, ...(rounded(scene, id!) ? { round: true as const } : {}) };
	const path = input.board;
	const board = path && path !== input.selected && !input.busy ? input.boards.find((candidate) => candidate.path === path) : undefined;
	return board ? { x: board.x, y: board.y, w: board.w, h: board.h, board: true, ...(board.corners ? { corner: board.corners[0]! } : {}) } : undefined;
}
type KinInput = {
	selection: readonly string[];
	/** The selection's drag as the canvas shows it: children are not outlined while it moves. */
	drag: Offset;
	/** A drop's glide in hand: parents and children that glide are outlined where they are drawn. */
	glide?: ReadonlyMap<string, Offset> | undefined;
	resizing: boolean;
	typing?: string | undefined;
	/** Edit mode, which outlines what the pointer is over and its kin. */
	editing: boolean;
	/** The item under the pointer, and whether a gesture or a pan is in hand, which hover waits out. */
	hover?: string | undefined;
	busy: boolean;
};
/**
 * What the selection sits in and holds: each selected item's parents as light solid outlines, the one
 * selected item's children dashed (not while it moves or is sized); in edit mode, the hovered item's
 * parent and children the same way. Never the selection itself, the item typed into, or a page's blocks.
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
		const glide = glideShift(input.glide, scene, id);
		out.push({ id, kin, of, x: box.x + glide.dx, y: box.y + glide.dy, w: box.w, h: box.h, ...(rounded(scene, id) ? { round: true as const } : {}) });
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
 * Where the hovered block's grip goes, in either mode: in the card's left margin, centred on the block's first
 * line as the layout sets it (`lineOf`, the page's measure: a heading's is taller than a paragraph's).
 */
export function gripBox(input: { block?: string | undefined; busy: boolean; editing: boolean }, scene: SceneQuery, lineOf: (id: string, node: PenNode) => { top: number; height: number }): GripBox | undefined {
	const id = input.block;
	// Shown browsing too: a card's blocks are drawn items, and drawn items drag in both modes.
	if (!id || input.busy) return undefined;
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
/** The grip hides while anything is carried or sized. */
export const gripHidden = (drag: Offset, resizing: boolean) => !!(drag.dx || drag.dy || resizing);
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
