/**
 * The editor's gestures as one reducer: `step(state, input, scene, ctx)` takes the editor's state
 * and one input — a press on something, a move, a lift, the engine having drawn, a timer come due —
 * and gives back the next state, the pen ops to send, what the engine should preview, and the side
 * effects for the page to run (`dom/effects.ts`). Nothing here touches the page or the engine.
 *
 * A gesture is a press followed to its lift: carrying the selection (`press`, then `move` once it
 * has moved; boards go with it, which is a board's drag), a marquee, an item's or a board's
 * handles, the corner radius, and an arrow's end or middle. The page follows the pointer and says
 * each step here, in stage coordinates with the keys held, the pointer's kind and the time.
 *
 * What is drawn after the lift waits for the engine's redraw, and that wait is state too: the
 * drag's offset and the resized outline stay until a new drawing is drawn (`drawn`), or until the
 * gesture's entry in `settling` comes due two seconds on (`tick`) with no new drawing since.
 */
import { isCard, mediaOf, shapeRadius, type MediaItem, type Op, type PenNode } from "@decks/pen";
import { snapMove, type Guide } from "../../pen/snap.ts";
import { arrowOp, bendAt, bendStart, droppedEnd, joinAt, resetBendOp, resetEndOp, routeDraft, slideJoin, withEnd, type ArrowHandles, type JoinedEnd, type Which } from "./arrows.ts";
import { dropSlot, frameUnder } from "./drop.ts";
import type { BoardBox, EditorState, Mods, Offset, PenTool, PointerKind, Pt, Rect, ResizeBox } from "./model.ts";
import { boardMoves, copyOps, moveOps, type BoardMove, type NextId } from "./ops.ts";
import { marqueePick, marqueeRect, pickAt, type Picked } from "./pick.ts";
import { boardResizeEnd, boardResizeStep, givenFor, hugAgainOp, keepsWords, radiusAt, radiusOp, resizeOp, resizePreview, resizeStep, sizeFloor, type Handle, type RadiusStart } from "./resize.ts";
import type { PreviewChange, SceneQuery } from "./scene.ts";
import { selectionBox, SNAP_PX, snapTargets } from "./snapping.ts";

/** How long a let-go gesture waits for the drawing that answers it before its preview goes anyway. */
export const SETTLE_MS = 2000;
/** How long a let-go radius is held for the drawing to have it. */
export const RADIUS_HOLD_MS = 3000;
/** How long a let-go board size is held for the board to be at it. */
export const BOARD_HOLD_MS = 4000;
/** Two presses on one handle within this long, with no drag: the handle's double-click. */
export const HANDLE_TAP_MS = 400;

/** Where the pointer is and how: in stage coordinates and on the screen, the keys held, its kind, and when. */
export type PointerInput = { at: Pt; client: Pt; mods: Mods; pointer: PointerKind; time: number };

/** What a click that does not move does, besides selecting: follow a card's link, or play a film or a sound. */
export type Tap = { do: "open-link"; href: string } | { do: "media"; id: string; media: MediaItem };

/** Carrying the selection: items and boards together. `press` until it has moved, `move` after. */
type Carry = {
	ids: readonly string[];
	boards: readonly string[];
	/** The selection's box as the press found it, and what it snaps to. */
	start: Rect | undefined;
	targets: readonly Rect[];
	from: Pt;
	fromClient: Pt;
	/** A finger's carry: no snapping, no axis, no copy, no composer; the ghost further off. */
	touch?: true;
	tap?: Tap | undefined;
	offset: Offset;
};

/** The press in hand. */
export type Gesture =
	| ({ kind: "press" } & Carry)
	| ({ kind: "move" } & Carry)
	| { kind: "marquee"; from: Pt; kept: { items: readonly string[]; boards: readonly string[] } }
	| { kind: "resize"; id: string; handle: Handle; start: Rect; given: Rect; words: boolean; floor: number; targets: readonly Rect[]; from: Pt; next: Rect; moved: boolean }
	| { kind: "radius"; start: Rect & RadiusStart & { id: string }; radius: number; moved: boolean }
	| { kind: "arrowEnd"; id: string; which: Which; node: PenNode; metadata: Record<string, unknown>; stays: Pt; own?: JoinedEnd | undefined; slid?: { item: string; side: JoinedEnd["side"]; at: number } | undefined; moved: boolean }
	| { kind: "arrowBend"; id: string; node: PenNode; route: ArrowHandles["route"]; start: NonNullable<ReturnType<typeof bendStart>>; next?: Record<string, unknown> | undefined; moved: boolean }
	| { kind: "boardResize"; path: string; handle: Handle; slides: boolean; start: Rect; targets: readonly Rect[]; from: Pt; next: Rect; moved: boolean };

