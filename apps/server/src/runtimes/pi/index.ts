import { PI_CAPABILITIES, PI_COMMANDS, PiBackend } from "./backend.ts";
import type { AgentRuntime } from "../contract.ts";

/**
 * Pi, as a runtime descriptor.
 *
 * Pi is the one runtime that runs in this process, so it is always available: there is no
 * binary to find and no sign-in to reuse — `pi auth`'s credentials are checked where every
 * other credential is, at the first turn, and a missing one is a notice in that agent's own
 * transcript. An `availability()` that looked for a file would be inventing a way to be
 * absent.
 */
export const pi: AgentRuntime = {
	kind: "pi",
	label: "Pi",
	capabilities: PI_CAPABILITIES,
	commands: PI_COMMANDS,
	availability: () => ({ available: true }),
	create: (context) => PiBackend.create(context),
};
