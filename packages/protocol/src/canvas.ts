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
	/** Every board on it, in the order they joined. */
	boards: string[];
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
