/**
 * The keys of the drawing, in edit mode, decided: given the key and its modifiers, what is
 * selected and the tool in hand, what the key does — the ops it writes, what is selected after,
 * the tool it arms. Whether the key reaches here at all (a text box with the caret, the pen out)
 * and doing what it says are the page's.
 *
 * Delete and Backspace, the arrows (1 px, 10 with Shift) and ⌘D act on what is selected; ⌘Z and
 * ⇧⌘Z step through the person's own edits; Escape puts the tool down, then lets go; a letter arms
 * a tool (`PEN_TOOL_KEYS`).
 */
import type { Op } from "@decks/pen";
import { PEN_TOOL_KEYS, type PenTool } from "./model.ts";
import { childrenOf, parentOf } from "./pick.ts";
import { boardMoves, deleteOps, duplicateOps, moveOps, type BoardMove, type NextId } from "./ops.ts";
import type { SceneQuery } from "./scene.ts";

/** A key as it was pressed: `KeyboardEvent.key` and the modifiers held. */
export type KeyPress = { key: string; meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean };

/** What a key acts on. */
export type KeyContext = {
	/** The selected items, in the order they were picked. */
	selection: readonly string[];
	/** The selected boards (the drawing's own picks, moved by the arrows with the items). */
	boards: readonly string[];
	tool: PenTool;
	/** Whether a board is selected as the page's own selection: its letters are the board's, not tools. */
	boardSelected: boolean;
	/** That board, which the arrows move with the rest of what is selected. */
	selectedBoard?: string | undefined;
	/** Whether the page can step through edits (undo, redo). */
	canStep: boolean;
	scene: SceneQuery;
	/** Ids for what a duplicate makes. */
	nextId: NextId;
};

/** What a key does, when it is one of the drawing's. */
export type KeyAct =
	| { handled: false }
	| { handled: true; do: "step"; step: "undo" | "redo" }
	/** The selection taken off the canvas; it is let go once the sheet has drawn without it. */
	| { handled: true; do: "delete"; ops: Op[]; select: [] }
	/** A tool in hand is put down; with none, the selection is let go. */
	| { handled: true; do: "escape"; tool: "select" }
	| { handled: true; do: "escape"; select: []; boards: [] }
	/** Copies of the selection, selected in its place once they arrive. */
	| { handled: true; do: "duplicate"; ops: Op[]; select: string[] }
	| { handled: true; do: "nudge"; ops: Op[]; boards: BoardMove[] }
	/** Another selection: the parents of what is selected (⇧Enter), or its children (Enter). */
	| { handled: true; do: "select"; select: string[] }
	| { handled: true; do: "arm"; tool: PenTool };

const NUDGES: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
/** How far Shift and an arrow move what is selected; the arrow alone moves it 1. */
export const NUDGE_SHIFT = 10;

export function penKey(press: KeyPress, context: KeyContext): KeyAct {
	const { selection, boards, tool } = context;
	const command = !!(press.meta || press.ctrl);
	const alt = !!press.alt;
	const key = press.key;
	if (command && !alt && key.toLowerCase() === "z" && context.canStep) return { handled: true, do: "step", step: press.shift ? "redo" : "undo" };
	if (selection.length && (key === "Delete" || key === "Backspace")) return { handled: true, do: "delete", ops: deleteOps(selection, context.scene), select: [] };
	if (key === "Escape" && (selection.length || boards.length || tool !== "select")) return tool !== "select" ? { handled: true, do: "escape", tool: "select" } : { handled: true, do: "escape", select: [], boards: [] };
	if (selection.length && command && !alt && key.toLowerCase() === "d") {
		const { ops, made } = duplicateOps(context.scene, selection, context.nextId);
		return { handled: true, do: "duplicate", ops, select: made };
	}
	/*
	 * ⇧Enter climbs to what the selection sits in, Enter goes down into what it holds: a group's or
	 * a frame's children, never the parts of what is one thing (a shape, a file, a card).
	 */
	if (key === "Enter" && selection.length && !command && !alt) {
		const next = press.shift ? selection.map((id) => parentOf(context.scene, id)).filter((id): id is string => !!id) : selection.flatMap((id) => childrenOf(context.scene, id));
		const unique = [...new Set(next)];
		if (unique.length) return { handled: true, do: "select", select: unique };
		return { handled: false };
	}
	const nudge = NUDGES[key];
	// The boards picked with the drawing, and the board selected on its own (a press on it).
	const moving = context.selectedBoard && !boards.includes(context.selectedBoard) ? [...boards, context.selectedBoard] : boards;
	if ((selection.length || moving.length) && nudge && !command && !alt) {
		const step = press.shift ? NUDGE_SHIFT : 1;
		const dx = nudge[0] * step;
		const dy = nudge[1] * step;
		return { handled: true, do: "nudge", ops: moveOps(context.scene, selection, dx, dy), boards: boardMoves(context.scene.boards(), moving, dx, dy) };
	}
	/*
	 * The letters that arm a tool: from the app's own document only — never forwarded from a
	 * board's (`shortcut`) — and only while no board is selected. Words typed over a board with
	 * nothing editable under them fall through to the stage, and an armed tool takes the boards'
	 * pointer away: "Zoo" typed there armed the ellipse, and the next click drew one instead of
	 * selecting what was under it. With a board selected the keys are the board's; a press on
	 * bare canvas lets it go, and then they are the drawing's.
	 */
	const armed = !command && !alt && !context.boardSelected ? PEN_TOOL_KEYS[key] : undefined;
	if (armed) return { handled: true, do: "arm", tool: armed };
	return { handled: false };
}
