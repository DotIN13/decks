/**
 * The seam: everything the editor asks of the scene, and nothing else.
 *
 * Today `scene-ts.ts` answers it from the TypeScript side of the engine (`stage/engine.ts`).
 * Later the Rust engine can answer parts of it itself (picking, snapping, drop slots), and the
 * same core tests run against both.
 */
import type { PenNode, Placed } from "@decks/pen";
import type { BoardBox, Rect } from "./model.ts";

export interface SceneQuery {
	/** Every placed item, in paint order. */
	items(): Iterable<Placed>;
	item(id: string): Placed | undefined;
	/** Where an item is drawn (text measured, shapes at their outline), else where it is placed. */
	box(id: string): Rect | undefined;
	/** The item's node in the document, for what the placed copy does not carry (its children). */
	node(id: string): PenNode | undefined;
	/** The boards on the stage, as placed. */
	boards(): readonly BoardBox[];
}
