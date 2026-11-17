import { type SceneQuery } from "../edit/core/scene.ts";
import type { CanvasEngine } from "../render/engine.ts";
import { deleteOps, duplicateOps, type CanvasEditor } from "../edit/dom/index.ts";

/** What `createPenActions` reads of `createSelection` (`selection.tsx`), each read when it is used. */
export interface PenActionsNeeds {
	readonly editor: CanvasEditor;
	readonly scene: SceneQuery;
	readonly penLayer: CanvasEngine;
	readonly penEdit: (ops: unknown[]) => void;
	readonly freshIds: (...also: string[]) => () => string;
	readonly selectMade: (made: string[]) => void;
}

export function createPenActions(d: PenActionsNeeds) {
	/** Take the selected drawn items off the canvas: the Delete key, and the pill's Delete. */
	const penDeleteSelected = (selected = d.editor.items(), ops = deleteOps(selected, d.scene)) => {
		if (!selected.length) return;
		// Gone from the sheet at once, and its outline with it in the same frame, not one frame before it.
		d.penLayer.previews.hide(new Set(selected));
		const mark = d.penLayer.tiles.mark();
		d.penEdit(ops);
		const clear = () => d.editor.select((now) => (now === selected ? [] : now));
		d.editor.afterFrame(mark, clear);
		// A sheet that shows no frame (nothing painting) does not keep the outline.
		setTimeout(clear, 250);
	};

	const penDuplicate = () => {
		const { ops, made } = duplicateOps(d.scene, d.editor.items(), d.freshIds());
		d.penEdit(ops);
		if (made.length) d.selectMade(made);
	};

	return {
		penDuplicate,
		penDeleteSelected,
	};
}
