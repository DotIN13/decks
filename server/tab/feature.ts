import { defineFeature, type Feature } from "../kernel/types.ts";
import { tabCalls } from "./calls.ts";
import { TabHub, type HubOptions } from "./hub.ts";
import { relayRoute } from "./relay.ts";

// The tab feature: tab.*, relayed to the Decks extension the person paired.
// The extension dials /api/web/relay; relay.ts hands its line to the hub.

export type TabOptions = HubOptions & { hub?: TabHub };

/** The shared tab. Give a hub to reach it from a test. */
export function tabFeature(options: TabOptions = {}): Feature {
	const hub = options.hub ?? new TabHub(options);
	return defineFeature({
		name: "tab",
		calls: tabCalls(hub),
		routes: [relayRoute(hub)],
		async start(kernel) {
			await hub.start(kernel.store("tab"), kernel.events);
			return () => hub.stop();
		},
	});
}

export { TabHub } from "./hub.ts";
export type { Line } from "./line.ts";
export default tabFeature();
