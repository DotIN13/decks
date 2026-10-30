/**
 * What a press, a hover or a marquee picks. The engine says what is under a point (`under`,
 * `onLine`); this decides which of it the editor means.
 */
import { isCard, isMarkdownText, isShape, type PenNode, type Placed } from "@decks/pen";
import { isFile, isLiveFile } from "../../model/file-kinds.ts";
import type { BoardBox, Pt, Rect } from "./model.ts";
import type { SceneQuery } from "./scene.ts";

/**
 * How far up a press climbs from the item it hit.
 *
 * `"exact"`, the default: what is under the pointer, the deepest item there. An item in a group or
 * a frame is picked itself; the group's own empty space, between what it holds, picks the group,
 * and a frame's padding the frame (it is hit there). Only what is one thing made of parts is
 * climbed to: a shape, a file or a live file, and the card round a block of markdown.
 *
 * `"outermost"`: as `"exact"`, and on to the outermost group round it, the way some design tools
 * select a group whole. A group's empty space is nothing. What an arrow's end joins still asks this.
 */
export type PickPolicy = "exact" | "outermost";

export type PickOptions = {
	/** `"exact"` unless said. */
	policy?: PickPolicy;
	/** The item itself, with no climb: a double-click reaching inside a group. */
	deep?: boolean;
	/** Items to look through, as if they were not there. */
	skip?: (node: PenNode) => boolean;
};

/** What a press found: the item, its node, and the box it covers (a copy). */
export type Picked = { id: string; node: PenNode; box: Rect };

const isBoard = (node: PenNode) => node.type === "browser" && ["decks.board", "decks.card", "decks.document", "decks.app"].includes(String(node.metadata?.type));
const contains = (box: Rect, point: Pt) => point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;

/**
 * The topmost item a press at a point lands on. Never an item inside an instance, a group itself
 * or a board. The press's reach is for lines: anything else is hit only inside what it draws, so
 * of two close shapes the nearer one wins.
 */
function topAt(scene: SceneQuery, point: Pt, skip?: (node: PenNode) => boolean): Placed | undefined {
	for (const id of scene.under(point)) {
		const placed = scene.item(id);
		if (!placed) continue;
		const { node } = placed;
		if (node.id.includes("/") || node.type === "group") continue;
		if (isBoard(node)) continue;
		if (skip?.(node)) continue;
		if (node.type === "path") {
			if (scene.onLine(id, point) === false) continue;
		} else if (!contains(scene.box(id) ?? placed.box, point)) continue;
		return placed;
	}
	return undefined;
}

/** One thing made of parts: a press on a part picks it whole (a card, only from its markdown). */
const isWhole = (up: PenNode, hit: PenNode) => isShape(up) || isFile(up) || isLiveFile(up) || (isCard(up) && isMarkdownText(hit));
/** Whether a press on `hit` climbs to `up`, one of the parents round it, under a policy. */
const climbsTo = (policy: PickPolicy, up: PenNode, hit: PenNode) => (policy === "outermost" && up.type === "group") || isWhole(up, hit);

/**
 * The topmost group whose box holds the point and that is drawn over `above` (its order), if any:
 * a press in its empty space, between what it holds. The engine never finds a group under a point
 * (a group draws nothing of its own), so the groups are looked through here.
 */
function groupGapAt(scene: SceneQuery, point: Pt, above: number, skip?: (node: PenNode) => boolean): Placed | undefined {
	let top: Placed | undefined;
	for (const placed of scene.items()) {
		const { node } = placed;
		if (node.type !== "group" || node.id.includes("/") || placed.order <= above || (top && placed.order < top.order)) continue;
		if (skip?.(node)) continue;
		if (contains(scene.box(node.id) ?? placed.box, point)) top = placed;
	}
	return top;
}

/** The item a press at a stage point picks. Boards are not found here, and an item inside an instance is found as the instance. */
export function pickAt(scene: SceneQuery, point: Pt, options: PickOptions = {}): Picked | undefined {
	const policy = options.policy ?? "exact";
	let best = topAt(scene, point, options.skip);
	// "exact": a group drawn over what was hit, with the point in its empty space, is what the press is on.
	if (policy === "exact") best = groupGapAt(scene, point, best?.order ?? -1, options.skip) ?? best;
	if (!best) return undefined;
	if (!options.deep) {
		// Every qualifying parent on the way up, the last one winning.
		const hit = best.node;
		for (let up = best.parent ? scene.item(best.parent) : undefined; up; up = up.parent ? scene.item(up.parent) : undefined) if (climbsTo(policy, up.node, hit)) best = up;
	}
	return { id: best.node.id, node: best.node, box: { ...(scene.box(best.node.id) ?? best.box) } };
}

