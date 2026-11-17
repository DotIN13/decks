/**
 * The life of what a frame shows: what it starts there (its listeners on the window, its line to the
 * harness) is tied to this signal, and ends with it when the frame is begun anew on something else in
 * place (`guest.ts`, the page's `reset`). A frame that only ever shows one thing never ends it.
 */
let current = new AbortController();

/** The signal of what the frame shows now: pass it to `addEventListener`, stop on its `abort`. */
export function life(): AbortSignal {
	return current.signal;
}

/** End its life: its listeners come off and its line stops. What is shown next starts a new one. */
export function endLife(): void {
	current.abort();
	current = new AbortController();
}
