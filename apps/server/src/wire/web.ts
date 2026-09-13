import type { WirePart } from "./context.ts";

/**
 * The shared Chrome, from the status board.
 *
 * The user's own browser is attached by the extension (`web/bridge.ts`), and the board at
 * `boards/your-chrome.html` is its control panel: the answer to a submit the agent is
 * waiting on, a Stop, a fresh pairing code, and the card itself. Four frames, all of them
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

	"web.board": (_message, _reply, wire) => {
		const path = wire.boards.newWebBoard();
		const agent = wire.agents.focused();
		agent.setInPlay([...agent.inPlay.filter((shown) => shown !== path), path]);
	},
} satisfies WirePart;
