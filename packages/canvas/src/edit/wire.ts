/**
 * What crosses between the page and the editor in the engine (`crates/editor/src/wire.rs`,
 * `crates/web/src/editing_wire.rs`): the inputs the page's pointer sends, the effects it is asked to
 * run, the overlay's places it puts its hit areas on, and the shapes of the editor's other answers
 * (`editor.call`). Types only, and the handles' names: the editor itself is the engine's.
 */
import type { MediaItem, Op, PenNode } from "@decks/pen";
import type { ArrowRoute, ArrowSide } from "@decks/pen";
import type { Corners, Offset, PageBox, PenTool, PointerKind, Pt, Rect, ResizeBox, Mods } from "./model.ts";

/** A box in stage units. */
export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * A snapping guide the engine paints: an alignment (`kind: "line"`) or one measured gap between two
 * boxes (`"gap"`). An alignment carries the points on it that line up (`points`), each marked with a
 * ✕; a gap that is the reading gap between two boards says its size (`label`).
 */
export interface Guide {
	kind: "line" | "gap";
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	points?: { x: number; y: number }[];
	label?: string;
}

/** A pointer at a stage point (`at`) and on the screen (`client`), with its keys, its kind and its time. */
export type PointerInput = { at: Pt; client: Pt; mods: Mods; pointer: PointerKind; time: number };

/** The eight handles round a box, by compass point. */
export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type Handle = (typeof HANDLES)[number];

/** A box with corners to round: the radius now, the most it can be, and whether it is a library shape's. */
export type RadiusStart = Rect & { radius: number; most: number; shape: boolean };

/** What an arrow's end would join: an item by its name, with the side it keeps to. */
export type Join = { name: string; box: Rect; side?: ArrowSide };
/** An end that is joined, as drawn. */
export type JoinedEnd = { item: string; box: Rect; side: ArrowSide; at?: number };
/** The handles of a selected arrow: its two ends, what they join, and its middle when it has one to pull. */
export type ArrowHandles = { id: string; route: ArrowRoute; from: Pt; to: Pt; fromJoin?: JoinedEnd; toJoin?: JoinedEnd; middle?: Pt; bent: boolean };
/** A route drawn dashed while a handle is dragged. */
export type RouteDraft = { d: string; x: number; y: number };

/** One input to the editor. */
export type Input =
	| ({ type: "press-canvas" } & PointerInput)
	| ({ type: "press-board"; path: string } & PointerInput)
	| ({ type: "press-block"; id: string } & PointerInput)
	| ({ type: "press-handle"; handle: Handle; box: Rect & { id: string } } & PointerInput)
	| ({ type: "press-board-handle"; handle: Handle; box: Rect & { path: string } } & PointerInput)
	| ({ type: "press-radius"; handle: Rect & RadiusStart & { id: string } } & PointerInput)
	| ({ type: "press-arrow-end"; which: "from" | "to"; ends: ArrowHandles } & PointerInput)
	| ({ type: "press-arrow-bend"; ends: ArrowHandles } & PointerInput)
	/** A finger that landed on the selection has moved far enough to carry it (`from` is where it landed). */
	| ({ type: "carry"; from: { at: Pt; client: Pt } } & PointerInput)
	| ({ type: "move" } & PointerInput)
	| ({ type: "release" } & PointerInput)
	| { type: "cancel" }
	| { type: "drawn"; fresh: boolean; current: boolean; present: ReadonlySet<string> }
	| { type: "tick"; time: number }
	| { type: "carry-pending"; pending: boolean };

/** A board's move, as a drop or a key asks it. */
export type PageMove = { path: string; x: number; y: number };

/** What a click that does not move does, besides selecting. */
export type Tap = { do: "open-link"; href: string } | { do: "media"; id: string; media: MediaItem };

/** What the page does for the editor, in order (`dom/effects.ts`). */
export type Effect =
	| { do: "select-board"; path?: string | undefined }
	| { do: "ghost-take"; ids: readonly string[] }
	| { do: "ghost-show"; over: boolean; client: Pt; gap: number }
	| { do: "ghost-drop" }
	| { do: "composer"; client?: Pt | undefined; ids: readonly string[]; boards: readonly string[] }
	| { do: "refer"; ids: readonly string[]; boards: readonly string[] }
	| Tap
	| { do: "move-boards"; moves: readonly PageMove[] }
	| { do: "board-size"; path: string; size: { w: number; h: number } }
	| { do: "settle"; landing?: ReadonlyMap<string, Rect> }
	| { do: "wake"; at: number }
	| { do: "panned" }
	| { do: "await-frame"; resize: ResizeBox };

