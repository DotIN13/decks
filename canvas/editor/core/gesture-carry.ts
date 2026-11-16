// Carrying the selection: its start, each move (snapping, dropping into frames, the composer), and the lift.
import { isCard, type Op } from "@decks/pen";
import { snapMove, type Guide } from "../snap.ts";
import { dropSlot, frameUnder, NEAR_PX, nearDrops } from "./drop.ts";
import { landingBoxes } from "../../items/glide.ts";
import type { PageBox, EditorState, Mods, Offset, Pt, Rect } from "./model.ts";
import { pageMoves, copyOps, moveOps, type PageMove } from "./ops.ts";
import type { SceneQuery } from "./scene.ts";
import { readingTargets, selectionBox, SNAP_PX, snapTargets } from "./snapping.ts";
import type { Carry, Effect, Gesture, GestureContext, PointerInput, Step, Tap } from "./gesture.ts";
import { PAGE_HOLD_MS, selectMade, SETTLE_MS, ZERO } from "./gesture-ground.ts";

export const isFree = (mods: Mods) => mods.meta || mods.ctrl;
export const done = (state: EditorState, effects: Effect[] = [], ops: Op[] = []): Step => ({ state, ops, effects });
/** Start carrying `ids` and `boards` from a press. The ghost's picture is cut now, before anything leaves the sheet. */
export function carry(state: EditorState, scene: SceneQuery, ctx: GestureContext, p: PointerInput, ids: readonly string[], boards: readonly string[], tap?: Tap, touch?: { from: { at: Pt; client: Pt } }): { state: EditorState; effect: Effect } {
	const gesture: Gesture = {
		kind: touch ? "move" : "press",
		ids,
		boards,
		start: selectionBox(scene, ids, boards),
		// A finger does not snap, so it never asks what is around.
		targets: touch ? [] : snapTargets(scene, ids, boards, ctx.view),
		reading: touch ? [] : readingTargets(scene, ids, boards, ctx.view),
		from: touch ? touch.from.at : p.at,
		fromClient: touch ? touch.from.client : p.client,
		...(touch ? { touch: true as const } : {}),
		...(tap ? { tap } : {}),
		offset: ZERO,
	};
	return { state: { ...state, gesture }, effect: { do: "ghost-take", ids } };
}
/** A move of the selection being carried by a mouse or a pen. */
export function moveCarry(state: EditorState, g: Carry, p: PointerInput, scene: SceneQuery, ctx: GestureContext): Step {
	const { ids, boards, start } = g;
	const now = p.at;
	let offset: Offset;
	let lines: Guide[] = [];
	let onto: string | null | undefined;
	let over: boolean;
	const effects: Effect[] = [];
	if (g.touch) {
		// A finger moves by as far as it has gone on the screen, and drops into what is under it.
		offset = { dx: (p.client.x - g.fromClient.x) / ctx.zoom, dy: (p.client.y - g.fromClient.y) / ctx.zoom };
		onto = frameUnder(scene, now, ids);
		const card = onto && isCard(scene.node(onto)) ? selectionBox(scene, ids, []) : undefined;
		if (card) {
			// A finger hides what is under it, so the ghost goes further from it than a pointer's does.
			const gap = 28 / ctx.zoom;
			offset = { dx: now.x + gap - card.x, dy: now.y + gap - card.y };
		}
		over = !!card;
		effects.push({ do: "ghost-show", over, client: p.client, gap: 28 });
	} else {
		let dx = now.x - g.from.x;
		let dy = now.y - g.from.y;
		// Shift keeps it to one axis.
		if (p.mods.shift) {
			if (Math.abs(dx) > Math.abs(dy)) dy = 0;
			else dx = 0;
		}
		// ⌘ or Ctrl turns snapping off.
		if (start && !isFree(p.mods)) {
			const snapped = snapMove({ ...start, x: start.x + dx, y: start.y + dy }, g.targets, SNAP_PX / ctx.zoom, g.reading);
			if (!p.mods.shift || dx !== 0) dx += snapped.dx;
			if (!p.mods.shift || dy !== 0) dy += snapped.dy;
			lines = snapped.guides;
		}
		offset = { dx, dy };
		/*
		 * What it would join, from the pointer rather than from the items: a selection has no one
		 * place, and the pointer is the thing the hand is aiming. ⌘ or Ctrl already means "ignore
		 * what is around me" during a drag, and keeping the parent is the same wish.
		 */
		onto = ids.length === 0 || isFree(p.mods) ? undefined : frameUnder(scene, now, ids);
		/*
		 * Over a card, what is carried rides below and right of the pointer, a ghost of itself, so
		 * the line where it will land between the card's blocks stays in view under the hand.
		 */
		over = !!onto && !!start && isCard(scene.node(onto));
		if (over) {
			const gap = 12 / ctx.zoom;
			offset = { dx: now.x + gap - start!.x, dy: now.y + gap - start!.y };
			lines = [];
		}
		effects.push({ do: "ghost-show", over, client: p.client, gap: 12 }, { do: "composer", client: p.client, ids, boards }, { do: "panned" });
	}
	const slot = onto ? dropSlot(scene, onto, now, ids) : undefined;
	/*
	 * The other places it could go, near the pointer: dashed, round the one it would take. Not for
	 * boards alone, which drop nowhere, nor with ⌘ or Ctrl, which keeps what is carried where it is.
	 */
	const near = ids.length && (g.touch || !isFree(p.mods)) ? nearDrops(scene, now, ids, NEAR_PX / ctx.zoom, { into: onto, line: slot?.line }) : undefined;
	const drop = { into: onto, slot, ...(near && (near.slots.length || near.frames.length) ? { near } : {}) };
	// A finger carries the boards picked up as they are now; a mouse the ones it picked up.
	const carried = g.touch ? state.selection.boards : boards;
	let next: EditorState = { ...state, gesture: { ...g, kind: "move", offset }, drop };
	if (!g.touch) next = { ...next, guides: lines };
	if (ids.length || g.touch) next = { ...next, drag: offset };
	if (carried.length) next = { ...next, pageDrag: { paths: carried, ...offset } };
	const preview = ids.length || g.touch ? new Map(ids.map((id) => [id, offset])) : undefined;
	return { state: next, ops: [], effects, ...(preview ? { preview } : {}) };
}
/** The lift of a carry. */
export function releaseCarry(state: EditorState, g: Gesture & Carry, p: PointerInput, scene: SceneQuery, ctx: GestureContext): Step {
	const { ids, boards, offset } = g;
	const effects: Effect[] = [{ do: "ghost-drop" }];
	let next: EditorState = { ...state, gesture: undefined };
	if (g.touch) {
		const into = state.drop.into;
		const slot = state.drop.slot?.index;
		next = { ...next, drop: {} };
		const ops = moveOps(scene, ids, offset.dx, offset.dy, into, slot);
		if (ids.length) next = settle(next, p.time, ctx, effects, landingBoxes(scene, ids, offset, into));
		const moves = pageMoves(scene.boards(), state.selection.boards, offset.dx, offset.dy);
		effects.push({ do: "move-boards", moves });
		return { state: holdPages(next, state.pageDrag, moves, p.time, effects), ops, effects };
	}
	const moved = g.kind === "move";
	const referring = moved && ctx.overComposer(p.client, ids, boards);
	effects.push({ do: "composer", ids, boards });
	next = { ...next, guides: [] };
	if (!moved) {
		next = { ...next, drop: {}, pageDrag: undefined };
		if (g.tap) effects.push(g.tap);
		return done(next, effects);
	}
	/*
	 * Dropped on the composer: the move is undone and the items are mentioned instead. Undone, not
	 * never started, because the preview is what makes the gesture legible: the note goes back.
	 */
	if (referring) {
		effects.push({ do: "refer", ids, boards });
		return { state: { ...next, drop: {}, drag: ZERO, pageDrag: undefined }, ops: [], preview: null, effects };
	}
	const into = state.drop.into;
	const slot = state.drop.slot?.index;
	next = { ...next, drop: {} };
	let ops: Op[];
	let preview: null | undefined;
	// Alt lets go of copies, and leaves the originals where they were.
	if (p.mods.alt && ids.length) {
		preview = null;
		const copied = copyOps(scene, ids, offset.dx, offset.dy, ctx.nextIds());
		ops = copied.ops;
		next = { ...next, drag: ZERO };
		if (copied.made.length) next = selectMade(next, copied.made);
	} else ops = moveOps(scene, ids, offset.dx, offset.dy, into, slot);
	if (ids.length && ops.length === 0) {
		// Nothing it carried can move (an arrow joined at both ends, `moveOps`): it goes back now, not after the wait for a drawing that will not change.
		preview = null;
		next = { ...next, drag: ZERO };
	} else if (ids.length) next = settle(next, p.time, ctx, effects, p.mods.alt ? undefined : landingBoxes(scene, ids, offset, into));
	// A copy lands where it was let go and moves nothing else: only a move glides.
	const moves = pageMoves(scene.boards(), boards, offset.dx, offset.dy);
	effects.push({ do: "move-boards", moves });
	next = holdPages(next, state.pageDrag, moves, p.time, effects);
	return { state: next, ops, effects, ...(preview === null ? { preview } : {}) };
}
/**
 * The pages a drag let go of stay where they were dropped until they are at the places the move asked
 * for (`landPageDrag`): until the server answers their boxes are the old ones. Let go of anyway after
 * `PAGE_HOLD_MS`, if the move is refused or lands elsewhere.
 */
