import { inkCommit, inkHistory, inkRedo, inkUndo, type InkColor, type InkHistory, type InkStroke } from "@decks/board-kit";
import { createSignal, type Signal } from "solid-js";
import { patchBoard } from "./patches.ts";

/**
 * Drawing on boards: the tool in hand, and what each board has on it.
 *
 * The strokes live in the board's file (`@decks/board-kit`, `ink.ts`), and a frame reads them
 * out of its own document when it loads. This module is what sits between: the list each
 * frame should be showing right now, the undo history behind it, and the one write path,
 * `patchBoard` with an `ink` op, that every change goes down.
 */

export type InkTool = "pen" | "marker" | "eraser" | "lasso";

/** Whether the draw tool is on. Only ever true in browse mode: editing turns it off. */
const [drawing, setDrawing] = createSignal(false);
const [inkTool, setInkTool] = createSignal<InkTool>("pen");
const [inkColor, setInkColor] = createSignal<InkColor>("ink");
/** One of three widths, by index, so the pen and the marker each keep a sensible set. */
const [inkWidth, setInkWidth] = createSignal(1);
/**
 * A stylus has touched the glass in this session.
 *
 * From then on a finger moves the canvas and only the pencil draws, which is what a tablet's
 * own notes app does: the hand that holds the pencil rests on the screen.
 */
const [penSeen, setPenSeen] = createSignal(false);

export { drawing, setDrawing, inkTool, setInkTool, inkColor, setInkColor, inkWidth, setInkWidth, penSeen, setPenSeen };

export const INK_WIDTHS: Record<"pen" | "marker", [number, number, number]> = { pen: [2, 4, 8], marker: [12, 20, 32] };

/** The width the tool in hand draws at, in board pixels. */
export function inkSize(): number {
	const tool = inkTool();
	return INK_WIDTHS[tool === "marker" ? "marker" : "pen"][inkWidth()] ?? 4;
}

/**
 * What each board is showing: the committed list, or a preview while an erase or a move is
 * under way. A signal per board holding plain arrays, not a store: a stroke is never changed
 * once drawn, the same objects sit in every undo step, and a store would edit them in place.
 */
const lists = new Map<string, Signal<InkStroke[]>>();
function listOf(path: string): Signal<InkStroke[]> {
	let list = lists.get(path);
	if (!list) {
		list = createSignal<InkStroke[]>([]);
		lists.set(path, list);
	}
	return list;
}
const show = (path: string, strokes: InkStroke[]) => listOf(path)[1](strokes);
const histories = new Map<string, InkHistory>();
/** Bumped whenever a history moves, so the undo and redo buttons know to look again. */
const [moved, setMoved] = createSignal(0);

/** The board last drawn on: what undo, redo and delete in the toolbar act on. */
const [inkBoard, setInkBoard] = createSignal<string | undefined>(undefined);
const [inkSelection, setInkSelection] = createSignal<{ path: string; ids: string[] } | undefined>(undefined);

export { inkBoard, setInkBoard, inkSelection, setInkSelection };

export function inkOf(path: string): InkStroke[] {
	return listOf(path)[0]();
}

const same = (a: InkStroke[], b: InkStroke[]) => a.length === b.length && JSON.stringify(a) === JSON.stringify(b);

/**
 * What a frame found in its document when it loaded.
 *
 * The same list this module already holds is our own write coming back, and the history
 * stays. Anything else is somebody else's file now, an agent's rewrite or another browser's
 * drawing, and an undo stack composed against a list that no longer exists would put strokes
 * back that the file's writer took out. So it starts again from what is there.
 */
export function adoptInk(path: string, strokes: InkStroke[]): void {
	const held = histories.get(path);
	if (held && same(held.present, strokes)) return;
	histories.set(path, inkHistory(strokes));
	show(path, strokes);
	if (inkSelection()?.path === path) setInkSelection(undefined);
	setMoved((n) => n + 1);
}

/** Show a list without making it a step: an erase or a move that has not been let go of yet. */
export function previewInk(path: string, strokes: InkStroke[]): void {
	show(path, strokes);
}

function land(path: string, history: InkHistory): void {
	histories.set(path, history);
	show(path, history.present);
	setInkBoard(path);
	setMoved((n) => n + 1);
	patchBoard(path, [{ op: "ink", strokes: history.present }]);
}

/** The list is now this: one undo step, and one write to the file. */
export function commitInk(path: string, strokes: InkStroke[]): void {
	const held = histories.get(path) ?? inkHistory([]);
	if (same(held.present, strokes)) {
		// A preview that ended where it began: put the committed list back on screen.
		show(path, held.present);
		return;
	}
	land(path, inkCommit(held, strokes));
}

export function canUndoInk(): boolean {
	void moved();
	const path = inkBoard();
	return !!path && (histories.get(path)?.past.length ?? 0) > 0;
}

export function canRedoInk(): boolean {
	void moved();
	const path = inkBoard();
	return !!path && (histories.get(path)?.future.length ?? 0) > 0;
}

export function undoInk(): void {
	const path = inkBoard();
	const held = path ? histories.get(path) : undefined;
	if (!path || !held || held.past.length === 0) return;
	setInkSelection(undefined);
	land(path, inkUndo(held));
}

export function redoInk(): void {
	const path = inkBoard();
	const held = path ? histories.get(path) : undefined;
	if (!path || !held || held.future.length === 0) return;
	setInkSelection(undefined);
	land(path, inkRedo(held));
}

/** Remove the lassoed strokes. */
export function deleteInkSelection(): void {
	const selection = inkSelection();
	if (!selection || selection.ids.length === 0) return;
	const gone = new Set(selection.ids);
	setInkSelection(undefined);
	commitInk(selection.path, inkOf(selection.path).filter((stroke) => !gone.has(stroke.id)));
}

/** A board is gone: its history goes with it. */
export function forgetInk(path: string): void {
	histories.delete(path);
	lists.delete(path);
	if (inkBoard() === path) setInkBoard(undefined);
	if (inkSelection()?.path === path) setInkSelection(undefined);
}
