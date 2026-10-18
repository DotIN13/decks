/**
 * The drawing's keys on the page: `core/keys.ts` decides what a key does, and this does it — the
 * ops sent, the selection and the tool set, an edit stepped through, the boards nudged.
 *
 * The stage's keydown asks here first (`key`), after its own guards (a text box with the caret, a
 * board being edited); a key that was one of the drawing's goes no further.
 */
import type { Op } from "@decks/pen";
import { penKey as penKeyOf, type KeyAct } from "../core/keys.ts";
import type { PenTool } from "../core/model.ts";
import type { NextId } from "../core/ops.ts";
import type { SceneQuery } from "../core/scene.ts";
import type { Editor } from "./controller.ts";

export type KeysHost = {
	scene: SceneQuery;
	/** Whether the drawing can be edited here (`Stage`'s `onPenEdit`). */
	editable: () => boolean;
	/** The draw tool is out: the keys are the ink's. */
	drawing: () => boolean;
	tool: () => PenTool;
	/** Whether a board is the app's selection: its letters are the board's. */
	boardSelected: () => boolean;
	/** Step through the person's own edits, when the page can (`Stage`'s `onPenStep`). */
	canStep: () => boolean;
	step: (direction: "undo" | "redo") => void;
	edit: (ops: Op[]) => void;
	/** Take the selected items off the canvas, with these ops (`Stage`'s `penDeleteSelected`). */
	deleteSelected: (selected: readonly string[], ops: Op[]) => void;
	setTool: (tool: PenTool) => void;
	/** Arm a tool from its key: the board palette's tool goes down first. */
	arm: (tool: PenTool) => void;
	onMove: (path: string, x: number, y: number) => void;
	nextIds: () => NextId;
};

export function createKeys(editor: Editor, host: KeysHost) {
	/** The keys of the drawing, in edit mode (`editor/core/keys.ts` decides, this does it); true when the key was one of them. */
	const penKey = (event: KeyboardEvent): boolean => {
		const selected = editor.items();
		// The document's ids are gathered only for a key that makes something (⌘D).
		let ids: (() => string) | undefined;
		const act: KeyAct = penKeyOf(
			{ key: event.key, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey },
			{ selection: selected, boards: editor.boardPicks(), tool: host.tool(), boardSelected: host.boardSelected(), canStep: host.canStep(), scene: host.scene, nextId: () => (ids ??= host.nextIds())() },
		);
		if (!act.handled) return false;
		switch (act.do) {
			case "step":
				host.step(act.step);
				break;
			case "delete":
				host.deleteSelected(selected, act.ops);
				break;
			case "escape":
				if ("tool" in act) host.setTool(act.tool);
				else {
					editor.select(act.select);
					editor.pickBoards(act.boards);
				}
				break;
			case "duplicate":
				host.edit(act.ops);
				if (act.select.length) editor.selectMade(act.select);
				break;
			case "nudge":
				host.edit(act.ops);
				for (const move of act.boards) host.onMove(move.path, move.x, move.y);
				break;
			case "arm":
				host.arm(act.tool);
				break;
		}
		return true;
	};
	/**
	 * The drawing's own keys, in either mode but not while drawing. None of them fire while a text box has the caret
	 * (the stage's guard). Delete, the arrows and ⌘D act on what is selected; ⌘Z and ⇧⌘Z step through the
	 * person's own edits; Escape lets go, then puts the tool down; a letter arms a tool
	 * (`PEN_TOOL_KEYS`), from this document only. True when the key was the drawing's.
	 */
	const key = (event: KeyboardEvent): boolean => host.editable() && !host.drawing() && penKey(event);
	return { key };
}
