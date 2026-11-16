import { createSignal } from "solid-js";
import type { BackendInfo } from "../state/types/index.ts";

/**
 * What the backend on the other end can do, from the first frame of its greeting (`backend`).
 *
 * Until it has said, the answer is yes to everything: this server's own front end is drawn exactly as
 * it always was, and only a backend that says no takes controls away.
 */
const [backend, setBackend] = createSignal<BackendInfo | undefined>(undefined);

export { backend, setBackend };

export function can(what: keyof BackendInfo["can"]): boolean {
	return backend()?.can[what] ?? true;
}
