// What every part of the gesture reducer stands on: how long things wait, the drag that is none, and
// the selection changed. Below gesture.ts and the gesture-*.ts parts, so none of them imports another's values in a loop.
import type { EditorState, Offset } from "./model.ts";

// How long things wait.
/** How long a let-go gesture waits for the drawing that answers it before its preview goes anyway. */
export const SETTLE_MS = 2000;
/** How long a let-go radius is held for the drawing to have it. */
export const RADIUS_HOLD_MS = 3000;
/** How long a let-go board size is held for the board to be at it. */
export const PAGE_HOLD_MS = 4000;
/** Two presses on one handle within this long, with no drag: the handle's double-click. */
export const HANDLE_TAP_MS = 400;

// The drag that is none.
/** No offset: the drag when nothing is carried. */
export const ZERO: Offset = { dx: 0, dy: 0 };
/** The drag's offset and the resized outline gone: the drawing has the change, or has given up waiting. */
export const landed = (state: EditorState): EditorState => ({ ...state, drag: ZERO, resize: undefined, shownResize: undefined });

// The selection.
/** The selection with its items, its boards, or both replaced. */
export function withSelection(state: EditorState, next: { items?: readonly string[]; boards?: readonly string[] }): EditorState {
	return { ...state, selection: { ...state.selection, ...(next.items ? { items: next.items } : {}), ...(next.boards ? { boards: next.boards } : {}) } };
}
/** Select what was just asked for, which the drawing does not have until the server answers. */
export function selectMade(state: EditorState, made: readonly string[]): EditorState {
	return { ...state, selection: { ...state.selection, items: made, awaited: [...new Set([...state.selection.awaited, ...made])] } };
}
