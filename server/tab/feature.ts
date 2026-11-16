import { defineFeature, type Feature } from "../kernel/types.ts";
import { tabCalls } from "./calls.ts";
import { TabHub, type HubOptions } from "./hub.ts";
import { relayRoute } from "./relay.ts";

// The tab feature: tab.*, relayed to the Decks extension the person paired.
// The extension dials /api/web/relay; relay.ts hands its line to the hub.

/** oldPairing: today's web-bridge.json beside the deck, read by main, carried into the store once. */
export type TabOptions = HubOptions & { hub?: TabHub; oldPairing?: () => Promise<string | undefined> };

/** The shared tab. Give a hub to reach it from a test. */
export function tabFeature(options: TabOptions = {}): Feature {
	const hub = options.hub ?? new TabHub(options);
	return defineFeature({
		name: "tab",
		calls: tabCalls(hub),
		routes: [relayRoute(hub)],
		async upgrade(_deck, _version, parts) {
			const store = parts.stores("tab");
			if (await store.get("pairing")) return;
			const code = pairingCode(await options.oldPairing?.());
			if (code) await store.put("pairing", new TextEncoder().encode(code));
		},
		async start(kernel) {
			await hub.start(kernel.store("tab"), kernel.events);
			return () => hub.stop();
		},
	});
}

/** The code in today's web-bridge.json: { "code": "..." }. */
export function pairingCode(text: string | undefined): string | undefined {
	try {
		const code = (JSON.parse(text ?? "") as { code?: unknown }).code;
		return typeof code === "string" && code ? code : undefined;
	} catch {
		return undefined;
	}
}

export { TabHub } from "./hub.ts";
export type { Line } from "./line.ts";
