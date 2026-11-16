import type { AgentMode } from "@decks/protocol";

// What picking a row of the mode menu does.

/** A row was picked: tell the shell, then close the menu it was picked from. */
export function pickMode(mode: AgentMode, onMode: (mode: AgentMode) => void, dismiss: (() => void) | undefined): void {
	onMode(mode);
	dismiss?.();
}
