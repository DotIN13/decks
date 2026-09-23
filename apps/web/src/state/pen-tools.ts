import { createSignal } from "solid-js";

/**
 * What a press on the stage's drawing does, and what is selected in it (`canvas/pen/`).
 *
 * Shared between the stage, which turns presses into pen operations, and the drawing bar
 * (`canvas/pen/PenBar.tsx`), which shows the tools and edits what is selected. `select` is the
 * resting tool: a press picks an item up. Every other tool makes one item and hands back to
 * `select`, the way a design tool does, so a second press is never a second rectangle by surprise.
 */
export type PenTool = "select" | "rectangle" | "ellipse" | "frame" | "text" | "note" | "arrow";

/** The key that arms each tool; `select` shares the board palette's `v`. */
export const PEN_TOOL_KEYS: Record<string, PenTool> = { r: "rectangle", o: "ellipse", f: "frame", T: "text", n: "note", a: "arrow" };

const [penTool, setPenTool] = createSignal<PenTool>("select");
/** Ids of the selected items, in the order they were picked. */
const [penSelection, setPenSelection] = createSignal<readonly string[]>([]);

export { penSelection, penTool, setPenSelection, setPenTool };
