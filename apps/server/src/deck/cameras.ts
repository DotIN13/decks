import type { Camera } from "@decks/protocol";

/**
 * The camera readings the browsers report, so an agent can ask where its canvas is looking.
 *
 * **A reading belongs to one agent.** The browser says whose canvas it is showing (the wire frame
 * requires it), and one that does not say is dropped, not guessed at. There is deliberately no
 * "last reading of anything": answering `decks.view.camera()` with another agent's view is wrong in
 * the same way placing a card by it was.
 *
 * **And to one canvas, on one device.** A reading is keyed by agent, canvas and device together: an
 * agent moves between canvases, and a view of one says nothing about another; a phone and a laptop
 * on the same canvas look at different places, and neither overwrites the other. An agent asking is
 * told the newest reading of the canvas it is on now, from whichever device reported it last.
 *
 * Placement does not read cameras at all (`deck/place.ts`); this is only what an agent is told.
 * With no reading of its own, an agent is told the origin, sized like the last screen measured.
 */

interface CameraReading {
	at: Camera;
	/** The agent whose canvas this view is of. */
	agentId: string;
	/** The canvas it was of, when the browser said. */
	canvas?: string;
	/** Which browser reported it, when it said. */
	device?: string;
	/** When, for the newest of several. */
	when: number;
}

export class Cameras {
	private readonly readings = new Map<string, CameraReading>();
	/** The room the canvas last had on any screen: a size, never a place. */
	private room: { width: number; height: number } | undefined;
	private tick = 0;

	/** Record a reading. One without an agent is not a reading of anybody's canvas, so it is dropped. */
	report(agentId: string | undefined, at: Camera, where: { canvas?: string; device?: string } = {}): void {
		if (!agentId) return;
		const canvas = typeof where.canvas === "string" && where.canvas ? where.canvas : undefined;
		const device = typeof where.device === "string" && where.device ? where.device.slice(0, 64) : undefined;
		this.readings.set(`${agentId}\u0000${canvas ?? ""}\u0000${device ?? ""}`, { at, agentId, ...(canvas ? { canvas } : {}), ...(device ? { device } : {}), when: ++this.tick });
		if (at.width && at.height) this.room = { width: at.width, height: at.height };
	}

	/**
	 * Where this agent's canvas is looking, for the agent to read: the newest reading of the canvas
	 * it is on, from any device. A reading that named no canvas answers for any. Falls back to the origin.
	 */
	answer(agentId: string, canvas?: string): Camera {
		let best: CameraReading | undefined;
		for (const reading of this.readings.values()) {
			if (reading.agentId !== agentId) continue;
			if (canvas !== undefined && reading.canvas !== undefined && reading.canvas !== canvas) continue;
			if (!best || reading.when > best.when) best = reading;
		}
		if (best) return best.at;
		return { x: 0, y: 0, zoom: 1, ...(this.room ?? {}) };
	}
}
