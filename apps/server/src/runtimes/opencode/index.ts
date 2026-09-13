import { OPENCODE_CAPABILITIES, OPENCODE_COMMANDS, OpencodeBackend } from "./backend.ts";
import { opencodeExecutable } from "./install.ts";
import type { AgentRuntime } from "../contract.ts";

/**
 * opencode, as a runtime descriptor.
 *
 * The binary is the whole of the availability question — opencode answers on whatever the
 * user's own config says it can reach — and the sentence is the one `manager.ts` used to
 * refuse with, moved here so the menu and the failure say the same thing.
 */
export const opencode: AgentRuntime = {
	kind: "opencode",
	label: "opencode",
	capabilities: OPENCODE_CAPABILITIES,
	commands: OPENCODE_COMMANDS,
	availability: () =>
		opencodeExecutable()
			? { available: true }
			: { available: false, reason: "opencode is not installed. Put it on PATH, or set DECKS_OPENCODE_BIN to the binary." },
	create: (context) => OpencodeBackend.create(context),
};
