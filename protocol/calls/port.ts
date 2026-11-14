import { defineCall } from "../call.ts";
import { arr, int, opt, str } from "../schema.ts";
import { Deleted, Port } from "../shapes.ts";
import { NOT_CARD, PEOPLE } from "./parts.ts";

// Local servers forwarded so a card or an app can frame them.

export const list = defineCall({ name: "port.list", summary: "Every forwarded port.", who: NOT_CARD, args: {}, answer: arr(Port), effect: "read" });

export const open = defineCall({
	name: "port.open",
	summary: "Forward a local port. path keeps the address's path on; stripped takes it off.",
	who: PEOPLE,
	args: { port: int(), label: opt(str()) },
	answer: Port,
	effect: "change",
});

export const close = defineCall({ name: "port.close", summary: "Stop forwarding a port.", who: PEOPLE, args: { port: int() }, answer: Deleted, effect: "change" });
