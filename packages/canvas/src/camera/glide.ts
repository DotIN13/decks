/**
 * A drop eases in. What a drag let go of glides from where the pointer left it to where it lands,
 * and whatever the layout moved to make room (or to close the gap it left) glides there too: 150 ms,
 * ease-out. The maths is here; the engine runs it at the drawing that answers the drop
 * (`stage/engine.ts`, `settle`), so nothing is drawn where it lands before it has glided there.
 */
import type { Offset, Rect } from "../edit/core/model.ts";
import type { SceneQuery } from "../edit/core/scene.ts";

/** How long a landing glides for. */
export const GLIDE_MS = 150;

/** Ease-out, cubic: fast from where it was let go, slow into where it lands. */
export const easeOut = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

/**
 * Where everything a drop can move is as it is let go: each carried item where the drag has it,
 * and every other child of each frame it leaves or joins, and of each frame those sit in, up to
 * the top, where they are now. Drawn boxes, in stage pixels.
 */
export function landingBoxes(scene: SceneQuery, ids: readonly string[], offset: Offset, into: string | null | undefined): Map<string, Rect> {
	const out = new Map<string, Rect>();
	const boxOf = (id: string) => scene.box(id) ?? scene.item(id)?.box;
	const carried = new Set(ids);
	const holders = new Set<string>();
	for (const id of [...ids.map((one) => scene.item(one)?.parent), into ?? undefined]) {
		for (let up = id; up; up = scene.item(up)?.parent) holders.add(up);
	}
	for (const holder of holders) {
		for (const child of scene.node(holder)?.children ?? []) {
			if (carried.has(child.id)) continue;
			const box = boxOf(child.id);
			if (box) out.set(child.id, box);
		}
	}
	for (const id of ids) {
		const box = boxOf(id);
		if (box) out.set(id, { x: box.x + offset.dx, y: box.y + offset.dy, w: box.w, h: box.h });
	}
	return out;
}

/**
 * How far each item has to glide, from where it was let go (`before`) to where the drawing that
 * answers the drop has it (`after`): only what moved by more than half a pixel, and only the
 * outermost of what moved, since an item carries its children with it.
 */
export function glideShifts(before: ReadonlyMap<string, Rect>, after: (id: string) => Rect | undefined, parent: (id: string) => string | undefined): Map<string, Offset> {
	const moved = new Map<string, Offset>();
	for (const [id, was] of before) {
		const now = after(id);
		if (!now) continue;
		const dx = was.x - now.x;
		const dy = was.y - now.y;
		if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moved.set(id, { dx, dy });
	}
	for (const id of [...moved.keys()]) {
		for (let up = parent(id); up; up = parent(up)) {
			if (moved.has(up)) {
				moved.delete(id);
				break;
			}
		}
	}
	return moved;
}

/** Each item's offset from where it lands, `elapsed` ms into the glide: all of its shift at 0, none at `GLIDE_MS`. */
export function glideAt(shifts: ReadonlyMap<string, Offset>, elapsed: number): Map<string, Offset> {
	const left = 1 - easeOut(elapsed / GLIDE_MS);
	return new Map([...shifts].map(([id, shift]) => [id, { dx: shift.dx * left, dy: shift.dy * left }]));
}
