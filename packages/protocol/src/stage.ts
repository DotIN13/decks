/** The canvas: where a camera is looking, and what the server asks the browser to do. */
export interface Camera {
	x: number;
	y: number;
	zoom: number;
	/**
	 * How big the canvas is, in CSS pixels, when the browser is the one reporting.
	 *
	 * Not world units and not divided by the zoom: it is the room a board has on screen,
	 * which is what an agent choosing a board size actually needs. It is the window *minus
	 * the chrome standing beside it* (`web/lib/insets.ts`) rather than `innerWidth`, because
	 * a panel that covers a third of the window is not room a board can use.
	 *
	 * Optional because most cameras are computed — `fitInto`, `zoomAbout` and every rewind
	 * make one — and only a reading taken from a live browser can know this. An agent that
	 * has never had one reported is told nothing rather than told a default.
	 */
	width?: number;
	height?: number;
}

/**
 * The server asking the browser to do something to the stage, and awaiting it.
 *
 * Reads that the server can answer itself never become one of these; this is only
 * for what only the browser knows or only the browser can do.
 */
export interface StageCall {
	id: string;
	/**
	 * Which agent asked.
	 *
	 * The canvas is *per conversation* — it draws the focused agent's in-play set and
	 * nothing else — so the browser has to know whose `show` it is carrying out. Without
	 * this it could not tell, and an agent you were not watching flew your camera to a board
	 * that is not on your canvas at all.
	 */
	agentId: string;
	/** `annotate` is the newest: bubbles with arrows, drawn on the canvas and never written
	 *  to a board file. See `canvas/annotations.ts`. */
	op: "show" | "camera" | "move" | "highlight" | "reload" | "cursor" | "annotate" | "toast" | "read";
	args: unknown;
}

export type StageResult = { id: string; value?: unknown; error?: string };