/** The node an item sits in that the editor can select: not a board, not inside an instance. */
export function parentOf(scene: SceneQuery, id: string): string | undefined {
	const up = scene.item(id)?.parent;
	const node = up ? scene.item(up)?.node : undefined;
	return node && !isBoard(node) && !node.id.includes("/") ? node.id : undefined;
}

/**
 * What an item holds that the editor can select one by one: a group's or a frame's children. Not
 * the parts of what is one thing (a shape, a file, a live file, a card), and nothing in an instance.
 */
export function childrenOf(scene: SceneQuery, id: string): string[] {
	const node = scene.item(id)?.node ?? scene.node(id);
	if (!node || id.includes("/") || isBoard(node) || isShape(node) || isFile(node) || isLiveFile(node) || isCard(node)) return [];
	if (node.type !== "group" && node.type !== "frame") return [];
	return (scene.node(id)?.children ?? node.children ?? []).map((child) => child.id).filter((child) => !child.includes("/") && !!scene.item(child));
}

/**
 * The text block of a card at a stage point: the one under it, or in the card's margin, the one
 * level with it (4 px either side). Not in the card open for typing (`typing`), which has its own
 * way of moving things.
 */
export function blockAt(scene: SceneQuery, point: Pt, typing?: string): string | undefined {
	const deep = pickAt(scene, point, { deep: true });
	if (!deep) return undefined;
	const up = scene.parent(deep.id);
	const card = isCard(deep.node) ? deep.node : up && isCard(up) ? up : undefined;
	if (!card || typing === card.id) return undefined;
	if (deep.node.id !== card.id) return isMarkdownText(deep.node) ? deep.id : undefined;
	return (card.children ?? []).find((child) => {
		const box = isMarkdownText(child) ? scene.box(child.id) : undefined;
		return box && point.y >= box.y - 4 && point.y <= box.y + box.h + 4;
	})?.id;
}

/**
 * The board whose picture is under a point and that has no node of its own to take the press:
 * one not in `rendered`. The last in file order, as the sheet draws it on top.
 * `boards` may be only the candidates a spatial index found near the point, as long as they keep file order.
 */
export function pictureAt(boards: readonly BoardBox[], point: Pt, rendered: ReadonlySet<string>): string | undefined {
	let top: string | undefined;
	for (const board of boards) {
		if (rendered.has(board.path)) continue;
		if (contains(board, point)) top = board.path;
	}
	return top;
}

/** The rectangle a marquee dragged between two corners covers. */
export const marqueeRect = (m: { x1: number; y1: number; x2: number; y2: number }): Rect => ({ x: Math.min(m.x1, m.x2), y: Math.min(m.y1, m.y2), w: Math.abs(m.x2 - m.x1), h: Math.abs(m.y2 - m.y1) });

const wholly = (box: Rect, r: Rect) => box.x >= r.x && box.y >= r.y && box.x + box.w <= r.x + r.w && box.y + box.h <= r.y + r.h;

/**
 * Every item and board wholly inside a stage rectangle: a marquee. Never an instance's inside, a
 * board's own node, or a part of a shape; an item whose parent is picked too is left to its parent.
 */
export function marqueePick(scene: SceneQuery, r: Rect): { items: string[]; boards: string[] } {
	const inside = new Set<string>();
	for (const placed of scene.items()) {
		const { node } = placed;
		const id = node.id;
		if (id.includes("/") || isBoard(node)) continue;
		if (placed.parent && isShape(scene.item(placed.parent)?.node)) continue;
		if (wholly(scene.box(id) ?? placed.box, r)) inside.add(id);
	}
	const items = [...inside].filter((id) => {
		for (let parent = scene.item(id)?.parent; parent; parent = scene.item(parent)?.parent) if (inside.has(parent)) return false;
		return true;
	});
	return { items, boards: scene.boards().filter((board) => wholly(board, r)).map((board) => board.path) };
}
