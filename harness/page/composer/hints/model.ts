// Which keyboard hints show under the box, and the key that queues.

/** Which of the hint rows to show: the menu's keys, or sending, steering and queueing. */
export function hintSet(state: { menuOpen: boolean; busy?: boolean }): "menu" | "busy" | "idle" {
	return state.menuOpen ? "menu" : state.busy ? "busy" : "idle";
}

/** The key that queues while the agent works: Command on a Mac, Control elsewhere. */
export function queueKey(platform: string): string {
	return /Mac/.test(platform) ? "⌘" : "Ctrl";
}
