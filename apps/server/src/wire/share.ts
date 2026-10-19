import type { WirePart } from "./context.ts";

/**
 * Who else uses this server, from Settings: taking a token back. A code is not made here, only by
 * `decks pair code` on the harness's own machine (`share/pairing.ts`).
 *
 * The answer goes to every browser, since Settings may be open in two of them.
 */
export const share = {
	"pair.revoke": (message, _reply, wire) => {
		wire.pairing.revoke(message.id);
		wire.send(wire.pairingMessage());
	},
} satisfies WirePart;
