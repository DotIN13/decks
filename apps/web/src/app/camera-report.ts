import type { Camera } from "@decks/protocol";
import { canvasBox } from "../camera/insets.ts";
import { camera, setCamera } from "../state/camera.ts";
import { send } from "../state/socket.ts";

/**
 * Telling the server where the user is looking — which is not every frame.
 *
 * A pan is hundreds of camera changes and the server only needs the resting place, so the
 * report trails the gesture by a beat rather than narrating it. This was four statements in
 * `App.tsx` — a timer, a debounce, the reading, and the setter that does both — and it is
 * the only place that knows a camera reading travels *with* the size of the canvas.
 *
 * The camera itself is `state/camera.ts`; this is the mechanism over it, the way
 * `app/socket.ts` is the connection under `state/socket.ts`. The timer is private here,
 * which is what `app/` is for.
 */

/** The debounce that makes a pan one report instead of a hundred. */
let timer: number | undefined;

/**
 * A camera reading, with how much room the canvas has to draw in.
 *
 * The size rides on the camera rather than travelling as its own frame because they
 * change together and are read together: `stage.viewport()` and `stage.newBoard` want
 * the number a board has to fit into, and that is the window minus the chrome standing
 * beside it — not `innerWidth`, which counts the boards panel as space a board could use.
 *
 * `agentId` names a *different* conversation's canvas: the camera is per conversation
 * (`camera/agent-view.ts`), and a parked view has to be reported for the agent it belongs
 * to rather than for whoever is on screen.
 */
export function reportCamera(now: Camera, agentId?: string): void {
	const box = canvasBox({ width: window.innerWidth, height: window.innerHeight });
	const sized: Camera = { ...now, width: Math.round(box.width), height: Math.round(box.height) };
	send({ type: "camera.set", camera: sized, ...(agentId ? { agentId } : {}) });
}

/** The same, trailing a gesture by 250ms so a pan sends one frame and not a hundred. */
export function reportCameraSoon(now: Camera): void {
	if (timer) clearTimeout(timer);
	timer = window.setTimeout(() => reportCamera(now), 250);
}

/** Set the camera and report it — what a pan, a fit and a zoom all end with. */
export function setCameraAndReport(next: Camera): void {
	setCamera(next);
	reportCameraSoon(next);
}

/** The current reading, for callers that are about to move it. */
export { camera };
