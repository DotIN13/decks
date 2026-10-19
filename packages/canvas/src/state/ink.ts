import type { InkColor } from "@decks/board-kit";
import { createSignal } from "solid-js";

/**
 * Drawing: the tool in hand, its colour and width, and what the lasso holds.
 *
 * What is drawn goes on the stage, into its `.pen` file (`canvas/pen/StageInk.tsx`, `pen/ink.ts`),
 * and undoes with the stage's own history. Ink that older builds wrote into a board's file stays
 * in it and is drawn by the board itself.
 */

export type InkTool = "pen" | "marker" | "eraser" | "lasso";

/** Whether the draw tool is on. Only ever true in browse mode: editing turns it off. */
const [drawing, setDrawing] = createSignal(false);
const [inkTool, setInkTool] = createSignal<InkTool>("pen");
const [inkColor, setInkColor] = createSignal<InkColor>("ink");
/** One of three widths, by index, so the pen and the marker each keep a sensible set. */
const [inkWidth, setInkWidth] = createSignal(1);
/**
 * A stylus has touched the glass in this session.
 *
 * From then on a finger moves the canvas and only the pencil draws, which is what a tablet's
 * own notes app does: the hand that holds the pencil rests on the screen.
 */
const [penSeen, setPenSeen] = createSignal(false);

export { drawing, setDrawing, inkTool, setInkTool, inkColor, setInkColor, inkWidth, setInkWidth, penSeen, setPenSeen };

export const INK_WIDTHS: Record<"pen" | "marker", [number, number, number]> = { pen: [2, 4, 8], marker: [12, 20, 32] };

/** The width the tool in hand draws at, in stage pixels. */
export function inkSize(): number {
	const tool = inkTool();
	return INK_WIDTHS[tool === "marker" ? "marker" : "pen"][inkWidth()] ?? 4;
}

/** What the lasso holds: stroke ids on the stage (`canvas/pen/StageInk.tsx`). */
const [inkSelection, setInkSelection] = createSignal<{ path: string; ids: string[] } | undefined>(undefined);

export { inkSelection, setInkSelection };