/** The gesture in hand, as the engine's editor says it: its kind, and for a carry what it carries. */
export type GestureSummary = { kind: "press" | "move" | "marquee" | "resize" | "radius" | "arrowEnd" | "arrowBend" | "pageResize"; ids?: string[]; boards?: string[]; touch?: boolean; offset?: Offset; id?: string; path?: string };

/** One outline round something selected: `id` is the item's, `page:<path>` for a board, empty for the marquee. */
export type Outline = Rect & { id: string; role: "item" | "page" | "marquee"; round?: true };
export type PageHandles = Outline & { path: string };
export type HoverBox = Rect & { id?: string; board?: true; round?: true };
export type GripBox = { id: string; x: number; y: number };
export type DropBox = Rect & { id: string };
export type KinBox = Rect & { id: string; kin: "parent" | "child"; of: "selection" | "hover"; round?: true };
export type SelectionFrame = Rect & { many: boolean; label: string };
export type MeasureLine = { x1: number; y1: number; x2: number; y2: number; label?: string; dashed?: true };
export type Distances = { from: Rect; to: Rect; lines: MeasureLine[] };
export type SideHint = { box: Rect; side?: ArrowSide };
export type Draft = Corners & { tool: string };
export type RadiusHandle = Outline & RadiusStart;

/** Everything drawn over the canvas, as places: what the engine painted, for the page's hit areas and pills. */
export type Overlay = {
	outlines: Outline[];
	handles?: Outline;
	anchors?: Outline;
	pageHandles?: PageHandles;
	radius?: RadiusHandle;
	radiusDrag?: { id: string; radius: number };
	arrow?: ArrowHandles;
	hover?: HoverBox;
	kin: readonly KinBox[];
	selectionFrame?: SelectionFrame;
	distances?: Distances;
	grip?: GripBox;
	gripHidden: boolean;
	drop?: DropBox;
	insert?: Rect;
	slots: readonly Rect[];
	slotFrames: readonly Rect[];
	joins: readonly Rect[];
	sides: readonly SideHint[];
	guides: readonly Guide[];
	draft?: Draft;
	route?: RouteDraft;
	endDraft?: Corners;
};

/** Where a press landed: the bare stage, a drawn item's click shape over a page, or anything else. */
export type PressTarget = "stage" | "drawn" | "other";
/** What a press on the stage starts (`decide-press`). */
export type PressAction =
	| { do: "make" }
	| { do: "press" }
	| { do: "picture"; path: string; carry: boolean }
	| { do: "touch"; picture?: string; then?: "drawing" | "deselect" }
	| { do: "pan"; deselect: boolean; middle: boolean }
	| { do: "nothing" };
/** What a hover does (`decide-hover`). */
export type HoverAction = { do: "none" } | { do: "clear"; block: boolean } | { do: "track"; outlines: boolean };
/** A tap on a drawn item before this one. */
export type LastTap = { id: string; at: number };
/** A tap on bare canvas before this one, on the screen. */
export type BareTap = Pt & { at: number };

/** What a press found: the item, its node, and the box it covers. */
export type Picked = { id: string; node: PenNode; box: Rect };
/** How a pick climbs from what it hit, and what it looks through. */
export type PickOptions = { policy?: "exact" | "outermost"; deep?: boolean; skip?: readonly string[]; skipArrows?: boolean };

/** What a key does to the drawing (`pen-key`). */
export type KeyAct =
	| { handled: false }
	| { handled: true; do: "step"; step: "undo" | "redo" }
	| { handled: true; do: "delete"; ops: Op[]; select: [] }
	| { handled: true; do: "escape"; tool: "select" }
	| { handled: true; do: "escape"; select: []; boards: [] }
	| { handled: true; do: "duplicate"; ops: Op[]; select: string[] }
	| { handled: true; do: "nudge"; ops: Op[]; boards: PageMove[] }
	| { handled: true; do: "select"; select: string[] }
	| { handled: true; do: "arm"; tool: PenTool };

/** Ids for new items, none taken. */
export type NextId = () => string;

export type { PageBox };