/** One input to the editor. */
export type Input =
	/** A press on the drawing or bare canvas with the select tool: an item picked up, or a marquee. */
	| ({ type: "press-canvas" } & PointerInput)
	/** A press on a board (its node or its picture): it moves with whatever else is picked up. */
	| ({ type: "press-board"; path: string } & PointerInput)
	/** A press on a card block's grip: the block alone, carried. */
	| ({ type: "press-block"; id: string } & PointerInput)
	/** A press on one of the selected item's eight handles (`box` is the handles' box as drawn). */
	| ({ type: "press-handle"; handle: Handle; box: Rect & { id: string } } & PointerInput)
	| ({ type: "press-board-handle"; handle: Handle; box: Rect & { path: string; slides: boolean } } & PointerInput)
	| ({ type: "press-radius"; handle: Rect & RadiusStart & { id: string } } & PointerInput)
	| ({ type: "press-arrow-end"; which: Which; ends: ArrowHandles } & PointerInput)
	| ({ type: "press-arrow-bend"; ends: ArrowHandles } & PointerInput)
	/** A finger that landed on the selection has moved far enough to carry it (`from` is where it landed). */
	| ({ type: "carry"; from: { at: Pt; client: Pt } } & PointerInput)
	| ({ type: "move" } & PointerInput)
	| ({ type: "release" } & PointerInput)
	/** The press was taken back (a finger that became a pinch): what it carried goes back. */
	| { type: "cancel" }
	/**
	 * The engine laid the drawing out. `fresh` when it is a new drawing and not the same one again,
	 * `current` when that is the document the page has; `present` is every id in what it drew.
	 */
	| { type: "drawn"; fresh: boolean; current: boolean; present: ReadonlySet<string> }
	/** The sheet has painted the resize step that was previewed with `resize`. */
	| { type: "frame"; resize: ResizeBox }
	/** A time asked for by a `wake` effect has come. */
	| { type: "tick"; time: number }
	| { type: "carry-pending"; pending: boolean };

/** What the page does for the editor: run in order by `dom/effects.ts`. */
export type Effect =
	/** The app's selected board: picked, or let go (`undefined`). */
	| { do: "select-board"; path?: string | undefined }
	/** A picture of what a drag carries, cut as it starts, for the ghost over a card. */
	| { do: "ghost-take"; ids: readonly string[] }
	| { do: "ghost-show"; over: boolean; client: Pt; gap: number }
	| { do: "ghost-drop" }
	/** Mark the composer under `client` as a drop target for these, or no composer (`client` absent). */
	| { do: "composer"; client?: Pt | undefined; ids: readonly string[]; boards: readonly string[] }
	/** What was let go on the composer is mentioned there instead of moved. */
	| { do: "refer"; ids: readonly string[]; boards: readonly string[] }
	| Tap
	| { do: "move-boards"; moves: readonly BoardMove[] }
	| { do: "board-size"; path: string; size: { w: number; h: number } }
	/** Tell the engine a gesture was let go (`EngineSeam.settle`). */
	| { do: "settle" }
	/** Step again with a `tick` at this time. */
	| { do: "wake"; at: number }
	/** The camera was dragged or something carried: a double-click soon after is not one. */
	| { do: "panned" }
	/** Note the frame this resize step is previewed in, and say `frame` when the sheet shows it. */
	| { do: "await-frame"; resize: ResizeBox };

/** What the reducer reads besides the state and the scene. */
export type GestureContext = {
	zoom: number;
	/** The window, in stage pixels: what a drag snaps against. */
	view: Rect;
	/** The drawing generation: counted up by the page each time a new drawing is drawn. */
	generation: number;
	/** Ids for what a copy makes, none taken. */
	nextIds: () => NextId;
	/** A board's revision now, which a write of its size moves on. */
	boardRev: (path: string) => number;
	/** A card's link under a stage point (`EngineSeam.linkAt`). */
	linkAt: (point: Pt) => string | undefined;
	/** Whether the composer is under a screen point, for a drag of these to mention them. */
	overComposer: (client: Pt, ids: readonly string[], boards: readonly string[]) => boolean;
};

