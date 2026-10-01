/**
 * When the person last used the canvas by hand: a press, a scroll or a key, on the stage or inside
 * a board's page.
 *
 * An agent's `stage.show` and `stage.camera` move the view of the conversation on screen
 * (`canvas/stage-ops.ts`), which is right when you are waiting for it and wrong when you are in the
 * middle of reading or moving something: an agent showing a board every few seconds pulled the
 * view out from under the person working on it. So the view is the person's while they are using
 * it, and an agent's move waits for a pause of `HANDS_OFF_MS`.
 *
 * The composer and the panels do not count. Typing to the agent is waiting for it.
 */
let last = Number.NEGATIVE_INFINITY;

/** How long the canvas must go untouched before an agent may move the view. */
export const HANDS_OFF_MS = 5000;

export function touchedCanvas(): void {
	last = performance.now();
}

/** Whether the person has used the canvas within `HANDS_OFF_MS`. */
export function handsOn(): boolean {
	return performance.now() - last < HANDS_OFF_MS;
}
