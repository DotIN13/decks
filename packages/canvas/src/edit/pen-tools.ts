import { createSignal, untrack, type Accessor } from "solid-js";
import type { PenDocument } from "@decks/pen";
import type { PenTool } from "./core/model.ts";

/**
 * What a press on the stage's drawing does, and what is selected in it (`canvas/pen/`).
 *
 * Shared between the stage, which turns presses into pen operations, and the drawing bar
 * (`canvas/pen/PenBar.tsx`), which shows the tools and edits what is selected. `select` is the
 * resting tool: a press picks an item up. Every other tool makes one item and hands back to
 * `select`, the way a design tool does, so a second press is never a second rectangle by surprise.
 */
export type { PenTool };

/** The key that arms each tool (`canvas/editor/core/model.ts`). */
export { PEN_TOOL_KEYS } from "./core/model.ts";

const [penTool, setPenTool] = createSignal<PenTool>("select");
/**
 * Ids of the selected items, in the order they were picked: the stage's editor's selection
 * (`canvas/editor/dom/controller.ts`), which feeds itself in here with `feedSelection`. With no
 * stage up, a selection of its own that nothing draws: the one the last stage left, which the next
 * stage starts with (`keptSelection`), so a stage mounted again keeps what was selected. A switch
 * of connection clears it (`connections/switch.ts`).
 */
type SelectionSource = { items: Accessor<readonly string[]>; select: (items: readonly string[]) => void };
const [selectionSource, setSelectionSource] = createSignal<SelectionSource | undefined>();
const [looseSelection, setLooseSelection] = createSignal<readonly string[]>([]);
const penSelection = (): readonly string[] => selectionSource()?.items() ?? looseSelection();
const setPenSelection = (items: readonly string[]) => {
	const source = untrack(selectionSource);
	if (source) source.select(items);
	else setLooseSelection(items);
};
/**
 * The editor's selection, read and written here from now on; the function given back hands it
 * back, and keeps what it had selected for the next stage.
 */
export function feedSelection(source: SelectionSource): () => void {
	setSelectionSource(() => source);
	return () => {
		if (untrack(selectionSource) !== source) return;
		setLooseSelection(untrack(source.items));
		setSelectionSource(undefined);
	};
}
/** The selection a stage starts with: the one up now, else what the last one left, unless something cleared it since. */
export const keptSelection = (): readonly string[] => untrack(penSelection);
/** Whether a card is open for typing (`CanvasView.tsx`): the properties panel stands aside. */
const [penTyping, setPenTyping] = createSignal(false);

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
 * Where the selection's outline is on the screen, when whoever shows the properties is not where the
 * canvas is: an app that draws its tools on its page is told it by the canvas frame (`frame/tools-mirror.ts`).
 * Unset wherever the properties and the canvas share a page, which measures the outline itself.
 */
const [penOutline, setPenOutline] = createSignal<{ left: number; top: number; right: number; bottom: number } | undefined>();
export { penOutline, setPenOutline };
/**
 * Where the app's tool column stands on the canvas's screen, when the app draws it on its own page
 * over the canvas's frame: what opens on the canvas beside the words it is for (a card's style bar)
 * keeps clear of it, as it does of a column in its own document.
 */
const [penToolsAt, setPenToolsAt] = createSignal<{ left: number; top: number; right: number; bottom: number } | undefined>();
export { penToolsAt, setPenToolsAt };
/**
 * Everything of the app's own tools that stands over the canvas, as boxes on the canvas's screen, when
 * the app draws them on its page: the column, the properties panel, a tray. For what the canvas does
 * about being covered (Studio glides a selection clear of them); unset where the tools share the
 * canvas's document and can be measured there.
 */
const [penCovers, setPenCovers] = createSignal<readonly { left: number; top: number; right: number; bottom: number }[] | undefined>();
export { penCovers, setPenCovers };

/**
 * How many of the tools' popups are open that Escape closes before it does anything else (the colour
 * picker, open over a selection that stays). They hear Escape on their own document; while the page
 * draws the tools and the keyboard is with the canvas, the frame passes Escape on rather than acting
 * on it (`frame/inside/page-events.ts`).
 */
const [penHolds, setPenHolds] = createSignal(0);
export { penHolds, setPenHolds };
/** Hold Escape for a popup while it is open; call what comes back when it shuts. */
export function holdEscape(): () => void {
	setPenHolds((count) => count + 1);
	return () => setPenHolds((count) => Math.max(0, count - 1));
}
/**
 * What is selected, as the canvas has it now, for a properties panel that is not where the canvas is:
 * a small drawing holding the selected items whole, what its arrows join, and the drawing's variables,
 * with the person's own edits in it before the server has confirmed them. An app that draws its tools
 * on its page is told it by the canvas frame (`frame/tools-mirror.ts`): its own copy of the drawing
 * runs a round trip behind, and on a slow line an item just made would have no properties until then.
 */
const [penPicked, setPenPicked] = createSignal<PenDocument | undefined>();
export { penPicked, setPenPicked };
/** On a touch screen the properties drawer opens only when asked, from the pill or the hold menu (`Properties.tsx`, `Callout.tsx`); elsewhere the panel shows with the selection. */
const [propsOpen, setPropsOpen] = createSignal(false);

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
 * The stage draws it without saving it (`view/CanvasView.tsx`, `penLayer.preview`), so the colour
 * changes under the pointer while the drag is still one edit to the file and not sixty. Cleared by
 * the stage when the drawing comes back with the change in it.
 */
const [penLive, setPenLive] = createSignal<readonly { id: string; set: Record<string, unknown> }[] | undefined>();

/**
 * The hand: while it is on, a press on the canvas pans it, as holding Space does (`CanvasView.tsx`).
 * A host's tool column turns it on; nothing in the stage turns it off.
 */
const [handTool, setHandTool] = createSignal(false);

/**
 * How the arrow tool draws a new arrow: its route, and whether it has heads. A line is an arrow
 * with no heads, straight.
 */
export type ArrowStyle = { route: "straight" | "curved" | "elbow"; heads?: "end" | "none" };
const [penArrowStyle, setPenArrowStyle] = createSignal<ArrowStyle>({ route: "curved" });

export { handTool, setHandTool, penArrowStyle, setPenArrowStyle };
export { insertPanel, penBoxes, penIcon, penLive, penSelection, penShape, penTool, penTyping, propsOpen, setInsertPanel, setPenBoxes, setPenIcon, setPenLive, setPenSelection, setPenShape, setPenTool, setPenTyping, setPropsOpen };
