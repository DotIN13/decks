import { createAlerts as createShared } from "../alerts/index.ts";
import { openHistory } from "../chat/index.ts";
import { state } from "../state/deck.ts";
import { setUnattended } from "./favicon.ts";

export type { AlertBanner } from "../alerts/index.ts";

/**
 * The app's alerts: `alerts/`'s cue, banner and tab badge, where a clicked banner opens
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
