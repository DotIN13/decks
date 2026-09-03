import { createSignal } from "solid-js";

/**
 * Who owns the right edge.
 *
 * Two surfaces want it and only one may have it: the **conversation**, which you summon
 * with the button in the top-right cluster, and the **inspector**, which appears because
 * something is selected. The rule, from `boards/the-conversation-panel-drawn`, is one
 * sentence: *the most recent explicit act owns the edge.*
 *
 * Selecting is an explicit act and so is pressing the history button, so a single bit —
 * which of the two happened last — decides everything. The cases that bit gets right, and
 * that a naive `if (selected) hideHistory()` gets wrong:
 *
 * - Press the button, then select something: the inspector takes the edge and the history
 *   is **yielded**, not off. Deselect and it comes back, because you never asked for it to
 *   go.
 * - Close the history *while it is yielded*: it is off now, and it does **not** reappear
 *   when you deselect. What matters is whether it is *wanted*, not whether it was visible —
 *   otherwise dismissing it would be undone by an unrelated click.
 * - Press the button while something is selected: the history wins and the inspector
 *   yields. **The selection is kept.** Losing a selected box because you wanted to read the
 *   conversation would be a bad trade, and nothing about the inspector is lost by it being
 *   away for a moment.
 */
export type EdgeOwner = "history" | "inspector" | "none";

/** Whether the conversation is wanted at all, whatever is currently on the edge. */
const [wanted, setWanted] = createSignal(false);
/** Which of the two acted last. Only consulted when both could be shown. */
const [claim, setClaim] = createSignal<"history" | "inspector">("inspector");
/** Whether there is anything for the inspector to describe. */
const [describable, setDescribable] = createSignal(false);

/** Whether the conversation is wanted — the state the button reports. */
export const historyWanted = wanted;

/**
 * Who is on the edge.
 *
 * A function rather than a `createMemo`: this module is imported at the top level, and a
 * computation created outside a reactive root has no owner to clean it up — Solid says so,
 * and outside the browser it simply never recomputes. Three comparisons do not need
 * caching, and a plain function reads the signals through whatever effect calls it.
 */
export const edgeOwner = (): EdgeOwner => {
	const canInspect = describable();
	if (wanted() && canInspect) return claim();
	if (wanted()) return "history";
	if (canInspect) return "inspector";
	return "none";
};

/** The conversation is up. */
export const historyShown = () => edgeOwner() === "history";
/** The inspector is up. */
export const inspectorShown = () => edgeOwner() === "inspector";

/**
 * What the history button draws: off, on, or on-but-yielding.
 *
 * Three states rather than two, because *yielded must not look like off*. A button that
 * goes dark when the inspector borrows the edge is a button that has silently forgotten
 * what you asked it for.
 */
export const historyButton = (): "off" | "on" | "yield" =>
	!wanted() ? "off" : edgeOwner() === "history" ? "on" : "yield";

/** The history button was pressed. */
export function toggleHistory(): void {
	if (wanted() && edgeOwner() !== "history") {
		// Yielded, and pressed: take the edge rather than turning off. Pressing a button
		// whose surface you cannot see should show it to you.
		setClaim("history");
		return;
	}
	setWanted(!wanted());
	setClaim("history");
}

/** The history was dismissed — by its own control, by Escape, or by a swipe. */
export function closeHistory(): void {
	setWanted(false);
}

/** There is now (or is no longer) a selection the inspector can describe. */
export function setInspectable(can: boolean): void {
	const had = describable();
	setDescribable(can);
	// Only a *new* selection is an act. Losing one is not: it must not hand the edge to
	// the inspector, and it must not take it away from a history that had claimed it.
	if (can && !had) setClaim("inspector");
}

/** For tests: back to nothing wanted, nothing selected. */
export function resetEdge(): void {
	setWanted(false);
	setDescribable(false);
	setClaim("inspector");
}
