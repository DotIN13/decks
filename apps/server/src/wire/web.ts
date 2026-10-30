import type { WirePart } from "./context.ts";

/**
 * The shared Chrome, from the settings' Your Chrome.
 *
 * The user's own browser is attached by the extension (`browser/bridge.ts`): the answer to a
 * submit the agent is waiting on, a Stop and a fresh pairing code. Three frames, each of them
 * one call into the bridge and a republish of its status.
 */
export const web = {
	"web.answer": (message, reply, wire) => {
		if (!wire.web.answer(message.id, message.ok)) reply({ type: "notice", level: "info", text: "That question has already been answered." });
	},

	"web.stop": (_message, _reply, wire) => {
		wire.web.stop();
	},

	"web.repair": (_message, _reply, wire) => {
		const code = wire.web.repair();
		wire.send({ type: "web.status", status: wire.web.status(), code });
	},
} satisfies WirePart;
