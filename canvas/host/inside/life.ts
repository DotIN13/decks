/**
 * The life of one canvas in the frame: what a canvas starts here (its listeners on the window, its line to
 * the harness) is tied to this signal, and ends with it when the frame moves to another canvas in place
 * (`frame.tsx`, the page's `reset`). A frame that only ever shows one canvas never ends it.
 */
let current = new AbortController();

/** The signal of the canvas the frame shows now: pass it to `addEventListener`, stop on its `abort`. */
export function life(): AbortSignal {
	return current.signal;
}

/** End the canvas's life: its listeners come off and its line stops. The next canvas starts a new one. */
export function endLife(): void {
	current.abort();
	current = new AbortController();
}
