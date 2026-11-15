import { arrowOp, bendAt, bendStart, droppedEnd, joinAt, resetBendOp, resetEndOp, routeDraft, slideJoin, withEnd } from "./arrows.ts";
import type { PageBox, EditorState, ResizeBox } from "./model.ts";
import { marqueePick, marqueeRect } from "./pick.ts";
import { pageResizeEnd, pageResizeStep, shownPageResize, givenFor, hugAgainOp, keepsWords, radiusAt, radiusOp, resizeOp, resizePreview, resizeStep, sizeFloor, sizeNarrowest } from "./resize.ts";
import type { PreviewChange, SceneQuery } from "./scene.ts";
import { SNAP_PX, snapTargets } from "./snapping.ts";
import { type Effect, type GestureContext, HANDLE_TAP_MS, type Input, PAGE_HOLD_MS, type PointerInput, RADIUS_HOLD_MS, type Step, ZERO, step } from "./gesture.ts";
import { done, isFree, moveCarry, releaseCarry, settle } from "./gesture-carry.ts";
import { withSelection } from "./gesture-press.ts";

/**
 * A board size let go is let go of once the board is at it: the write's revision has come (or the
 * board is exactly the box already) and the board is where the box is, as wide, and at least as
 * tall, since a board's height is a floor its content can raise. A board gone lets it go too.
 */
