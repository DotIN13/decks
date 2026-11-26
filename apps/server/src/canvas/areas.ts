import type { Op } from "@decks/pen";
import type { CanvasPens } from "./pens.ts";

/**
 * The areas a canvas starts with: a title for the person's to-dos and one for the work agents have
 * in hand, each with a line under it saying what goes there.
 *
 * An area is a place, not an object: a title and whatever sits by it. Nothing is tagged and nothing
 * frames it, so the person can move, rename or delete the titles like any other words, and lay the
 * canvas out top to bottom, left to right or any way at all. Agents find the areas by reading these
 * titles (the canvas-authoring skill, "Organize a canvas"), and the topics they file work under get
 * titles of their own as they come.
 */

/** The titles agents look for. */
export const TODO_TITLE = "To do";
export const WORKING_TITLE = "Working";

/** Room between the two areas, side by side at the top of a new canvas. */
const APART = 1400;

const title = (id: string, content: string, x: number): Op => ({
	op: "insert",
	node: { type: "text", id, name: content, content, fontSize: 44, fontWeight: "700", fill: "$decks-text" } as never,
	box: { x1: x, y1: 0 },
});
const hint = (id: string, content: string, x: number): Op => ({
	op: "insert",
	node: { type: "text", id, content, fontSize: 20, fill: "$decks-text-muted" } as never,
	box: { x1: x, y1: 70 },
});

/** The edits that put the two areas' titles on an empty canvas. */
export function startingAreas(): Op[] {
	return [
		title("to-do", TODO_TITLE, 0),
		hint("to-do-hint", "Your to-dos, one note each. Agents read them and link each to its answer.", 0),
		title("working", WORKING_TITLE, APART),
		hint("working-hint", "What agents are working on now, one row each, linked to its topic.", APART),
	];
}

/** Put the starting areas on a canvas that has nothing on it yet; a canvas with anything on it is left as it is. */
export function startAreas(pens: CanvasPens, name: string): void {
	if (pens.get(name).doc.children.length > 0) return;
	pens.edit(name, startingAreas());
}