/** One step's answer. `preview` absent leaves the engine's preview as it is; `null` takes it away. */
export type Step = { state: EditorState; ops: Op[]; preview?: ReadonlyMap<string, PreviewChange> | null; effects: Effect[] };

const ZERO: Offset = { dx: 0, dy: 0 };

/** The editor before anything is selected or pressed. */
export function initialState(mode: EditorState["mode"] = "browse", tool: PenTool = "select"): EditorState {
	return { mode, tool, selection: { items: [], boards: [], awaited: [] }, hover: { link: false }, drag: ZERO, guides: [], drop: {}, joins: [], sides: [], carryPending: false, settling: [] };
}

/** The selection with its items, its boards, or both replaced. */
export function withSelection(state: EditorState, next: { items?: readonly string[]; boards?: readonly string[] }): EditorState {
	return { ...state, selection: { ...state.selection, ...(next.items ? { items: next.items } : {}), ...(next.boards ? { boards: next.boards } : {}) } };
}

/** Select what was just asked for, which the drawing does not have until the server answers. */
export function selectMade(state: EditorState, made: readonly string[]): EditorState {
	return { ...state, selection: { ...state.selection, items: made, awaited: [...new Set([...state.selection.awaited, ...made])] } };
}

/** The boards picked up that are no longer on the canvas, let go. */
export function pruneBoards(state: EditorState, present: ReadonlySet<string>): EditorState {
	const picks = state.selection.boards;
	return picks.some((path) => !present.has(path)) ? withSelection(state, { boards: picks.filter((path) => present.has(path)) }) : state;
}

/**
 * A board size let go is let go of once the board is at it: the write's revision has come (or the
 * board is exactly the box already) and the board is where the box is, as wide, and at least as
 * tall, since a board's height is a floor its content can raise. A board gone lets it go too.
 */
export function landBoardResize(state: EditorState, board: (BoardBox & { rev: number }) | undefined): EditorState {
	const held = state.boardResize;
	if (!held?.released) return state;
	if (!board) return { ...state, boardResize: undefined };
	const at = board.x === held.x && board.y === held.y && board.w === held.w;
	if (board.rev === held.released.rev && !(at && board.h === held.h)) return state;
	return at && (board.slides || board.h >= held.h) ? { ...state, boardResize: undefined } : state;
}

/** A second press on the same handle, without a drag, soon after: a handle's double-click. */
function handleTap(state: EditorState, key: string, time: number): { state: EditorState; again: boolean } {
	const was = state.handleTap;
	const again = was?.key === key && time - was.at < HANDLE_TAP_MS;
	return { state: { ...state, handleTap: again ? undefined : { key, at: time } }, again };
}

/** The drag's offset and the resized outline gone: the drawing has the change, or has given up waiting. */
const landed = (state: EditorState): EditorState => ({ ...state, drag: ZERO, resize: undefined, shownResize: undefined });

const isFree = (mods: Mods) => mods.meta || mods.ctrl;
const done = (state: EditorState, effects: Effect[] = [], ops: Op[] = []): Step => ({ state, ops, effects });

/** Start carrying `ids` and `boards` from a press. The ghost's picture is cut now, before anything leaves the sheet. */
function carry(state: EditorState, scene: SceneQuery, ctx: GestureContext, p: PointerInput, ids: readonly string[], boards: readonly string[], tap?: Tap, touch?: { from: { at: Pt; client: Pt } }): { state: EditorState; effect: Effect } {
	const gesture: Gesture = {
		kind: touch ? "move" : "press",
		ids,
		boards,
		start: selectionBox(scene, ids, boards),
		// A finger does not snap, so it never asks what is around.
		targets: touch ? [] : snapTargets(scene, ids, boards, ctx.view),
		from: touch ? touch.from.at : p.at,
		fromClient: touch ? touch.from.client : p.client,
		...(touch ? { touch: true as const } : {}),
		...(tap ? { tap } : {}),
		offset: ZERO,
	};
	return { state: { ...state, gesture }, effect: { do: "ghost-take", ids } };
}

