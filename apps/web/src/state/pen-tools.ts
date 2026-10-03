import { createSignal } from "solid-js";

/**
 * What a press on the stage's drawing does, and what is selected in it (`canvas/pen/`).
 *
 * Shared between the stage, which turns presses into pen operations, and the drawing bar
 * (`canvas/pen/PenBar.tsx`), which shows the tools and edits what is selected. `select` is the
 * resting tool: a press picks an item up. Every other tool makes one item and hands back to
 * `select`, the way a design tool does, so a second press is never a second rectangle by surprise.
 */
export type PenTool = "select" | "note" | "card" | "text" | "rectangle" | "ellipse" | "frame" | "arrow" | "shape" | "icon";

/**
 * The key that arms each tool. `v` is select, handled with the camera's keys. `s` still makes a
 * note, because it made a sticky when the tools inserted into boards.
 */
export const PEN_TOOL_KEYS: Record<string, PenTool> = { n: "note", s: "note", c: "card", t: "text", r: "rectangle", o: "ellipse", f: "frame", a: "arrow" };

const [penTool, setPenTool] = createSignal<PenTool>("select");
/** Ids of the selected items, in the order they were picked. */
const [penSelection, setPenSelection] = createSignal<readonly string[]>([]);

/**
 * What the `shape` and `icon` tools make: the shape picked in the insert panel (`canvas/pen/Insert.tsx`,
 * by its name in `@decks/pen`'s `SHAPES`) and the icon picked there, by library and name.
 */
const [penShape, setPenShape] = createSignal("Rectangle");
const [penIcon, setPenIcon] = createSignal<{ library: string; name: string }>({ library: "lucide", name: "star" });

/**
 * Where each selected item is on the stage, as the stage last drew it: the properties panel's
 * position and size (`canvas/pen/Properties.tsx`). Set by the stage, which has the layout.
 */
const [penBoxes, setPenBoxes] = createSignal<ReadonlyMap<string, { x: number; y: number; w: number; h: number }>>(new Map());

/**
 * The insert panel (`canvas/pen/Insert.tsx`): open on its shapes or its icons. Opened from the tool
 * column it sits beside it and a pick arms the tool; opened from the canvas menu it carries the stage
 * point the menu was opened at, and a pick is put there at once.
 */
export interface InsertPanel {
	tab: "shapes" | "icons";
	at?: { x: number; y: number };
	client?: { x: number; y: number };
	/** An icon on the stage to change to the one picked, instead of making a new one: the panel's "Pick…". */
	replace?: string;
}
const [insertPanel, setInsertPanel] = createSignal<InsertPanel | undefined>();

export { insertPanel, penBoxes, penIcon, penSelection, penShape, penTool, setInsertPanel, setPenBoxes, setPenIcon, setPenSelection, setPenShape, setPenTool };