export function landPageResize(state: EditorState, board: (PageBox & { rev: number }) | undefined): EditorState {
	const held = state.pageResize;
	if (!held?.released) return state;
	if (!board) return { ...state, pageResize: undefined };
	const at = board.x === held.x && board.y === held.y && board.w === held.w;
	if (board.rev === held.released.rev && !(at && board.h === held.h)) return state;
	return at && board.h >= held.h ? { ...state, pageResize: undefined } : state;
}
/** A second press on the same handle, without a drag, soon after: a handle's double-click. */
function handleTap(state: EditorState, key: string, time: number): { state: EditorState; again: boolean } {
	const was = state.handleTap;
	const again = was?.key === key && time - was.at < HANDLE_TAP_MS;
	return { state: { ...state, handleTap: again ? undefined : { key, at: time } }, again };
}
/** The drag's offset and the resized outline gone: the drawing has the change, or has given up waiting. */
export const landed = (state: EditorState): EditorState => ({ ...state, drag: ZERO, resize: undefined, shownResize: undefined });
/** A press that starts a gesture on something the overlay drew: a handle, the radius, an arrow's end or middle. */
export function pressHandle(state: EditorState, input: Input & PointerInput, scene: SceneQuery, ctx: GestureContext): Step | undefined {
	switch (input.type) {
		case "press-handle": {
			const { id } = input.box;
			const start = { x: input.box.x, y: input.box.y, w: input.box.w, h: input.box.h };
			const node = scene.item(id)?.node;
			const placed = scene.item(id)?.box;
			return done({
				...state,
				gesture: {
					kind: "resize",
					id,
					handle: input.handle,
					start,
					given: placed ? { x: placed.x, y: placed.y, w: placed.w, h: placed.h } : start,
					// A card as tall as its words stays that while only its sides are dragged.
					words: keepsWords(node, input.handle),
					floor: sizeFloor(node),
					narrowest: sizeNarrowest(node),
					targets: snapTargets(scene, [id], [], ctx.view),
					from: input.at,
					next: start,
					moved: false,
				},
			});
		}
		case "press-board-handle": {
			const { path } = input.box;
			const start = { x: input.box.x, y: input.box.y, w: input.box.w, h: input.box.h };
			const least = scene.boards().find((board) => board.path === path)?.least;
			return done({ ...state, gesture: { kind: "pageResize", path, handle: input.handle, least, start, targets: snapTargets(scene, [], [path], ctx.view), from: input.at, next: start, moved: false } });
		}
		case "press-radius":
			return done({ ...state, gesture: { kind: "radius", start: input.handle, radius: input.handle.radius, moved: false } });
		case "press-arrow-end": {
			const { ends, which } = input;
			const node = scene.node(ends.id);
			if (!node?.metadata) return undefined;
			return done({
				...state,
				gesture: { kind: "arrowEnd", id: ends.id, which, node, metadata: node.metadata as Record<string, unknown>, stays: which === "from" ? ends.to : ends.from, own: which === "from" ? ends.fromJoin : ends.toJoin, moved: false },
			});
		}
		case "press-arrow-bend": {
			const { ends } = input;
			if (!ends.middle) return undefined;
			const node = scene.node(ends.id);
			if (!node?.metadata) return undefined;
			const start = bendStart(scene, node.metadata as Record<string, unknown>);
			if (!start) return undefined;
			return done({ ...state, gesture: { kind: "arrowBend", id: ends.id, node, route: ends.route, start, moved: false } });
		}
		default:
			return undefined;
	}
}
/** A move of the pointer, for the gesture in hand. */
export function move(state: EditorState, p: PointerInput, scene: SceneQuery, ctx: GestureContext): Step {
	const g = state.gesture;
	if (!g) return done(state);
	switch (g.kind) {
		case "press":
		case "move":
			return moveCarry(state, g, p, scene, ctx);
		case "marquee": {
			const m = { x1: g.from.x, y1: g.from.y, x2: p.at.x, y2: p.at.y };
			const picked = marqueePick(scene, marqueeRect(m));
			const next = withSelection(state, { items: [...new Set([...g.kept.items, ...picked.items])], boards: [...new Set([...g.kept.boards, ...picked.boards])] });
			return done({ ...next, marquee: m }, [{ do: "panned" }]);
		}
		case "resize": {
			const step = resizeStep(g.start, g.handle, { x: p.at.x - g.from.x, y: p.at.y - g.from.y }, { shift: p.mods.shift, free: isFree(p.mods) }, { targets: g.targets, threshold: SNAP_PX / ctx.zoom, floor: g.floor, narrowest: g.narrowest });
			const box = givenFor(g.start, g.given, step.box);
			const resize: ResizeBox = { id: g.id, ...step.box, given: { x: box.x, y: box.y } };
			return {
				state: { ...state, guides: step.guides, resize, gesture: { ...g, next: step.box, moved: true } },
				ops: [],
				preview: new Map<string, PreviewChange>([[g.id, resizePreview(g.given, box, g.words)]]),
				effects: [{ do: "await-frame", resize }],
			};
		}
		case "pageResize": {
			const step = pageResizeStep(g.start, g.handle, { x: p.at.x - g.from.x, y: p.at.y - g.from.y }, { shift: p.mods.shift, free: isFree(p.mods) }, { targets: g.targets, threshold: SNAP_PX / ctx.zoom });
			// The drag's height is written; a document is shown no shorter than its content.
			return done({ ...state, guides: step.guides, pageResize: { path: g.path, ...shownPageResize(step.box, g.least) }, gesture: { ...g, next: step.box, moved: true } });
		}
		case "radius": {
			// Along the diagonal from the corner (`resize.ts`, `radiusAt`).
			const radius = radiusAt(g.start, p.at);
			return { state: { ...state, radius: { id: g.start.id, radius }, gesture: { ...g, radius, moved: true } }, ops: [], preview: new Map<string, PreviewChange>([[g.start.id, { dx: 0, dy: 0, radius }]]), effects: [] };
		}
		case "arrowEnd": {
			// Along the side the end joins, the drag slides the join; away from it, it picks the end up.
			const slid = slideJoin(g.own, p.at, { zoom: ctx.zoom, free: p.mods.alt });
			const gesture = { ...g, slid, moved: true };
			if (slid) {
				const draft = routeDraft(scene, withEnd(g.metadata, g.which, slid), g.node);
				return done({ ...state, gesture, endDraft: undefined, joins: [g.own!.box], sides: [], route: draft });
			}
			const join = joinAt(scene, p.at, { zoom: ctx.zoom, not: g.id });
			const now = p.at;
			const endDraft = g.which === "from" ? { x1: now.x, y1: now.y, x2: g.stays.x, y2: g.stays.y } : { x1: g.stays.x, y1: g.stays.y, x2: now.x, y2: now.y };
			return done({ ...state, gesture, route: undefined, endDraft, joins: join ? [join.box] : [], sides: join ? [{ box: join.box, ...(join.side ? { side: join.side } : {}) }] : [] });
		}
		case "arrowBend": {
			const next = bendAt(g.start, g.route, p.at);
			return done({ ...state, gesture: { ...g, next, moved: true }, route: routeDraft(scene, next, g.node) });
		}
	}
}
/** The lift, for the gesture in hand. */
export function release(state: EditorState, p: PointerInput, scene: SceneQuery, ctx: GestureContext): Step {
	const g = state.gesture;
	if (!g) return done(state);
	const effects: Effect[] = [];
	const after: EditorState = { ...state, gesture: undefined };
	switch (g.kind) {
		case "press":
		case "move":
			return releaseCarry(state, g, p, scene, ctx);
		case "marquee":
			return done({ ...after, marquee: undefined });
		case "resize": {
			const next = { ...after, guides: [] };
			if (!g.moved) {
				// Two presses on a frame's top or bottom handle: it hugs what it holds again.
				const tap = handleTap(next, `size:${g.id}:${g.handle}`, p.time);
				const op = tap.again ? hugAgainOp(g.id, scene.node(g.id), g.handle) : undefined;
				return done(tap.state, [], op ? [op] : []);
			}
			return done(settle(next, p.time, ctx, effects), effects, [resizeOp(g.id, givenFor(g.start, g.given, g.next), g.words)]);
		}
		case "pageResize": {
			const next = { ...after, guides: [] };
			if (!g.moved) return done({ ...next, pageResize: undefined });
			const { move, size } = pageResizeEnd(g.start, g.next);
			if (move) effects.push({ do: "move-boards", moves: [{ path: g.path, x: move.x, y: move.y }] });
			if (size) effects.push({ do: "board-size", path: g.path, size });
			// The box is let go of when the board is at it (`landPageResize`), or after a moment if the file settles elsewhere.
			const until = p.time + PAGE_HOLD_MS;
			effects.push({ do: "wake", at: until });
			return done({ ...next, pageResize: { path: g.path, ...shownPageResize(g.next, g.least), released: { rev: ctx.pageRev(g.path), until } } }, effects);
		}
		case "radius": {
			if (!g.moved || g.radius === g.start.radius) return { state: { ...after, radius: undefined }, ops: [], preview: null, effects };
			const until = p.time + RADIUS_HOLD_MS;
			effects.push({ do: "wake", at: until });
			const radius = after.radius ? { ...after.radius, done: true as const, until } : after.radius;
			return done({ ...after, radius }, effects, [radiusOp(g.start.id, g.radius, g.start.shape, scene.item(g.start.id)?.node)]);
		}
		case "arrowEnd": {
			const next: EditorState = { ...after, endDraft: undefined, joins: [], sides: [], route: undefined };
			if (!g.moved) {
				// A double-click on a joined end: the join goes back to the middle of its side.
				const tap = handleTap(next, `end:${g.id}:${g.which}`, p.time);
				const op = tap.again ? resetEndOp(g.id, scene.node(g.id)?.metadata as Record<string, unknown> | undefined, g.which) : undefined;
				return done(tap.state, [], op ? [op] : []);
			}
			const end = g.slid ?? droppedEnd(scene, g.id, g.metadata, g.which, p.at, ctx.zoom);
			return done(next, [], [arrowOp(g.id, withEnd(g.metadata, g.which, end))]);
		}
		case "arrowBend": {
			const next: EditorState = { ...after, route: undefined };
			if (!g.moved) {
				// A double-click on the middle handle: back on the automatic route.
				const tap = handleTap(next, `bend:${g.id}`, p.time);
				const op = tap.again ? resetBendOp(g.id, scene.node(g.id)?.metadata as Record<string, unknown> | undefined) : undefined;
				return done(tap.state, [], op ? [op] : []);
			}
			return done(next, [], g.next ? [arrowOp(g.id, g.next)] : []);
		}
	}
}
