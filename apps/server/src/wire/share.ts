import type { WirePart } from "./context.ts";

/**
 * Letting another Decks in, from Settings: a fresh code to type there, and taking a token back.
 *
 * Both answers go to every browser, since Settings may be open in two of them and the list is the
 * same for both.
 */
export const share = {
	"pair.code": (_message, _reply, wire) => {
		wire.pairing.newCode();
		wire.send(wire.pairingMessage());
	},

	"pair.revoke": (message, _reply, wire) => {
		wire.pairing.revoke(message.id);
		wire.send(wire.pairingMessage());
	},
} satisfies WirePart;
