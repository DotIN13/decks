import type { Camera } from "../state/types/index.ts";
import { canvasBox } from "@decks/canvas/camera";
import { camera, setCamera } from "../state/camera.ts";
import { state } from "../state/deck.ts";
import { callOnLine } from "../state/line.ts";
import { oldCall, oldLineOpen } from "../state/compat/line.ts";
import { deviceId } from "../state/device.ts";
import { canvasOf } from "../state/canvases.ts";

/*
 * Tells the server where the person is looking. A reading trails a gesture by 250ms, so a pan
 * is one report, and it carries the size of the canvas with it.
 */

/** The debounce that makes a pan one report instead of a hundred. */
let timer: number | undefined;

/**
 * A camera reading, with how much room the canvas has to draw in.
 *
 * The size rides on the camera rather than travelling as its own frame because they
 * change together and are read together: `decks.view.viewport()` and `decks.card.create` want
 * the number a card has to fit into, and that is the window minus the chrome standing
 * beside it — not `innerWidth`, which counts the panel as space a card could use.
 *
 * **Every reading says whose view it is, which canvas, and which device**, because the server places an agent's new cards
 * at the middle of that agent's view and nobody else's (the server's views). The
 * view on screen is the focused conversation's; a parked view passes the agent it belongs to.
 * With no agent to name, nothing is sent.
 */
export function reportCamera(now: Camera, agentId: string | undefined = state.focused): void {
	if (!agentId) return;
	const box = canvasBox({ width: window.innerWidth, height: window.innerHeight });
	const sized: Camera = { ...now, width: Math.round(box.width), height: Math.round(box.height) };
	const name = canvasOf(agentId)?.name;
	const where = { agent: agentId, ...(name ? { canvas: name } : {}), device: deviceId };
	void callOnLine("view.move", { x: sized.x, y: sized.y, zoom: sized.zoom, ...where });
	// In compat mode, today's frame as well, on today's line (state/compat): the same camera said twice.
	if (oldLineOpen()) void oldCall("view.remember", [sized, where]);
}

/**
 * The same, trailing a gesture by 250ms so a pan sends one frame and not a hundred.
 *
 * The agent is read now, not when the timer fires: a pan that ends just before a switch to
 * another chat is still a reading of the first chat's view.
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
