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
		// Recorded, not acted on: the camera is the browser's, and this is the reading an
		// agent gets when it asks what the user can see.
		const reading = { at: message.camera };
		wire.lastCamera = reading;
		if (message.agentId) wire.cameras.set(message.agentId, reading);
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
