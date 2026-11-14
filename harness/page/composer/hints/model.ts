/** The key that queues while the agent works: Command on a Mac, Control elsewhere. */
export function queueKey(platform: string): string {
	return /Mac/.test(platform) ? "⌘" : "Ctrl";
}

/** Which of the hint rows to show: the menu's keys, or sending, steering and queueing. */
export function hintSet(state: { menuOpen: boolean; busy?: boolean }): "menu" | "busy" | "idle" {
	return state.menuOpen ? "menu" : state.busy ? "busy" : "idle";
}
