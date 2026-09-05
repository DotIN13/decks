/**
 * An agent pointing at what it just changed: a bubble with a small arrow, on the canvas.
 *
 * The gap this fills, from `boards/方案①`: an agent could already *gesture* at a board and
 * neither gesture was enough. `stage.show(path, { highlight })` frames one `data-id` and is
 * welded to a camera fit, so it cannot say "these three" and cannot be used without moving
 * the view. `stage.cursor` is a dot and a label with no arrow, pointing at a coordinate
 * rather than at a thing. Drawing an actual arrow meant writing SVG into the board file and
 * deleting it afterwards, which is too heavy for "look here".
 *
 * So: **transient, anchored, and plural.**
 *
 * - **Transient.** Nothing is written to the board. Like `cursor`, these live in the canvas
 *   and vanish; a board file that has been annotated is byte-identical to one that has not.
 * - **Anchored to a component**, not to a point. `to: "goal"` resolves through the board's
 *   own document every time it is drawn, so a component that is dragged takes its arrow with
 *   it rather than leaving it pointing at where it used to be.
 * - **Plural.** `highlight` frames one thing because a camera can only fit one thing; a set
 *   of arrows has no such limit, and "here, here and here" is the common case for an agent
 *   reporting three edits.
 *
 * This module is the part with rules in it and no DOM of its own: what an annotation may be,
 * and where its arrow lands. `annotations.test.ts` is where both are asserted.
 */

/** Where an arrow points: a component's `data-id`, or a raw board coordinate. */
export type Anchor = string | { x: number; y: number };

export interface Mark {
	/** Which agent put it there, so one agent can clear its own without touching others'. */
	agentId: string;
	path: string;
	to: Anchor;
	label: string;
	/** The bubble's colour. `accent` unless the agent says otherwise. */
	tone: MarkTone;
}

export const TONES = ["accent", "ok", "warn", "danger"] as const;
export type MarkTone = (typeof TONES)[number];

/** Four at most per agent per board: past that they overlap each other and say nothing. */
export const MAX_MARKS = 4;
/** Long enough for a clause, short enough that the bubble does not become a paragraph. */
export const MAX_LABEL = 80;

/**
 * What the agent asked for, cleaned into what can be drawn.
 *
 * Anything unusable is dropped rather than refused, for the reason `agents/tags.ts` gives:
 * an agent that sent four annotations and got one wrong has still said something true, and
 * failing the whole call would leave the user with nothing. An empty result is an honest
 * "nothing to draw" and the caller reports the count back.
 */
export function cleanMarks(agentId: string, path: string, raw: unknown): Mark[] {
	const list = Array.isArray(raw) ? raw : [raw];
	const out: Mark[] = [];
	for (const item of list) {
		if (!item || typeof item !== "object") continue;
		const spec = item as { to?: unknown; label?: unknown; tone?: unknown };
		const to = anchorOf(spec.to);
		if (to === undefined) continue;
		const label = typeof spec.label === "string" ? spec.label.trim().slice(0, MAX_LABEL) : "";
		if (!label) continue;
		const tone = TONES.includes(spec.tone as MarkTone) ? (spec.tone as MarkTone) : "accent";
		out.push({ agentId, path, to, label, tone });
		if (out.length === MAX_MARKS) break;
	}
	return out;
}

function anchorOf(raw: unknown): Anchor | undefined {
	if (typeof raw === "string" && raw.trim()) return raw.trim();
	if (raw && typeof raw === "object") {
		const point = raw as { x?: unknown; y?: unknown };
		if (typeof point.x === "number" && typeof point.y === "number" && Number.isFinite(point.x) && Number.isFinite(point.y)) {
			return { x: point.x, y: point.y };
		}
	}
	return undefined;
}

/**
 * Where the arrow's tip goes, in the board's own coordinates.
 *
 * Board components are absolutely positioned with `left`/`top` in board units, so
 * `offsetLeft`/`offsetTop` **are** board coordinates — no camera maths, which is the rule
 * this directory keeps (§6.5). Read fresh on every draw, which is the whole of "follows the
 * component": a drag rewrites the element's inline style and the next read sees it.
 *
 * The tip lands on the **right edge, a third of the way down** rather than at the centre:
 * an arrow into the middle of a card covers the words it is pointing at, and a third down
 * is beside the heading, which is what a reader looks at first.
 *
 * `undefined` for a `data-id` the board does not have — an agent can annotate a component
 * and then delete it, and a bubble pointing at nothing is worse than no bubble.
 */
export function anchorPoint(doc: Document | undefined, to: Anchor): { x: number; y: number } | undefined {
	if (typeof to !== "string") return to;
	if (!doc) return undefined;
	/*
	 * Duck-typed, not `instanceof HTMLElement`, and that is a correctness fix rather than a
	 * style choice: a board is an **iframe**, so its elements are instances of *that*
	 * document's `HTMLElement`, not this window's. `instanceof` across realms is always
	 * false, so the check would have rejected every element it was given. `Editor.ts` casts
	 * for the same reason, everywhere it touches a board's document.
	 */
	const element = doc.querySelector(`[data-id="${cssEscape(to)}"]`) as HTMLElement | null;
	if (!element || typeof element.offsetLeft !== "number" || typeof element.offsetWidth !== "number") return undefined;
	return { x: element.offsetLeft + element.offsetWidth, y: element.offsetTop + Math.round(element.offsetHeight / 3) };
}

/** `CSS.escape`, with a fallback for the ids that do not need it. */
function cssEscape(value: string): string {
	if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
	return value.replace(/["\\]/g, "\\$&");
}

/**
 * Which way the bubble hangs off the tip.
 *
 * Right of the component normally; **left** when the component is close enough to the
 * board's right edge that a bubble there would hang off it. A 240px bubble at the far right
 * of an 1800px board would otherwise sit outside the board entirely, over whatever is beside
 * it on the canvas.
 */
export function bubbleSide(at: { x: number }, boardWidth: number, bubble = 240): "left" | "right" {
	return at.x + bubble > boardWidth ? "left" : "right";
}
