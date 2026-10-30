import { unpairStudio } from "../studio/index.ts";
import type { WirePart } from "./context.ts";

/**
 * Who else uses this server, from Settings: taking a token back, or unpairing Decks Studio. A code is not made here, only by
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
	/** Unpair Decks Studio: its key deleted and every token given through it taken back (`studio/index.ts`). */
	"studio.unpair": (_message, reply, wire) => {
		try {
			unpairStudio(wire.deck.path, wire.tokens);
		} catch (error) {
			reply({ type: "error", text: (error as Error).message });
		}
		wire.send(wire.pairingMessage());
	},
} satisfies WirePart;
