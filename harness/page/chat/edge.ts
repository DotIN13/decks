import { createSignal } from "solid-js";

// Who owns the right edge, the conversation or the inspector:
// the one asked for most recently, with a yielded conversation coming back when the selection goes.

/** Who owns the right edge. */
export type EdgeOwner = "history" | "inspector" | "none";

/** Whether the conversation is wanted at all, whatever is currently on the edge. */
const [wanted, setWanted] = createSignal(false);

/** Which of the two acted last. Only consulted when both could be shown. */
const [claim, setClaim] = createSignal<"history" | "inspector">("inspector");

/** Whether there is anything for the inspector to describe. */
const [describable, setDescribable] = createSignal(false);

/** Who is on the edge. */
export const edgeOwner = (): EdgeOwner => {
	const canInspect = describable();
	if (wanted() && canInspect) return claim();
	if (wanted()) return "history";
	if (canInspect) return "inspector";
	return "none";
};

/** The conversation is up. */
export const historyShown = () => edgeOwner() === "history";

export const inspectorShown = () => edgeOwner() === "inspector";

/** What the history button draws: off, on, or on-but-yielding. */
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

/** Show the conversation, whether or not it is already up. */
export function openHistory(): void {
	setWanted(true);
	setClaim("history");
}

/** The history was dismissed, by its own control, or by Escape. */
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
