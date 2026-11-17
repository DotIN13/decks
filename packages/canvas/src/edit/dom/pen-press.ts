import type { Pt } from "../core/model.ts";
import { pointerInput, type Editor } from "./controller.ts";
import { type Client, type PointerHost } from "./pointer.ts";

/** What `createPenPress` reads of `createPointer` (`pointer.ts`), each read when it is used. */
export interface PenPressNeeds {
	readonly worldAt: (event: Client) => Pt;
	readonly host: PointerHost;
	readonly editor: Editor;
	readonly followEditor: (event: PointerEvent, on?: HTMLElement) => void;
}

export function createPenPress(d: PenPressNeeds) {
	/**
	 * A press on the drawing; true when it was the drawing's to handle. A tool makes its item; with
	 * the select tool the editor picks up what is under the press, or draws a marquee on bare canvas.
	 */
	const penPress = (event: PointerEvent): boolean => {
		const at = d.worldAt(event);
		const tool = d.host.tool();
		if (tool !== "select") {
			event.preventDefault();
			d.host.onSelect(undefined);
			d.editor.pickPages([]);
			d.host.make(event, tool, at);
			return true;
		}
		event.preventDefault();
		if (d.editor.input({ type: "press-canvas", ...pointerInput(event, at) })) d.followEditor(event);
		return true;
	};

	return {
		penPress,
	};
}
