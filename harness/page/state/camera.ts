import type { Camera } from "./types/index.ts";
import { batch, createSignal } from "solid-js";

/*
 * Where the canvas is looking, kept in the browser. The server keeps a reading of it
 * (`camera/report.ts`) and never moves it; each conversation parks its own view (`state/views.ts`).
 */
const [camera, setCamera] = createSignal<Camera>({ x: 0, y: 0, zoom: 1 });

/** How long a glide takes, in milliseconds, when the camera is asked to glide rather than jump. */
export const GLIDE_MS = 500;

/**
 * The glide the app has been asked for, or nothing.
 *
 * A **request**, not a schedule: the canvas owns the pixels and the clock, so this carries a token
 * that tells one request from another plus the duration, and the canvas does the rest. Two moves
 * in a row give two tokens and the second wins — the loop interpolates from wherever the camera
 * *is*, so nothing travels backwards.
 */
const [glide, setGlide] = createSignal<{ token: number; ms: number } | undefined>(undefined);

/** A counter, because a token has to be a token: `0` is `undefined`'s job. */
let glides = 0;

/** Whether the person reading has asked for less movement. */
export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Move the camera — and *glide* to it when it is something else that decided where to look.
 *
 * `animate` is on for the two gestures that move the camera **for** you, a card link and a row in
 * the panel, and behind `decks.view.focus`/`decks.view.move`'s own `animate: true`. Everything you drive
 * yourself — a wheel, a pinch, a drag, the zoom menu — never comes through here at all, and must
 * not: smoothing input is lag, and the whole point of the pan work was to remove it.
 *
 * The two signals are written **together** on purpose. The camera is the destination and the glide
 * is the journey, and a reader that caught one without the other would see the view jump to where
 * it was going and then glide from where it already was.
 */
export function moveCamera(next: Camera, options?: { animate?: boolean; ms?: number }): void {
	const calm = reducedMotion();
	batch(() => {
		setCamera(next);
		setGlide(options?.animate && !calm ? { token: ++glides, ms: options.ms ?? GLIDE_MS } : undefined);
	});
}

export { camera, glide, setCamera };
