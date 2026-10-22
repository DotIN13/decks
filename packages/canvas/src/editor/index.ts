/**
 * The editor, as the stage (`canvas/Stage.tsx`) uses it: the one way in. `createStageEditor` puts
 * the state (`dom/controller.ts`), the pointer (`dom/pointer.ts`), the keys (`dom/keys.ts`), the
 * typing (`dom/TextEditing.tsx`) and the adding (`dom/InsertMenu.tsx`) together as one object; the
 * rest is what the stage still does with the editor's pieces itself (the overlay's parts, the ops
 * the pill and the ink write), until those move in too.
 */
import { createEditor, type EditorHost } from "./dom/controller.ts";
import { createInsertMenu, type InsertHost } from "./dom/InsertMenu.tsx";
import { createKeys, type KeysHost } from "./dom/keys.ts";
import { createPointer, type Pointer, type PointerHost } from "./dom/pointer.ts";
import { createTextEditing, type TextHost } from "./dom/TextEditing.tsx";

export type StageEditorHost = Omit<EditorHost, "effects"> & {
	/** The page's side of the effects, but for the camera having been dragged, which the pointer keeps. */
	effects: Omit<EditorHost["effects"], "panned">;
	/** The pointer's host, but for what the typing and the adding answer themselves. */
	pointer: Omit<PointerHost, "scene" | "typing" | "make" | "madeAt" | "noteAt" | "open"> & { open: Pick<PointerHost["open"], "liveFile"> };
	keys: Omit<KeysHost, "scene" | "nextIds" | "edit">;
	text: Omit<TextHost, "scene" | "engine" | "edit" | "nextIds">;
	insert: Omit<InsertHost, "scene" | "zoom" | "edit" | "follow">;
};

/** The stage's editor: its state and what reads it, the pointer's handlers, the drawing's keys (`key`), the typing (`textEditing`) and the adding (`insert`). */
export function createStageEditor(host: StageEditorHost) {
	let pointer: Pointer | undefined;
	const editor = createEditor({ ...host, effects: { ...host.effects, panned: () => pointer?.panned() } });
	const text = createTextEditing(editor, { ...host.text, scene: host.scene, engine: host.engine, edit: host.onPenEdit, nextIds: host.nextIds });
	const insert = createInsertMenu(editor, text, { ...host.insert, scene: host.scene, zoom: host.zoom, edit: host.onPenEdit, follow: (event, move, done) => pointer!.follow(event, move, done) });
	pointer = createPointer(editor, {
		...host.pointer,
		scene: host.scene,
		typing: editor.typing,
		make: (event, tool, at) => insert.create(event, tool, at),
		madeAt: insert.madeAt,
		noteAt: insert.noteAt,
		open: {
			liveFile: host.pointer.open.liveFile,
			file: text.openFileOf,
			cardAt: text.openCardAt,
			shapeWords: text.openShapeWords,
			text: text.openPenText,
			shapeOf: text.shapeOf,
			cardOf: text.cardOf,
		},
	});
	const keys = createKeys(editor, { ...host.keys, scene: host.scene, nextIds: host.nextIds, edit: host.onPenEdit });
	return { ...editor, ...pointer, key: keys.key, textEditing: text, insert };
}
export type StageEditor = ReturnType<typeof createStageEditor>;

export type { BoardView, Openers } from "./dom/pointer.ts";
export { OverlayLayer, ANCHOR_OUT, ANCHOR_PX } from "./dom/OverlayLayer.tsx";
export { TextEditor } from "./dom/TextEditing.tsx";
export { InsertMenu } from "./dom/InsertMenu.tsx";
export { tsScene, tsSeam } from "./scene-ts.ts";
export { dropSlot, frameUnder } from "./core/drop.ts";
export { deleteOps, duplicateOps, idMaker, moveOps } from "./core/ops.ts";
export { arrowAnchors, arrowEnds, boardHandles, distances, dropBox, glideShift, gripBox, gripHidden, hoverBox, itemHandles, kinOutlines, radiusHandle, selectionFrame, selectionOutlines, type Overlay } from "./core/overlay.ts";
export type { PenTool } from "./core/model.ts";
