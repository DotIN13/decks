/**
 * What a moving selection lines up with, and the box it moves as. The snapping maths itself is
 * `canvas/pen/snap.ts`; this decides what it snaps against.
 */
import { isArrow } from "@decks/pen";
import type { Rect } from "./model.ts";
import type { SceneQuery } from "./scene.ts";

/** Snapping reaches this many screen pixels, whatever the zoom. */
export const SNAP_PX = 6;

/**
 * The items around a selection and the boards, as far as `view` (the window, in stage pixels)
 * shows. Top-level items, and the siblings of an item inside a frame; never what is moving, the
 * inside of an instance, or an arrow, whose box is only where its line runs.
 */
export function snapTargets(scene: SceneQuery, ids: readonly string[], boards: readonly string[], view: Rect): Rect[] {
	const seen = (box: Rect) => box.x < view.x + view.w && box.x + box.w > view.x && box.y < view.y + view.h && box.y + box.h > view.y;
	const moving = new Set(ids);
	const parents = new Set(ids.map((id) => scene.item(id)?.parent).filter((id): id is string => !!id));
	const out: Rect[] = [];
	for (const placed of scene.items()) {
		const { node } = placed;
		if (moving.has(node.id) || node.id.includes("/") || isArrow(node)) continue;
		if (node.type === "browser" && node.metadata?.type === "decks.board") continue;
		if (placed.parent && !parents.has(placed.parent)) continue;
		const box = scene.box(node.id) ?? placed.box;
		if (seen(box)) out.push(box);
	}
	for (const board of scene.boards()) if (!boards.includes(board.path) && seen(board)) out.push({ x: board.x, y: board.y, w: board.w, h: board.h });
	return out;
}

/** The box round everything in a selection: items as drawn, boards as placed. */
export function selectionBox(scene: SceneQuery, ids: readonly string[], boards: readonly string[]): Rect | undefined {
	const boxes: Rect[] = [
		...ids.flatMap((id) => {
			const box = scene.box(id) ?? scene.item(id)?.box;
			return box ? [box] : [];
		}),
		...scene
			.boards()
			.filter((board) => boards.includes(board.path))
			.map((board) => ({ x: board.x, y: board.y, w: board.w, h: board.h })),
	];
	if (boxes.length === 0) return undefined;
	const x1 = Math.min(...boxes.map((box) => box.x));
	const y1 = Math.min(...boxes.map((box) => box.y));
	const x2 = Math.max(...boxes.map((box) => box.x + box.w));
	const y2 = Math.max(...boxes.map((box) => box.y + box.h));
	return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
