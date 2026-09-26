import type { Camera } from "@decks/protocol";
import { canvasBox } from "../camera/insets.ts";
import { camera, setCamera } from "../state/camera.ts";
import { state } from "../state/deck.ts";
import { send } from "../state/socket.ts";

/**
 * Telling the server where the user is looking — which is not every frame.
 *
 * A pan is hundreds of camera changes and the server only needs the resting place, so the
 * report trails the gesture by a beat rather than narrating it. This was four statements in
 * `App.tsx` — a timer, a debounce, the reading, and the setter that does both — and it is
 * the only place that knows a camera reading travels *with* the size of the canvas.
 *
 * The camera itself is `state/camera.ts`; this is the mechanism over it — the thing that
 * watches and writes. The timer is private here, which is what a module in `app/` is: the
 * component builds it, no other module needs it, and the value has no life outside the one
 * thing that asked for it.
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
 * **Every reading says whose stage it is**, because the server places an agent's new boards
 * at the middle of that agent's view and nobody else's (`deck/cameras.ts` on the server). The
 * view on screen is the focused conversation's; a parked view passes the agent it belongs to.
 * With no agent to name, nothing is sent.
 */
export function reportCamera(now: Camera, agentId: string | undefined = state.focused): void {
	if (!agentId) return;
	const box = canvasBox({ width: window.innerWidth, height: window.innerHeight });
	const sized: Camera = { ...now, width: Math.round(box.width), height: Math.round(box.height) };
	send({ type: "camera.set", camera: sized, agentId });
}

/**
 * The same, trailing a gesture by 250ms so a pan sends one frame and not a hundred.
 *
 * The agent is read now, not when the timer fires: a pan that ends just before a switch to
 * another chat is still a reading of the first chat's stage.
 */
export function reportCameraSoon(now: Camera): void {
	if (timer) clearTimeout(timer);
	const agentId = state.focused;
	timer = window.setTimeout(() => reportCamera(now, agentId), 250);
}

/** Set the camera and report it — what a pan, a fit and a zoom all end with. */
export function setCameraAndReport(next: Camera): void {
	setCamera(next);
	reportCameraSoon(next);
}

/** The current reading, for callers that are about to move it. */
export { camera };
