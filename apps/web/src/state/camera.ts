import type { Camera } from "@decks/protocol";
import { createSignal } from "solid-js";

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

export { camera, setCamera };
