/**
 * A canvas, as the browser needs it.
 *
 * The server's own record (`canvas/store.ts`) has one more thing in it — where every board
 * sits — and that does not travel in this shape: a board's place reaches the browser on the
 * board itself, in `DeckState`, because that is what draws it. What is here is everything
 * else a canvas is: its name, what is on it, who is working there, and the two times the
 * changed mark is made of.
 */
export interface Canvas {
	id: string;
	name: string;
	/**
	 * The workspace it belongs to, as a slug: `"political-llm"`. Absent for none.
	 *
	 * The same word an agent declares about itself (`Identity.workspace`), cleaned the same
	 * way, so an agent and a canvas in one project say one thing. Every list of canvases is
	 * cut by it, and an agent's row opens the first canvas in its own.
	 */
	workspace?: string;
	/** Every board on it, in the order they joined. */
	boards: string[];
	/**
	 * Boards it has held and taken off, newest first: it keeps their places, and the panel lists
	 * them as held, not shown. `boards` and these together are what the canvas holds, and what
	 * every agent working on it has as its context.
	 */
	kept: string[];
	/** Arrows drawn between boards on this canvas. */
	links: CanvasLink[];
	/** Boards fenced together, because they are one piece of work. */
	groups: CanvasGroup[];
	/** When a board on it was last written. */
	changedAt: number;
	/** When you last opened it. Older than `changedAt` means there is something new. */
	openedAt?: number;
	/** The agents working here, by id. */
	agents: string[];
}

export interface CanvasLink {
	from: string;
	to: string;
	label?: string;
}

export interface CanvasGroup {
	name: string;
	boards: string[];
}
