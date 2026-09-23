import type { Camera } from "@decks/protocol";
import { batch, createSignal } from "solid-js";

/**
 * Where the canvas is looking.
 *
 * The camera is the one piece of state that is **the browser's alone** — the server keeps a
 * reading of it so an agent can ask what the user can see, but nothing on the server ever
 * moves it, and no board file records it. It is also per conversation: a switch parks the
 * view you are leaving and takes the one you are arriving at (`camera/agent-view.ts`).
 *
 * It lived in `App.tsx` until four modules were reaching back into the component for it —
 * `app/files.ts` to turn a drop's stage pixels into world pixels, `app/camera-report.ts` to
 * read it and write it, and two fields of `FrameHooks`. That is what puts a value here
 * rather than in the component: not that it is state, but that modules have to reach it.
 *
 * **The derived zoom check stayed behind.** `zoomInteractive` is a `createMemo`, and the
 * convention this repository states in `state/deck.ts` is that a memo needs a reactive owner
 * — which module scope has not got. `App.tsx` computes it from this signal, which is what a
 * component is for.
 */
const [camera, setCamera] = createSignal<Camera>({ x: 0, y: 0, zoom: 1 });

/**
 * How long the camera takes to arrive when it is asked to glide rather than jump.
 *
 * 420ms: long enough to see the direction of the movement and read it as an arrival, which 260ms
 * was not — at 260 the first 50ms carried half the travel, so it read as a jump with a tail. The
 * scale settle is not a constraint on this number: `Stage`'s `nowScaling` re-arms its own 300ms
 * timer on every frame the zoom moves, so it fires 300ms after the glide lands whatever the
 * duration, and a zooming glide still asks for one redraw at the end rather than sixty.
 */
export const GLIDE_MS = 420;

/**
 * The glide the app has been asked for, or nothing.
 *
 * A **request**, not a schedule: `Stage` owns the pixels and the clock, so this carries a token
 * that tells one request from another plus the duration, and the stage does the rest. Two moves
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
 * `animate` is on for the two gestures that move the camera **for** you, a board link and a row in
 * the panel, and behind `stage.show`/`stage.camera`'s own `animate: true`. Everything you drive
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

/** Leaving a board's page for the canvas: the fall into it reversed, a beat quicker. */
export const LEAVE_BOARD_MS = 360;

export { camera, glide, setCamera };
