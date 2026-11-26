import { blockers, placeBy, stepClear, type StepWay } from "@decks/deck-kit";
import { ARROW, type Op, type PenDocument, type PenNode, type Placed } from "@decks/pen";
import { boardOf } from "../canvas/pens.ts";

/**
 * Where a top-level item placed by a canvas call lands: aim, then step clear (`@decks/deck-kit`,
 * `stepClear`). An item aimed `beside` or `below` another, or nowhere (beside the newest), goes on
 * the same way past whatever is in the way; one put at a corner the caller named stays there, and
 * what it covers is said. Each time it lands anywhere but where it was asked, a warning says where
 * and why (`said`). Its size is read by placing it at the aim first, so a note or a text is measured
 * as it will be drawn.
 */

/** The canvas as the call has it now: the document, how its items are laid out, and an edit tried on it. */
export interface Landing {
	doc: PenDocument;
	layout: (doc: PenDocument) => Map<string, Placed>;
	apply: (ops: Op[]) => PenDocument;
	/** Where the warnings go. */
	said: string[];
}

/** What a top-level item placed on the canvas must keep clear of: every top-level item but arrows (mostly empty canvas) and itself. */
function inWay(doc: PenDocument, placed: Map<string, Placed>, except?: string) {
	return doc.children
		.filter((one) => one.metadata?.type !== ARROW && one.id !== except)
		.flatMap((one) => {
			const box = placed.get(one.id)?.box;
			return box ? [{ id: boardOf(one) ?? one.id, x: box.x, y: box.y, w: box.w, h: box.h }] : [];
		});
}

/** The op with its box where the item lands; the op as given when it was clear, or had no box. */
export function landItem(on: Landing, pen: Op & { box?: { x1: number; y1: number } }, id: string | undefined, label: string, way: StepWay | undefined, placed: Map<string, Placed>, except?: string): Op {
	const aim = pen.box;
	if (!aim) return pen;
	const after = on.apply([pen]);
	// An item given no id takes one as it is applied: the top-level item that was not there before.
	const before = new Set(on.doc.children.map((one) => one.id));
	const which = id ?? after.children.find((one) => !before.has(one.id))?.id;
	const box = which ? on.layout(after).get(which)?.box : undefined;
	if (!box) return pen;
	const name = !id && label === "the new item" && which ? which : label;
	const size = { w: box.w, h: box.h };
	const items = inWay(on.doc, placed, except);
	if (!way) {
		const covers = blockers(items, aim, size, 0);
		if (covers.length) on.said.push(`Warning: ${name} sits over ${covers.map((one) => one.id).join(", ")}: a corner given with at is kept as given. Leave at out, or use beside or below, to have it land clear.`);
		return pen;
	}
	const spot = stepClear(items, size, aim, way);
	if (!spot.past) return pen;
	on.said.push(`Warning: ${name} was aimed at x1 ${aim.x1}, y1 ${aim.y1}, which was taken: it went on ${way === "down" ? "down" : "right"} past ${spot.past} item${spot.past === 1 ? "" : "s"}, to x1 ${spot.x1}, y1 ${spot.y1}.`);
	return { ...pen, box: { ...pen.box, x1: spot.x1, y1: spot.y1 } } as Op;
}

/**
 * An insert's place: as `landItem`, and for an item given no place at the top level, aimed beside the
 * newest item on the canvas (at its corner on an empty one), with a warning that says so. An arrow
 * joined at both ends is drawn between them and has no corner to choose; an item put in a frame is
 * the frame's to lay out.
 */
export function landNew(on: Landing, pen: Op & { box?: { x1: number; y1: number } }, ask: { label: string; top: boolean; way: StepWay | undefined; placed: Map<string, Placed> }): Op {
	const node = (pen as { node?: { id?: unknown; metadata?: { type?: unknown; from?: unknown; to?: unknown } } }).node;
	const joined = node?.metadata?.type === ARROW && node.metadata.from !== undefined && node.metadata.to !== undefined;
	if (!ask.top || joined) return pen;
	let way = ask.way;
	let newest: PenNode | undefined;
	let aimed = pen;
	if (!pen.box) {
		newest = [...on.doc.children].reverse().find((one) => one.metadata?.type !== ARROW && ask.placed.get(one.id));
		aimed = { ...pen, box: newest ? placeBy(ask.placed.get(newest.id)!.box, "beside") : { x1: 0, y1: 0 } } as Op & { box: { x1: number; y1: number } };
		way = "right";
	}
	const landed = landItem(on, aimed as Op & { box?: { x1: number; y1: number } }, typeof node?.id === "string" ? node.id : undefined, ask.label, way, ask.placed);
	if (!pen.box) {
		const at = (landed as { box?: { x1: number; y1: number } }).box!;
		on.said.push(`Warning: no place was given, so ${ask.label} went ${newest ? `beside ${boardOf(newest) ?? newest.id}` : "at the canvas's corner"}, at x1 ${at.x1}, y1 ${at.y1}: say where with at, beside or below.`);
	}
	return landed;
}
