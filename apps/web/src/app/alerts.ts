import { createAlerts as createShared } from "@decks/canvas/alerts";
import { openHistory } from "../state/edge.ts";
import { state } from "../state/deck.ts";
import { setUnattended } from "./favicon.ts";

export type { AlertBanner } from "@decks/canvas/alerts";

/**
 * The app's alerts: `@decks/canvas/alerts`' cue, banner and tab badge, where a clicked banner opens
 * the conversation it is about and its history.
 */
export function createAlerts(deps: {
	/** Clicking a banner switches to the conversation it is about. */
	focusAgent(id: string): void;
}) {
	return createShared({
		open: (agent) => {
			if (agent && agent !== state.focused) deps.focusAgent(agent);
			openHistory();
		},
		badge: setUnattended,
	});
}
