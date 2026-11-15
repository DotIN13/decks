// The agent to open when the page opens: the one the harness last had on
// screen (runtime.get), else the one this browser last opened.

const KEY = "decks.focused";

export function keepFocus(id: string): void {
	try {
		localStorage.setItem(KEY, id);
	} catch {
		// Private mode: a reload opens the first agent.
	}
}

/** The agent to open first: the harness's, else the one this browser kept, when still here; else the first. */
export function firstFocus(ids: readonly string[], harness?: string): string | undefined {
	if (harness && ids.includes(harness)) return harness;
	let kept: string | null = null;
	try {
		kept = localStorage.getItem(KEY);
	} catch {
		kept = null;
	}
	return kept && ids.includes(kept) ? kept : ids[0];
}
