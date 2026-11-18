import type { PageEnd } from "../protocol.ts";

/** One frame the page holds, and the canvas it shows or is being started on; the spare one is on none yet. */
export interface Held {
	/** Which frame this is, for as long as it is on the page. */
	n: number;
	canvas: string | undefined;
	/** While it is the spare: whether it has said hello, and how to stop listening for it (`@decks/frame`, `spareFrame`). */
	waiting?: { said(): boolean; stop(): void };
	frame?: HTMLIFrameElement;
	/** The page's end of its line, once it has started on this canvas. */
	end?: PageEnd;
	/** Its line has been the page's before: coming forward again, it is told what changed while it was behind. */
	seen?: true;
	/** Stops the canvas it shows now: its start, its port, its renewals. */
	leave?: () => void;
}

/** What a move does with the frames the page holds. */
export interface Choice {
	/** The frame for the canvas on screen, or none when there is no canvas. */
	next: Held | undefined;
	/**
	 * How it comes to show that canvas: `held` (it does already), `moved` (a frame nothing wants moves
	 * to it in place), `spare` (the frame kept spare takes it), `new` (one is made, `next` is not on the
	 * page yet), or `none`.
	 */
	how: "held" | "moved" | "spare" | "new" | "none";
	/** The frames nothing wants any more: taken off the page. */
	gone: Held[];
}

/**
 * Which frame shows the canvas on screen, and which frames go, when the canvas on screen or the
 * canvases kept behind it change (`surface.tsx` says why frames are kept at all).
 *
 * - A frame already held for the canvas comes forward.
 * - Else a frame nothing wants, neither on screen nor kept, moves to it in place, when it has
 *   started and both canvases allow it (`inPlace`: yours alone, since a card's script can outlive its
 *   card). The one that was in front first: its place on the page is where the eye is. With nothing
 *   kept this is every move, as it was before frames were kept.
 * - Else the spare frame takes it, when there is one.
 * - Else a new frame is made (`make`).
 *
 * Every other frame nothing wants goes. Pure: it changes nothing, and is tested alone (`held.test.ts`).
 */
export function chooseFrame(d: { held: readonly Held[]; front: Held | undefined; spare: Held | undefined; canvas: string | undefined; kept: readonly string[]; inPlace(from: string, to: string): boolean; make(canvas: string): Held }): Choice {
	const { canvas } = d;
	const wanted = new Set<string>(canvas ? [canvas, ...d.kept] : d.kept);
	const unwanted = d.held.filter((one) => one.canvas === undefined || !wanted.has(one.canvas));
	if (!canvas) return { next: undefined, how: "none", gone: unwanted };
	const held = d.held.find((one) => one.canvas === canvas);
	if (held) return { next: held, how: "held", gone: unwanted };
	const moved = [...unwanted].sort((a, b) => Number(b === d.front) - Number(a === d.front)).find((one) => one.frame && one.end && one.canvas !== undefined && d.inPlace(one.canvas, canvas));
	if (moved) return { next: moved, how: "moved", gone: unwanted.filter((one) => one !== moved) };
	if (d.spare) return { next: d.spare, how: "spare", gone: unwanted };
	return { next: d.make(canvas), how: "new", gone: unwanted };
}
