// A layer of the canvas built once and untracked: what its builder reads at its top does not rebuild it.
import { untrack } from "solid-js";

/**
 * Build `make`'s nodes once, reading nothing reactively at the top. A builder called where JSX
 * expects a child runs in a render effect; a signal read at its top would rebuild the whole layer,
 * every card in it, at each change. Inside, bindings and children still update as they do.
 */
export function builtOnce<T>(make: () => T): T {
	return untrack(make);
}
