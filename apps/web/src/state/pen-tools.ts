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
/** Whether a card is open for typing, or on a phone any words (`Stage.tsx`): the properties panel stands aside. */
const [penTyping, setPenTyping] = createSignal(false);
/**
 * Whether a phone's properties sheet has been asked for: by a second tap on the item already selected.
 * The first tap only selects, so a finger can carry what it picked without the sheet over the canvas.
 */
const [penSheet, setPenSheet] = createSignal(false);

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

/**
 * A change the properties panel is making with a drag, as the update it will save when the hand
 * lifts: the colour under the pointer in the colour picker.
 *
 * The stage draws it without saving it (`canvas/Stage.tsx`, `penLayer.preview`), so the colour
 * changes under the pointer while the drag is still one edit to the file and not sixty. Cleared by
 * the stage when the drawing comes back with the change in it.
 */
const [penLive, setPenLive] = createSignal<readonly { id: string; set: Record<string, unknown> }[] | undefined>();

export { insertPanel, penBoxes, penIcon, penLive, penSelection, penShape, penSheet, penTool, penTyping, setInsertPanel, setPenBoxes, setPenIcon, setPenLive, setPenSelection, setPenShape, setPenSheet, setPenTool, setPenTyping };
