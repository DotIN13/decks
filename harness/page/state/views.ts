import { storageKey } from "../connections/connection.ts";
import { createAgentViews, type AgentViews } from "@decks/canvas/camera";

export { createAgentViews, type AgentViews, type ViewStorage } from "@decks/canvas/camera";

const cache = new Map<string, AgentViews>();

/**
 * The views for one deck, as the app asks for them.
 *
 * Cached per path, because the caller asks on every render and a storage read is not something
 * to do per frame — and because two objects over one key would fight over it: each holds the map
 * as it read it, so the second one to write would put back everything the first had dropped.
 */
export function agentViews(deckPath: string): AgentViews {
	const found = cache.get(deckPath);
	if (found) return found;
	// Per backend as well: two servers can each have a deck at the same path (`connections/`).
	const made = createAgentViews(storageKey(deckPath));
	cache.set(deckPath, made);
	return made;
}

