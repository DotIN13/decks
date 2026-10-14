import { OPENCODE2_CAPABILITIES, OPENCODE2_COMMANDS, Opencode2Backend } from "./backend.ts";
import { opencode2Executable } from "./install.ts";
import { NOT_INSTALLED } from "./manager.ts";
import type { AgentRuntime } from "../contract.ts";

/**
 * OpenCode 2, as a runtime descriptor: a runtime of its own beside opencode 1, which stays as it
 * was. The binary is the availability question, and the sentence is the one the manager refuses
 * with, so the menu and the failure say the same thing.
 */
export const opencode2: AgentRuntime = {
	kind: "opencode2",
	label: "OpenCode 2",
	capabilities: OPENCODE2_CAPABILITIES,
	commands: OPENCODE2_COMMANDS,
	availability: () => (opencode2Executable() ? { available: true } : { available: false, reason: NOT_INSTALLED }),
	create: (context) => Opencode2Backend.create(context),
};
