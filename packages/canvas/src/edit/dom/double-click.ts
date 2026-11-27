import { TEXTY } from "../core/text.ts";
import type { Editor } from "./controller.ts";
import { mediaOf } from "@decks/pen";
import { MADE_MS, PANNED_MS } from "../core/dispatch.ts";
import type { Pt } from "../core/model.ts";
import { type Picked, type PickOptions } from "../core/pick.ts";
import type { Client, PointerHost } from "./pointer.ts";

/** What `createDoubleClick` reads of `createPointer` (`pointer.ts`), each read when it is used. */
export interface DoubleClickNeeds {
	readonly pressedOn: EventTarget | null;
	readonly host: PointerHost;
	readonly pickAtHere: (at: Pt, options?: PickOptions) => Picked | undefined;
	readonly worldAt: (event: Client) => Pt;
	readonly onDrawn: (target: EventTarget | null) => boolean;
	readonly onCanvas: (target: EventTarget | null) => boolean;
	readonly editor: Editor;
	readonly pictureUnder: (event: Client) => string | undefined;
	readonly pannedAt: number;
}

export function createDoubleClick(d: DoubleClickNeeds) {
	/**
	 * A double-click on empty canvas: a note there, open for typing — what the Note tool and a
	 * click there make (`InsertMenu`'s `noteAt`). A double-click on an item reaches into it instead.
	 *
	 * "Empty" is the canvas's own element with no card's picture under the point: not a card, its
	 * title bar, something drawn, or anything laid over the drawing (the editor a note's words are
	 * typed in is one, and a double-click there picks a word).
	 */
	const onDblClick = (event: MouseEvent) => {
		// Pressed on something else (a handle whose edit moved it away): not a double-click on what is under the pointer now.
		// A press on the drawing's hit shapes is captured by the canvas, so its click lands on the canvas: the same place.
		// So is a press on a size handle that the first click put over a small item: the item is still under it.
		const sizer = (d.pressedOn as Element | null)?.closest?.(".pen-handle[data-handle]");
		const overItem = !!sizer && sizer.getAttribute("data-handle") !== "radius" && event.target === d.host.element() && !!d.pickAtHere(d.worldAt(event), { deep: true });
		const sameSpot = d.pressedOn === event.target || (d.onDrawn(d.pressedOn) && event.target === d.host.element()) || overItem;
		if (!sameSpot) return;
		if (d.host.editable() && !d.host.drawing() && d.onCanvas(event.target)) {
			// The second press of a quick double-click on a tool's first item is not a request for a note.
			if (performance.now() - d.host.madeAt() < MADE_MS) return;
			// A double-click reaches into what is one thing (a shape, a file, a card): words open for rewriting, anything else is selected on its own.
			const hit = d.pickAtHere(d.worldAt(event), { deep: true });
			// A film or a sound starts: a double-click is how a card is opened too, so it is the same gesture.
			// A film or a sound: its first press already started it, so the second is only a press.
			if (hit && mediaOf(hit.node)) {
				d.editor.select([hit.id]);
				return;
			}
			// A file shown live: a web page taken into, an SVG opened in a tab.
			if (hit && d.host.open.liveFile(hit.id)) return;
			// A file's chip opens the file, in a tab of its own.
			if (hit && d.host.open.file(hit.id)) return;
			// A card opens for typing: at the words, or with a new line in the gap that was double-clicked.
			if (hit && (hit.node.type !== "rectangle" || !d.host.open.cardOf(hit.id)) && d.host.open.cardAt(hit, d.worldAt(event), { x: event.clientX, y: event.clientY })) return;
			// A shape's words open for typing, and a shape with none gets them (`openShapeWords`).
			const shape = hit ? d.host.open.shapeOf(hit.id) : undefined;
			if (shape && !(hit && TEXTY.has(hit.node.type))) {
				d.host.open.shapeWords(shape);
				return;
			}
			if (hit && TEXTY.has(hit.node.type)) {
				d.host.open.text(hit);
				return;
			}
			if (hit && !d.editor.items().includes(hit.id)) {
				d.editor.select([hit.id]);
				return;
			}
		}
		// Nothing can be added where nothing can be written: a canvas opened from a file.
		if (!d.host.editable() || d.host.drawing()) return;
		if (event.target !== d.host.element() || d.pictureUnder(event)) return;
		// On an item that took none of the above (one already selected, say): it is not empty canvas.
		if (d.pickAtHere(d.worldAt(event), { deep: true })) return;
		if (performance.now() - d.pannedAt < PANNED_MS) return;
		// A finger's two taps already made it (`tapToDeselect`); a touch screen's own dblclick is the same gesture.
		if (performance.now() - d.host.madeAt() < MADE_MS) return;
		d.host.noteAt(event);
	};

	return {
		onDblClick,
	};
}