function holdPages(state: EditorState, carried: EditorState["pageDrag"], moves: readonly PageMove[], time: number, effects: Effect[]): EditorState {
	const moving = moves.filter((move) => carried?.paths.includes(move.path));
	if (!carried || !moving.length) return { ...state, pageDrag: undefined };
	const until = time + PAGE_HOLD_MS;
	effects.push({ do: "wake", at: until });
	return { ...state, pageDrag: { paths: carried.paths, dx: carried.dx, dy: carried.dy, released: { to: moving, until } } };
}
/**
 * Boards let go of after a drag are put down once every one is where its move asked (the boards
 * as the host has them now), or is gone; a new drag replaces the hold.
 */
export function landPageDrag(state: EditorState, boards: readonly PageBox[]): EditorState {
	const held = state.pageDrag?.released;
	if (!held) return state;
	const landed = held.to.every((move) => {
		const board = boards.find((one) => one.path === move.path);
		return !board || (Math.abs(board.x - move.x) <= 1 && Math.abs(board.y - move.y) <= 1);
	});
	return landed ? { ...state, pageDrag: undefined } : state;
}
/** A gesture let go with its edit sent: the engine is told, and it waits for the drawing that answers it. */
export function settle(state: EditorState, time: number, ctx: GestureContext, effects: Effect[], landing?: ReadonlyMap<string, Rect>): EditorState {
	const until = time + SETTLE_MS;
	effects.push(landing?.size ? { do: "settle", landing } : { do: "settle" }, { do: "wake", at: until });
	return { ...state, settling: [...state.settling, { generation: ctx.generation, until }] };
}
