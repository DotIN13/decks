/**
 * The editor, as the stage (`canvas/Stage.tsx`) uses it: the one way in. `createStageEditor` puts
 * the state (`dom/controller.ts`), the pointer (`dom/pointer.ts`) and the keys (`dom/keys.ts`)
 * together as one object; the rest is what the stage still does with the editor's pieces itself
 * (the overlay's parts, the ops a tool or the text editing writes), until those move in too.
 */
import { createEditor, type EditorHost } from "./dom/controller.ts";
import { createKeys, type KeysHost } from "./dom/keys.ts";
import { createPointer, type Pointer, type PointerHost } from "./dom/pointer.ts";

export type StageEditorHost = Omit<EditorHost, "effects"> & {
	/** The page's side of the effects, but for the camera having been dragged, which the pointer keeps. */
	effects: Omit<EditorHost["effects"], "panned">;
	pointer: Omit<PointerHost, "scene">;
	keys: Omit<KeysHost, "scene" | "nextIds" | "edit">;
};

/** The stage's editor: its state and what reads it, the pointer's handlers, and the drawing's keys (`key`). */
export function createStageEditor(host: StageEditorHost) {
	let pointer: Pointer | undefined;
	const editor = createEditor({ ...host, effects: { ...host.effects, panned: () => pointer?.panned() } });
	pointer = createPointer(editor, { ...host.pointer, scene: host.scene });
	const keys = createKeys(editor, { ...host.keys, scene: host.scene, nextIds: host.nextIds, edit: host.onPenEdit });
	return { ...editor, ...pointer, key: keys.key };
}
export type StageEditor = ReturnType<typeof createStageEditor>;

export type { BoardView, Openers } from "./dom/pointer.ts";
export { OverlayLayer, ANCHOR_OUT, ANCHOR_PX } from "./dom/OverlayLayer.tsx";
export { tsScene, tsSeam } from "./scene-ts.ts";
export { pictureAt } from "./core/pick.ts";
export { dropSlot, frameAt, frameUnder } from "./core/drop.ts";
export { joinAt, newArrowEnds, type Join } from "./core/arrows.ts";
export { arrowInsertOp, deleteOps, drawnOp, duplicateOps, idMaker, makeAtOp, moveOps, type MakeOptions } from "./core/ops.ts";
export { arrowAnchors, arrowEnds, boardHandles, dropBox, gripBox, gripHidden, hoverBox, itemHandles, radiusHandle, selectionOutlines, type Overlay } from "./core/overlay.ts";
export type { PenTool } from "./core/model.ts";
