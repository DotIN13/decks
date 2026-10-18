/**
 * The editor's own words for what it works with. Core imports these and the pen types, nothing
 * from the page: no Solid, no DOM, no engine (`core/imports.test.ts` holds that).
 */
import type { Frame } from "@decks/pen";
import type { Guide } from "../../pen/snap.ts";
import type { Gesture } from "./gesture.ts";

export type Pt = { x: number; y: number };
/** A box on the stage, in stage pixels. */
export type Rect = Frame;
/** A board as the stage places it; a slide deck (`slides`) is sized by its width alone. */
export type BoardBox = { path: string; x: number; y: number; w: number; h: number; slides?: boolean };
/**
 * What a press on the stage's drawing does: `select` picks up, every other tool makes one item and
 * hands back to `select`. The page keeps the armed one (`state/pen-tools.ts`).
 */
export type PenTool = "select" | "note" | "card" | "text" | "rectangle" | "ellipse" | "frame" | "arrow" | "shape" | "icon";
/** A tool that makes an item at a point, by a click or a drag: all but `select` and `arrow`. */
export type MakingTool = Exclude<PenTool, "select" | "arrow">;
/**
 * The key that arms each tool. `v` is select, handled with the camera's keys. `s` still makes a
 * note, because it made a sticky when the tools inserted into boards.
 */
export const PEN_TOOL_KEYS: Record<string, PenTool> = { n: "note", s: "note", c: "card", t: "text", r: "rectangle", o: "ellipse", f: "frame", a: "arrow" };

/** The keys held with a press or a move. */
export type Mods = { shift: boolean; alt: boolean; meta: boolean; ctrl: boolean };
/** What is pressing: a mouse, a pen or a finger. */
export type PointerKind = "mouse" | "pen" | "touch";
/** A move in progress, by how much. */
export type Offset = { dx: number; dy: number };
/** Two corners, as a drag has them. */
export type Corners = { x1: number; y1: number; x2: number; y2: number };
/** An item being resized: its box now, and where its given box starts (a path drawn inside its viewBox differs). */
export type ResizeBox = Rect & { id: string; given?: Pt };
/** A board being resized by its handles; once let go, the revision the write will pass and when the box is let go of anyway. */
export type BoardResizeBox = Rect & { path: string; released?: { rev: number; until: number } };
/** A shape being drawn with a tool, corner to corner. */
export type DraftBox = Corners & { tool: PenTool };
/** A side an arrow end can keep to on what it would join, and the one it is near. */
export type SideHintBox = { box: Rect; side?: "top" | "right" | "bottom" | "left" };

/**
 * Everything the editor holds, in one value: what is selected, what the pointer is over, the
 * gesture in hand, and what the canvas draws for it until the engine has drawn the answer.
 *
 * `core/gesture.ts` steps it; `dom/controller.ts` keeps it in a signal and hands each part to the
 * page. `mode` and `tool` are copies: the app owns the mode and `state/pen-tools.ts` the tool.
 */
export type EditorState = {
	mode: "browse" | "edit";
	tool: PenTool;
	/**
	 * The drawn items selected, in the order picked, and the boards picked up with them (a marquee,
	 * Shift and a press on a board). `awaited` are items just made or copied, selected before the
	 * drawing has them, and not let go for being missing until it does.
	 */
	selection: { items: readonly string[]; boards: readonly string[]; awaited: readonly string[] };
	/** The item under the pointer, the board, a board's picture with no node, a card's block, a link. */
	hover: { item?: string | undefined; board?: string | undefined; picture?: string | undefined; block?: string | undefined; link: boolean };
	/** The press in hand (`core/gesture.ts`). */
	gesture?: Gesture | undefined;
	/** The selection's move, held after the lift until the drawing that answers it is drawn. */
	drag: Offset;
	/** The boards a drag carries. */
	boardDrag?: { paths: readonly string[]; dx: number; dy: number } | undefined;
	/** A board moving itself, by a finger on its edge (`BoardFrame`'s own drag). */
	ownDrag?: { path: string; x: number; y: number } | undefined;
	/** An item being resized as the pointer has it, and as the sheet has drawn it (a frame behind). */
	resize?: ResizeBox | undefined;
	shownResize?: ResizeBox | undefined;
	boardResize?: BoardResizeBox | undefined;
	/** A corner radius dragged; `done` once let go, held until the drawing has it or `until`. */
	radius?: { id: string; radius: number; done?: true; until?: number } | undefined;
	marquee?: Corners | undefined;
	guides: readonly Guide[];
	/** The frame a drag would drop into (`null` the stage) and the slot among its children. */
	drop: { into?: string | null | undefined; slot?: { index: number; line: Rect } | undefined };
	/** What an arrow's end would join, lit up, and the sides it can keep to there. */
	joins: readonly Rect[];
	sides: readonly SideHintBox[];
	draft?: DraftBox | undefined;
	endDraft?: Corners | undefined;
	route?: { d: string; x: number; y: number } | undefined;
	/** The carried picture of what was picked up is on its way: outlines stay on the items till it comes. */
	carryPending: boolean;
	/**
	 * Gestures let go and waiting for the engine's redraw: each the drawing generation it was let go
	 * at, and when it gives up waiting. If no new drawing has come by then (the edit was refused or
	 * changed nothing), the drag's offset and the resized outline go anyway.
	 */
	settling: readonly { generation: number; until: number }[];
	/** The last press on a handle that did not move, for a handle's double-click. */
	handleTap?: { key: string; at: number } | undefined;
};
