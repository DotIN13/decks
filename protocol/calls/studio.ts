import { defineCall } from "../call.ts";
import { str } from "../schema.ts";
import { Studio } from "../shapes.ts";
import { NOT_CARD, PERSON } from "./parts.ts";

// Sync with Decks Studio, the hosted Decks. Only the person connects.

export const status = defineCall({ name: "studio.status", summary: "Whether this server syncs with Studio, and with which.", who: NOT_CARD, args: {}, answer: Studio, effect: "read" });

export const connect = defineCall({
	name: "studio.connect",
	summary: "Connect to Studio with the key Studio made for this server; the deck then syncs in the background.",
	who: PERSON,
	args: { url: str(), key: str() },
	answer: Studio,
	effect: "change",
});

export const disconnect = defineCall({
	name: "studio.disconnect",
	summary: "Stop syncing and forget Studio's key: every browser signed in to Studio loses its way here.",
	who: PERSON,
	args: {},
	answer: Studio,
	effect: "change",
});
