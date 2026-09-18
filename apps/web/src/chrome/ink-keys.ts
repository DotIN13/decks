/**
 * What a key means while the draw tool is on, or `undefined` for a key that is not its.
 *
 * Pure, so the table is tested rather than pressed: ⌘Z and Ctrl+Z undo, the shifted pair and
 * Ctrl+Y redo, Delete and Backspace remove what the lasso holds, Escape lets go.
 */
export type InkKey = "undo" | "redo" | "delete" | "escape";

export function inkKey(event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): InkKey | undefined {
	const command = event.metaKey || event.ctrlKey;
	const key = event.key.toLowerCase();
	if (command && !event.altKey && key === "z") return event.shiftKey ? "redo" : "undo";
	if (command && !event.altKey && !event.shiftKey && key === "y") return "redo";
	if (command || event.altKey) return undefined;
	if (key === "delete" || key === "backspace") return "delete";
	if (key === "escape") return "escape";
	return undefined;
}
