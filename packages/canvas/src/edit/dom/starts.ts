import { untrack } from "solid-js";
import type { Pt } from "../core/model.ts";
import type { Handle } from "../core/resize.ts";
import { pointerInput, type Editor } from "./controller.ts";
import { type Client, type PointerHost } from "./pointer.ts";

/** What `createStarts` reads of `createPointer` (`pointer.ts`), each read when it is used. */
export interface StartsNeeds {
	readonly editor: Editor;
	readonly worldAt: (event: Client) => Pt;
	readonly followEditor: (event: PointerEvent, on?: HTMLElement) => void;
	readonly host: PointerHost;
	readonly fingerIn: (event: PointerEvent) => void;
}

export function createStarts(d: StartsNeeds) {
	/**
	 * A press on a board's title bar (`PageFrame`), with a mouse or a pen: the stage moves it, so it
	 * moves with whatever else is selected and snaps like everything else. Shift adds the board to the
	 * selection or takes it out. A finger's drag stays the board's own, where a pinch can take it back.
	 */
	const dragPage = (path: string, event: PointerEvent, on = event.currentTarget as HTMLElement): boolean => {
		if (event.button !== 0) return false;
		event.stopPropagation();
		event.preventDefault();
		if (d.editor.input({ type: "press-board", path, ...pointerInput(event, d.worldAt(event)) })) d.followEditor(event, on);
		return true;
	};

	/** A board selected by a press on it, as `PageFrame`'s own `onSelect` does: alone, unless it is part of the selection already. */
	const selectPage = (path: string) => {
		if (!untrack(d.editor.pagePicks).includes(path) && (untrack(d.editor.pagePicks).length || untrack(d.editor.items).length)) {
			d.editor.pickPages([]);
			d.editor.select([]);
		}
		d.host.onSelect(path);
	};

	/** An item's handle dragged (`editor/core/gesture.ts`, `resize`); two presses on a frame's top or bottom handle hug it again. */
	const resizeFrom = (event: PointerEvent, handle: Handle) => {
		const box = d.host.handles.item();
		if (event.button !== 0 || !box) return;
		event.preventDefault();
		event.stopPropagation();
		d.fingerIn(event);
		if (d.editor.input({ type: "press-handle", handle, box, ...pointerInput(event, d.worldAt(event)) })) d.followEditor(event);
	};

	/**
	 * How round the corners are, dragged. The handle starts inside the top-left corner; pulling it
	 * along the diagonal rounds every corner by as much, up to half the shorter side, where the
	 * straight sides are gone. A shape from the library keeps it in its own `metadata.radius`, which
	 * is what redraws its outline (`@decks/pen`, `fitShapes`); pen's rectangle and frame have a
	 * `cornerRadius` of their own. It is written on the lift, not while dragging, so one drag is one
	 * edit in the file's history.
	 */
	const radiusFrom = (event: PointerEvent) => {
		const start = d.host.handles.radius();
		if (event.button !== 0 || !start) return;
		event.preventDefault();
		event.stopPropagation();
		d.fingerIn(event);
		if (d.editor.input({ type: "press-radius", handle: start, ...pointerInput(event, d.worldAt(event)) })) d.followEditor(event);
	};

	/**
	 * A board's handles, as an item's: every edge and corner, snapping to what is around, ⌘ or Ctrl
	 * to not snap, Shift to keep the shape. The board is drawn at the new box at once; letting go
	 * moves it if a left or top edge was dragged, and writes the size to its file, and the box is held
	 * until the board is at it (`editor/core/gesture.ts`, `landPageResize`).
	 */
	const resizePage = (event: PointerEvent, handle: Handle) => {
		const box = d.host.handles.card();
		if (event.button !== 0 || !box) return;
		event.preventDefault();
		event.stopPropagation();
		d.fingerIn(event);
		if (d.editor.input({ type: "press-board-handle", handle, box, ...pointerInput(event, d.worldAt(event)) })) d.followEditor(event);
	};

	/**
	 * An arrow's end, picked up and put down somewhere else: on an item or a board it joins it, and
	 * follows it from then on; on bare canvas it stays at that point. Along the side it joins, the
	 * drag slides the join. What it would join lights up while it is carried, as it does while the
	 * arrow is drawn. A double-click on a joined end puts the join back in the middle of its side.
	 */
	const dragArrowEnd = (event: PointerEvent, which: "from" | "to") => {
		const ends = d.host.handles.arrow();
		if (event.button !== 0 || !ends) return;
		event.preventDefault();
		event.stopPropagation();
		d.fingerIn(event);
		if (d.editor.input({ type: "press-arrow-end", which, ends, ...pointerInput(event, d.worldAt(event)) })) d.followEditor(event);
	};

	/**
	 * The handle in an arrow's middle, dragged: an elbow's middle segment slides along its run, a
	 * curve's middle is pulled, and a straight line pulled there becomes a curve (`bendAt`). A
	 * double-click puts it back on the automatic route.
	 */
	const dragArrowBend = (event: PointerEvent) => {
		const ends = d.host.handles.arrow();
		if (event.button !== 0 || !ends?.middle) return;
		event.preventDefault();
		event.stopPropagation();
		d.fingerIn(event);
		if (d.editor.input({ type: "press-arrow-bend", ends, ...pointerInput(event, d.worldAt(event)) })) d.followEditor(event);
	};

	/** A press on a block's grip picks the block up and carries it, into another place in the card or out of it. */
	const dragBlock = (event: PointerEvent, id: string) => {
		event.preventDefault();
		event.stopPropagation();
		d.fingerIn(event);
		const on = event.currentTarget as HTMLElement;
		if (d.editor.input({ type: "press-block", id, ...pointerInput(event, d.worldAt(event)) })) d.followEditor(event, on);
	};

	return {
		dragPage,
		selectPage,
		dragBlock,
		resizeFrom,
		radiusFrom,
		resizePage,
		dragArrowEnd,
		dragArrowBend,
	};
}
