import type { AgentMode } from "@decks/protocol";

/** A row was picked: tell the shell, then close the menu it was picked from. */
export function pickMode(mode: AgentMode, onMode: (mode: AgentMode) => void, dismiss: (() => void) | undefined): void {
	onMode(mode);
	dismiss?.();
}
