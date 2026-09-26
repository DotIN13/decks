import type { WirePart } from "./context.ts";

/**
 * The deck, the camera, and the canvas tool's other end.
 *
 * Three frames that belong to the deck itself rather than to a board or an agent: opening
 * another data directory, recording where the user is looking, and handing a browser's
 * answer back to the `stage.call` that is awaiting it.
 */
export const deck = {
	"deck.open": (message, _reply, wire) => {
		wire.openDeck(message.path);
	},

	"camera.set": (message, _reply, wire) => {
		// Recorded, not acted on: the camera is the browser's, and this is what one agent is told
		// when it asks where its stage is looking (`deck/cameras.ts`). Nothing is placed by it.
		if (!wire.agents.get(message.agentId)) return;
		wire.cameras.report(message.agentId, message.camera);
	},

	/** The deck's timezone, from Settings. */
	"settings.set": (message, reply, wire) => {
		const outcome = wire.setTimezone(message.timezone);
		if (outcome) reply({ type: "notice", level: "warn", text: outcome.error });
	},

	"stage.result": (message, _reply, wire) => {
		const pending = wire.pendingStage.get(message.result.id);
		if (!pending) return;
		wire.pendingStage.delete(message.result.id);
		clearTimeout(pending.timer);
		pending.resolve(message.result.error ? { error: message.result.error } : (message.result.value ?? null));
	},
} satisfies WirePart;
