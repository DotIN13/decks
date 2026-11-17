import type { CanvasPens } from "./pens.ts";

/**
 * Asking an agent to name the canvas it is on, and to rename it once it has outgrown the name.
 *
 * A canvas's name is what the person reads in the pill and the stage manager (`CanvasPens.titleOf`).
 * A new canvas is called after the agent that landed on it, which says who, not what; and a name
 * given for three boards stops describing a canvas that now holds ten others. So the request
 * travels where the identity request does (`agents/identity-reminder.ts`): at the head of each
 * message the person sends and after each stage call, and only while it applies — a canvas with
 * boards on it and no name of its own, or one where most of what it holds arrived after it was
 * named. Setting the name, or saying the same name again, writes down what it holds now, which is
 * what ends the request.
 */

/** How many boards have to be new since the naming, at least, before a rename is suggested. */
const NEW_AT_LEAST = 3;

export function canvasNameReminder(pens: CanvasPens | undefined, stage: string | undefined): string | undefined {
	if (!pens || !stage || !pens.names().includes(stage)) return undefined;
	let boards: string[];
	try {
		boards = pens.cards.boards(stage).map((one) => one.path);
	} catch {
		return undefined;
	}
	// An empty canvas has nothing to be named for yet.
	if (boards.length === 0) return undefined;
	const naming = pens.naming(stage);
	if (!naming.title || naming.provisional) {
		return `[Decks] The canvas beside your chat is called "${pens.titleOf(stage)}", which says nothing about what is on it. Name it for its content with decks canvas rename "…" --canvas ${stage}.`;
	}
	// Named before anything was on it: that was a choice about what would go there, and it stands.
	const then = new Set(naming.boards ?? []);
	if (then.size === 0) return undefined;
	const fresh = boards.filter((path) => !then.has(path)).length;
	if (fresh >= NEW_AT_LEAST && fresh > boards.length / 2) {
		return `[Decks] The canvas beside your chat, "${naming.title}", now holds mostly cards it did not have when it was named (${fresh} of ${boards.length}). If the name no longer fits, rename it with decks canvas rename "…" --canvas ${stage}; to keep it, give it the same name again: decks canvas rename "${naming.title}" --canvas ${stage}.`;
	}
	return undefined;
}
