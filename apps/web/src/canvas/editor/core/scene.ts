/**
 * The seam: everything the editor asks of the scene, and nothing else.
 *
 * Today `scene-ts.ts` answers it from the TypeScript side of the engine (`stage/engine.ts`).
 * Later the Rust engine can answer parts of it itself (picking, snapping, drop slots), and the
 * same core tests run against both.
 */
import type { PenNode, Placed } from "@decks/pen";
import type { BoardBox, Pt, Rect } from "./model.ts";

export interface SceneQuery {
	/** Every placed item, in paint order. */
	items(): Iterable<Placed>;
	item(id: string): Placed | undefined;
	/** Where an item is drawn (text measured, shapes at their outline), else where it is placed. */
	box(id: string): Rect | undefined;
	/**
	 * Where the sheet has drawn an item, and nothing until it has: what an outline goes round, so
	 * none shows for an item that is placed but not yet drawn. `box` falls back to the placed box.
	 */
	drawn(id: string): Rect | undefined;
	/** The item's node in the document, for what the placed copy does not carry (its children). */
	node(id: string): PenNode | undefined;
	/** The node an item sits in, in the document; `undefined` at the top. */
	parent(id: string): PenNode | undefined;
	/** The boards on the stage, as placed, in file order. */
	boards(): readonly BoardBox[];
	/**
	 * Every item under a stage point, topmost first, unfiltered: raw geometry, with a press's
	 * reach round each so a thin line can be hit. Which of them a press means is `pick.ts`'s.
	 */
	under(point: Pt): string[];
	/**
	 * Whether a point is on what a path item draws: its line with the press's reach, or inside its
	 * fill. `undefined` when it cannot tell (no geometry), and the item's box is all there is.
	 */
	onLine(id: string, point: Pt): boolean | undefined;
}

/** How a gesture shows an item before the edit lands: moved, sized, rounded or with fields changed. */
export type PreviewChange = { dx: number; dy: number; w?: number; h?: number; radius?: number | null; set?: Record<string, unknown> };

/**
 * The other half of the seam: what the editor tells the engine while a gesture is in hand. Core
 * never calls it; it returns what to show (`core/gesture.ts`, `preview`, `Effect`) and the
 * controller (`dom/controller.ts`) says it here.
 */
export interface EngineSeam {
	/** Draw these items lifted and changed until the next drawing; `undefined` puts them back. */
	preview(changes: ReadonlyMap<string, PreviewChange> | undefined): void;
	/** A gesture was let go and its edit sent: what it lifted goes down when the answer is drawn. */
	settle(): void;
	/** The boards a drag carries, and how far: their pictures go with it. */
	carry(paths: readonly string[], offset: { dx: number; dy: number }): void;
	/** A mark for what has been sent so far, and whether a frame painted after it is on screen. */
	mark(): number;
	shows(mark: number): boolean;
	/** The link of a card under a stage point. */
	linkAt(point: Pt): string | undefined;
}
