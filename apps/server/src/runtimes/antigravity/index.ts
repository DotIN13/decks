import { ANTIGRAVITY_CAPABILITIES, ANTIGRAVITY_COMMANDS, AntigravityBackend } from "./backend.ts";
import { antigravityAvailability } from "./install.ts";
import type { AgentRuntime } from "../contract.ts";

/**
 * Antigravity, as a runtime descriptor.
 *
 * Two questions rather than one, which is why `install.ts` keeps them together: is `agy` on
 * PATH, and is there a signed-in `~/.gemini/antigravity-cli` for Decks to reuse. The second
 * is the one people hit, and its sentence says what to run in a terminal to fix it.
 */
export const antigravity: AgentRuntime = {
	kind: "antigravity",
	label: "Antigravity",
	capabilities: ANTIGRAVITY_CAPABILITIES,
	commands: ANTIGRAVITY_COMMANDS,
	availability: () => {
		const answer = antigravityAvailability();
		return answer.available ? { available: true } : { available: false, reason: answer.reason };
	},
	create: (context) => AntigravityBackend.create(context),
};
