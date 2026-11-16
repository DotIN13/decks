import { type InkStroke } from "./shaper.ts";

/**
 * Undo and redo for one item's ink: the lists it has been, and where in them it is now. Whole lists,
 * not inverse operations: strokes are shared between lists, so a step costs an array of references
 * and every step is only "the list is now this".
 */
export interface InkHistory {
	past: InkStroke[][];
	present: InkStroke[];
	future: InkStroke[][];
}
const HISTORY_DEPTH = 200;
export function inkHistory(present: InkStroke[] = []): InkHistory {
	return { past: [], present, future: [] };
}
export function inkCommit(history: InkHistory, next: InkStroke[]): InkHistory {
	return { past: [...history.past, history.present].slice(-HISTORY_DEPTH), present: next, future: [] };
}
export function inkUndo(history: InkHistory): InkHistory {
	const previous = history.past[history.past.length - 1];
	if (!previous) return history;
	return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}
export function inkRedo(history: InkHistory): InkHistory {
	const [next, ...rest] = history.future;
	if (!next) return history;
	return { past: [...history.past, history.present], present: next, future: rest };
}
