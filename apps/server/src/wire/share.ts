import type { WirePart } from "./context.ts";

/**
 * Who else uses this server, from Settings: taking a token back. A code is not made here, only by
 * `decks pair code` on the harness's own machine (`auth/issue.ts`).
 *
 * The answer goes to every browser, since Settings may be open in two of them.
 */
export const share = {
	"pair.revoke": (message, _reply, wire) => {
		// Only a paired front end's: a tab's or a terminal's token is not on that list.
		if (wire.tokens.paired().some((one) => one.id === message.id)) wire.tokens.revoke(message.id);
		wire.send(wire.pairingMessage());
	},
} satisfies WirePart;
