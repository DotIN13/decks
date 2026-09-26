import type { Camera } from "@decks/protocol";

/**
 * The camera readings the browsers report, so an agent can ask where its stage is looking.
 *
 * **A reading belongs to one agent.** The browser says whose stage it is showing (the wire frame
 * requires it), and one that does not say is dropped, not guessed at. There is deliberately no
 * "last reading of anything": answering `stage.camera()` with another agent's view is wrong in
 * the same way placing a board by it was.
 *
 * Placement does not read cameras at all (`deck/place.ts`); this is only what an agent is told.
 * With no reading of its own, an agent is told the origin, sized like the last screen measured.
 */

export interface CameraReading {
	at: Camera;
	/** The agent whose stage this view is of. */
	agentId: string;
}

export class Cameras {
	private readonly readings = new Map<string, CameraReading>();
	/** The room the canvas last had on any screen: a size, never a place. */
	private room: { width: number; height: number } | undefined;

	/** Record a reading. One without an agent is not a reading of anybody's stage, so it is dropped. */
	report(agentId: string | undefined, at: Camera): void {
		if (!agentId) return;
		this.readings.set(agentId, { at, agentId });
		if (at.width && at.height) this.room = { width: at.width, height: at.height };
	}

	/** Where this agent's stage is looking, for the agent to read. Falls back to the origin. */
	answer(agentId: string): Camera {
		const reading = this.readings.get(agentId);
		if (reading) return reading.at;
		return { x: 0, y: 0, zoom: 1, ...(this.room ?? {}) };
	}
}
