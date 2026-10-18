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
