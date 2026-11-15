import { createSignal } from "solid-js";

export type Scheme = "light" | "dark";

/**
 * The canvas's colour scheme: the one signal everything on the canvas reads its light or dark from.
 *
 * Only the value. Who decides it — a saved choice, the system's, the host's `dark` option — is the
 * host's business (`lib/theme.ts` in the Decks app keeps it in `localStorage` and follows the
 * system); the canvas only draws in it.
 */
const [scheme, setCanvasScheme] = createSignal<Scheme>("light");
export { scheme, setCanvasScheme };
