// The editor's gestures as one reducer: each pointer input, drawing and tick steps the state and says
// the ops, preview and effects it brings. The presses, carries and handles are in the gesture-*.ts files.
import { shapeRadius, type MediaItem, type Op, type PenNode } from "@decks/pen";
import { bendStart, type ArrowHandles, type JoinedEnd, type Which } from "./arrows.ts";
import type { EditorState, Mods, Offset, PenTool, PointerKind, Pt, Rect, ResizeBox } from "./model.ts";
import { type PageMove, type NextId } from "./ops.ts";
import { type Handle, type RadiusStart } from "./resize.ts";
import type { PreviewChange, SceneQuery } from "./scene.ts";
import { pressCanvas, pressPage, withSelection } from "./gesture-press.ts";
import { carry, done } from "./gesture-carry.ts";
import { landed, move, pressHandle, release } from "./gesture-handle.ts";
export { withSelection, selectMade, prunePages } from "./gesture-press.ts";
export { landPageResize } from "./gesture-handle.ts";
export { landPageDrag } from "./gesture-carry.ts";

// How long things wait.
/** How long a let-go gesture waits for the drawing that answers it before its preview goes anyway. */
export const SETTLE_MS = 2000;
/** How long a let-go radius is held for the drawing to have it. */
export const RADIUS_HOLD_MS = 3000;
/** How long a let-go board size is held for the board to be at it. */
export const PAGE_HOLD_MS = 4000;
/** Two presses on one handle within this long, with no drag: the handle's double-click. */
export const HANDLE_TAP_MS = 400;

// What goes in, what is in hand, and what comes out.
/** Where the pointer is and how: in stage coordinates and on the screen, the keys held, its kind, and when. */
export type PointerInput = { at: Pt; client: Pt; mods: Mods; pointer: PointerKind; time: number };
/** What a click that does not move does, besides selecting: follow a card's link, or play a film or a sound. */
export type Tap = { do: "open-link"; href: string } | { do: "media"; id: string; media: MediaItem };
/** Carrying the selection: items and boards together. `press` until it has moved, `move` after. */
export type Carry = {
	ids: readonly string[];
	boards: readonly string[];
	/** The selection's box as the press found it, what it snaps to, and the boards it keeps the reading gap from. */
	start: Rect | undefined;
	targets: readonly Rect[];
	reading: readonly Rect[];
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
	| { kind: "resize"; id: string; handle: Handle; start: Rect; given: Rect; words: boolean; floor: number; narrowest: number; targets: readonly Rect[]; from: Pt; next: Rect; moved: boolean }
	| { kind: "radius"; start: Rect & RadiusStart & { id: string }; radius: number; moved: boolean }
	| { kind: "arrowEnd"; id: string; which: Which; node: PenNode; metadata: Record<string, unknown>; stays: Pt; own?: JoinedEnd | undefined; slid?: { item: string; side: JoinedEnd["side"]; at: number } | undefined; moved: boolean }
	| { kind: "arrowBend"; id: string; node: PenNode; route: ArrowHandles["route"]; start: NonNullable<ReturnType<typeof bendStart>>; next?: Record<string, unknown> | undefined; moved: boolean }
	| { kind: "pageResize"; path: string; handle: Handle; least?: number | undefined; start: Rect; targets: readonly Rect[]; from: Pt; next: Rect; moved: boolean };
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
	| ({ type: "press-board-handle"; handle: Handle; box: Rect & { path: string } } & PointerInput)
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
	| { do: "move-boards"; moves: readonly PageMove[] }
	| { do: "board-size"; path: string; size: { w: number; h: number } }
	/**
	 * Tell the engine a gesture was let go (`EngineSeam.settle`); a drop says where what it can move
	 * was let go (`glide.ts`, `landingBoxes`), for the drawing that answers it to glide them from.
	 */
	| { do: "settle"; landing?: ReadonlyMap<string, Rect> }
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
	pageRev: (path: string) => number;
	/** A card's link under a stage point (`EngineSeam.linkAt`). */
	linkAt: (point: Pt) => string | undefined;
	/** Whether the composer is under a screen point, for a drag of these to mention them. */
	overComposer: (client: Pt, ids: readonly string[], boards: readonly string[]) => boolean;
};
/** One step's answer. `preview` absent leaves the engine's preview as it is; `null` takes it away. */
export type Step = { state: EditorState; ops: Op[]; preview?: ReadonlyMap<string, PreviewChange> | null; effects: Effect[] };

// The step.
export const ZERO: Offset = { dx: 0, dy: 0 };
/** The editor before anything is selected or pressed. */
export function initialState(mode: EditorState["mode"] = "browse", tool: PenTool = "select"): EditorState {
	return { mode, tool, selection: { items: [], boards: [], awaited: [] }, hover: { link: false }, drag: ZERO, guides: [], drop: {}, joins: [], sides: [], carryPending: false, settling: [] };
}
/** The editor's next state for one input, with the ops, preview and effects it brings. */
export function step(state: EditorState, input: Input, scene: SceneQuery, ctx: GestureContext): Step {
	// A press starts afresh: no gesture is still in hand when another press lands.
	if (input.type.startsWith("press-") && state.gesture) state = { ...state, gesture: undefined };
	switch (input.type) {
		case "press-canvas":
			return pressCanvas(state, input, scene, ctx);
		case "press-board":
			return pressPage(state, input.path, input, scene, ctx);
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
			return { state: { ...next, drag: ZERO, pageDrag: undefined }, ops: [], preview: null, effects: [{ do: "ghost-drop" }] };
		}
		case "drawn":
			return onDrawn(state, input, scene);
		case "frame":
			return done(state.resize ? { ...state, shownResize: input.resize } : state);
		case "tick":
			return onTick(state, input, ctx);
		case "carry-pending":
			return done(state.carryPending === input.pending ? state : { ...state, carryPending: input.pending });
	}
}
/** The answer to a drag has been drawn: the offset goes, and a selection or a radius the drawing settles is let go. */
function onDrawn(state: EditorState, input: Extract<Input, { type: "drawn" }>, scene: SceneQuery): Step {
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

/** Time passing: what was let go and never answered lands, and held boxes and radii are let go when due. */
function onTick(state: EditorState, input: Extract<Input, { type: "tick" }>, ctx: GestureContext): Step {
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
	const held = next.pageResize?.released;
	if (held && held.until <= input.time) next = { ...next, pageResize: undefined };
	const dropped = next.pageDrag?.released;
	if (dropped && dropped.until <= input.time) next = { ...next, pageDrag: undefined };
	return { state: next, ops: [], effects: [], ...(preview === null ? { preview } : {}) };
}
/** The drag as far as the canvas shows it: nothing while the carried picture is on its way, so outlines stay on the items until it comes. */
export const shownDrag = (state: EditorState): Offset => (state.carryPending ? ZERO : state.drag);