/** A press on the drawing or bare canvas, with the select tool. */
function pressCanvas(state: EditorState, p: PointerInput, scene: SceneQuery, ctx: GestureContext): Step {
	const at = p.at;
	const selected = state.selection.items;
	// What is under the point (`pickAt`, "exact"), unless a double-click already selected a part of what is one thing there.
	const inner = pickAt(scene, at, { deep: true });
	const hit: Picked | undefined = inner && selected.includes(inner.id) ? inner : pickAt(scene, at);
	if (hit) {
		const effects: Effect[] = [{ do: "select-board" }];
		if (p.mods.shift) return done(withSelection(state, { items: selected.includes(hit.id) ? selected.filter((id) => id !== hit.id) : [...selected, hit.id] }), effects);
		const group = selected.includes(hit.id);
		const moving = group ? selected : [hit.id];
		const boards = group ? state.selection.boards : [];
		let next = group ? state : withSelection(state, { items: moving, boards: [] });
		next = { ...next, hover: { ...next.hover, item: undefined } };
		/*
		 * A link in a card: a click that does not move follows it, in a new tab. While browsing,
		 * any click; while editing, where a click is for selecting, one with ⌘ or Ctrl.
		 */
		const href = ctx.linkAt(at);
		const follows = href && (state.mode === "browse" || isFree(p.mods));
		// A film or a sound: a click that does not move plays it, or pauses it.
		const playable = inner && mediaOf(inner.node) ? inner : mediaOf(hit.node) ? hit : undefined;
		const media = playable ? mediaOf(playable.node) : undefined;
		const tap: Tap | undefined = follows ? { do: "open-link", href } : playable && media && !p.mods.shift ? { do: "media", id: playable.id, media } : undefined;
		const started = carry(next, scene, ctx, p, moving, boards, tap);
		return done(started.state, [...effects, started.effect]);
	}
	/*
	 * Bare canvas: a marquee, as in a design tool, picking the items and the boards wholly inside
	 * it as it goes. Shift adds to what is already selected.
	 */
	const adding = p.mods.shift;
	const kept = { items: adding ? selected : [], boards: adding ? state.selection.boards : [] };
	const next = adding ? state : withSelection(state, { items: [], boards: [] });
	return done({ ...next, marquee: { x1: at.x, y1: at.y, x2: at.x, y2: at.y }, gesture: { kind: "marquee", from: at, kept } }, [{ do: "select-board" }]);
}

/** A press on a board: Shift adds it to the picks or takes it out; otherwise it is carried with the selection it is part of, or alone. */
function pressBoard(state: EditorState, path: string, p: PointerInput, scene: SceneQuery, ctx: GestureContext): Step {
	const picks = state.selection.boards;
	if (p.mods.shift) return done(withSelection(state, { boards: picks.includes(path) ? picks.filter((one) => one !== path) : [...picks, path] }));
	const group = picks.includes(path);
	const next = group ? state : withSelection(state, { items: [], boards: [] });
	const started = carry(next, scene, ctx, p, group ? state.selection.items : [], group ? picks : [path]);
	return done(started.state, [{ do: "select-board", path }, started.effect]);
}

/** A move of the selection being carried by a mouse or a pen. */
function moveCarry(state: EditorState, g: Carry, p: PointerInput, scene: SceneQuery, ctx: GestureContext): Step {
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
			const snapped = snapMove({ ...start, x: start.x + dx, y: start.y + dy }, g.targets, SNAP_PX / ctx.zoom);
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
	const drop = { into: onto, slot: onto ? dropSlot(scene, onto, now, ids) : undefined };
	// A finger carries the boards picked up as they are now; a mouse the ones it picked up.
	const carried = g.touch ? state.selection.boards : boards;
	let next: EditorState = { ...state, gesture: { ...g, kind: "move", offset }, drop };
	if (!g.touch) next = { ...next, guides: lines };
	if (ids.length || g.touch) next = { ...next, drag: offset };
	if (carried.length) next = { ...next, boardDrag: { paths: carried, ...offset } };
	const preview = ids.length || g.touch ? new Map(ids.map((id) => [id, offset])) : undefined;
	return { state: next, ops: [], effects, ...(preview ? { preview } : {}) };
}

