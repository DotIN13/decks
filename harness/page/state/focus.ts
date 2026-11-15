// The agent this browser last opened, so a reload comes back to it. Kept in
// this browser until the harness remembers it for every screen.

const KEY = "decks.focused";

export function keepFocus(id: string): void {
	try {
		localStorage.setItem(KEY, id);
	} catch {
		// Private mode: a reload opens the first agent.
	}
}

/** The agent to open first: the one kept, when it is still here, else the first. */
export function firstFocus(ids: readonly string[]): string | undefined {
	let kept: string | null = null;
	try {
		kept = localStorage.getItem(KEY);
	} catch {
		kept = null;
	}
	return kept && ids.includes(kept) ? kept : ids[0];
}