/** The lift of a carry. */
function releaseCarry(state: EditorState, g: Gesture & Carry, p: PointerInput, scene: SceneQuery, ctx: GestureContext): Step {
	const { ids, boards, offset } = g;
	const effects: Effect[] = [{ do: "ghost-drop" }];
	let next: EditorState = { ...state, gesture: undefined };
	if (g.touch) {
		const into = state.drop.into;
		const slot = state.drop.slot?.index;
		next = { ...next, drop: {} };
		const ops = moveOps(scene, ids, offset.dx, offset.dy, into, slot);
		if (ids.length) next = settle(next, p.time, ctx, effects);
		effects.push({ do: "move-boards", moves: boardMoves(scene.boards(), state.selection.boards, offset.dx, offset.dy) });
		return { state: { ...next, boardDrag: undefined }, ops, effects };
	}
	const moved = g.kind === "move";
	const referring = moved && ctx.overComposer(p.client, ids, boards);
	effects.push({ do: "composer", ids, boards });
	next = { ...next, guides: [] };
	if (!moved) {
		next = { ...next, drop: {}, boardDrag: undefined };
		if (g.tap) effects.push(g.tap);
		return done(next, effects);
	}
	/*
	 * Dropped on the composer: the move is undone and the items are mentioned instead. Undone rather
	 * than never started, because the preview is what makes the gesture legible — you drag the note
	 * to the box and it goes back where it was, with its name now in what you are typing.
	 */
	if (referring) {
		effects.push({ do: "refer", ids, boards });
		return { state: { ...next, drop: {}, drag: ZERO, boardDrag: undefined }, ops: [], preview: null, effects };
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
	if (ids.length) next = settle(next, p.time, ctx, effects);
	effects.push({ do: "move-boards", moves: boardMoves(scene.boards(), boards, offset.dx, offset.dy) });
	next = { ...next, boardDrag: undefined };
	return { state: next, ops, effects, ...(preview === null ? { preview } : {}) };
}

/** A gesture let go with its edit sent: the engine is told, and it waits for the drawing that answers it. */
function settle(state: EditorState, time: number, ctx: GestureContext, effects: Effect[]): EditorState {
	const until = time + SETTLE_MS;
	effects.push({ do: "settle" }, { do: "wake", at: until });
	return { ...state, settling: [...state.settling, { generation: ctx.generation, until }] };
}

/** A press that starts a gesture on something the overlay drew: a handle, the radius, an arrow's end or middle. */
function pressHandle(state: EditorState, input: Input & PointerInput, scene: SceneQuery, ctx: GestureContext): Step | undefined {
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
					targets: snapTargets(scene, [id], [], ctx.view),
					from: input.at,
					next: start,
					moved: false,
				},
			});
		}
		case "press-board-handle": {
			const { path, slides } = input.box;
			const start = { x: input.box.x, y: input.box.y, w: input.box.w, h: input.box.h };
			return done({ ...state, gesture: { kind: "boardResize", path, handle: input.handle, slides, start, targets: snapTargets(scene, [], [path], ctx.view), from: input.at, next: start, moved: false } });
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
function move(state: EditorState, p: PointerInput, scene: SceneQuery, ctx: GestureContext): Step {
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
			const step = resizeStep(g.start, g.handle, { x: p.at.x - g.from.x, y: p.at.y - g.from.y }, { shift: p.mods.shift, free: isFree(p.mods) }, { targets: g.targets, threshold: SNAP_PX / ctx.zoom, floor: g.floor });
			const box = givenFor(g.start, g.given, step.box);
			const resize: ResizeBox = { id: g.id, ...step.box, given: { x: box.x, y: box.y } };
			return {
				state: { ...state, guides: step.guides, resize, gesture: { ...g, next: step.box, moved: true } },
				ops: [],
				preview: new Map<string, PreviewChange>([[g.id, resizePreview(g.given, box, g.words)]]),
				effects: [{ do: "await-frame", resize }],
			};
		}
		case "boardResize": {
			const step = boardResizeStep(g.start, g.handle, { x: p.at.x - g.from.x, y: p.at.y - g.from.y }, { shift: p.mods.shift, free: isFree(p.mods) }, { targets: g.targets, threshold: SNAP_PX / ctx.zoom, slides: g.slides });
			return done({ ...state, guides: step.guides, boardResize: { path: g.path, ...step.box }, gesture: { ...g, next: step.box, moved: true } });
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
function release(state: EditorState, p: PointerInput, scene: SceneQuery, ctx: GestureContext): Step {
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
		case "boardResize": {
			const next = { ...after, guides: [] };
			if (!g.moved) return done({ ...next, boardResize: undefined });
			const { move, size } = boardResizeEnd(g.start, g.next);
			if (move) effects.push({ do: "move-boards", moves: [{ path: g.path, x: move.x, y: move.y }] });
			if (size) effects.push({ do: "board-size", path: g.path, size });
			// The box is let go of when the board is at it (`landBoardResize`), or after a moment if the file settles elsewhere.
			const until = p.time + BOARD_HOLD_MS;
			effects.push({ do: "wake", at: until });
			return done({ ...next, boardResize: { path: g.path, ...g.next, released: { rev: ctx.boardRev(g.path), until } } }, effects);
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

/** The editor's next state for one input, with the ops, preview and effects it brings. */
export function step(state: EditorState, input: Input, scene: SceneQuery, ctx: GestureContext): Step {
	// A press starts afresh: no gesture is still in hand when another press lands.
	if (input.type.startsWith("press-") && state.gesture) state = { ...state, gesture: undefined };
	switch (input.type) {
		case "press-canvas":
			return pressCanvas(state, input, scene, ctx);
		case "press-board":
			return pressBoard(state, input.path, input, scene, ctx);
		case "press-block": {
			const next = withSelection(state, { items: [input.id], boards: [] });
			const started = carry(next, scene, ctx, input, [input.id], []);
			return done(started.state, [{ do: "select-board" }, started.effect]);
		}
		case "press-handle":
		case "press-board-handle":
		case "press-radius":
		case "press-arrow-end":
		case "press-arrow-bend":
			return pressHandle(state, input, scene, ctx) ?? done(state);
		case "carry": {
			const started = carry(state, scene, ctx, input, state.selection.items, state.selection.boards, undefined, { from: input.from });
			return done(started.state, [started.effect]);
		}
		case "move":
			return move(state, input, scene, ctx);
		case "release":
			return release(state, input, scene, ctx);
		case "cancel": {
			// A second finger: the start of a pinch, and whatever was carried goes back.
			const g = state.gesture;
			const next: EditorState = { ...state, gesture: undefined, drop: {} };
			const carried = g?.kind === "move" && g.touch;
			if (!carried) return done(next, [{ do: "ghost-drop" }]);
			return { state: { ...next, drag: ZERO, boardDrag: undefined }, ops: [], preview: null, effects: [{ do: "ghost-drop" }] };
		}
		case "drawn": {
			let next = state;
			/*
			 * The answer to a drag has been drawn: the layout is where the drag left things, so the
			 * offset goes. Only a newly drawn document is the answer, and only the one the page has.
			 */
			if (input.fresh && input.current) next = landed(next);
			// A selection of items the drawing no longer has is let go, whoever took them away; what was just made waits for the drawing to have it.
			const awaited = next.selection.awaited.filter((id) => !input.present.has(id));
			const items = next.selection.items.filter((id) => input.present.has(id) || awaited.includes(id));
			if (awaited.length !== next.selection.awaited.length || items.length !== next.selection.items.length) {
				next = { ...next, selection: { ...next.selection, awaited, items: items.length !== next.selection.items.length ? items : next.selection.items } };
			}
			// A let-go radius is let go of when the drawing has it.
			const rounding = next.radius;
			if (rounding?.done) {
				const node = scene.node(rounding.id);
				const now = node ? (shapeRadius(node) ?? (typeof node.cornerRadius === "number" ? node.cornerRadius : 0)) : undefined;
				if (now !== undefined && Math.round(now) === Math.round(rounding.radius)) next = { ...next, radius: undefined };
			}
			return done(next);
		}
		case "frame":
			return done(state.resize ? { ...state, shownResize: input.resize } : state);
		case "tick": {
			let next = state;
			let preview: null | undefined;
			const due = state.settling.filter((one) => one.until <= input.time);
			if (due.length) {
				next = { ...next, settling: state.settling.filter((one) => one.until > input.time) };
				// No new drawing since it was let go: the server refused it, or it changed nothing.
				if (due.some((one) => one.generation === ctx.generation)) {
					next = landed(next);
					preview = null;
				}
			}
			if (next.radius?.done && next.radius.until !== undefined && next.radius.until <= input.time) next = { ...next, radius: undefined };
			const held = next.boardResize?.released;
			if (held && held.until <= input.time) next = { ...next, boardResize: undefined };
			return { state: next, ops: [], effects: [], ...(preview === null ? { preview } : {}) };
		}
		case "carry-pending":
			return done(state.carryPending === input.pending ? state : { ...state, carryPending: input.pending });
	}
}

/** The drag as far as the canvas shows it: nothing while the carried picture is on its way, so outlines stay on the items until it comes. */
export const shownDrag = (state: EditorState): Offset => (state.carryPending ? ZERO : state.drag);
