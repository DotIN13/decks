import { claudeAvailability } from "./available.ts";
import { CLAUDE_CAPABILITIES, CLAUDE_COMMANDS, ClaudeBackend } from "./backend.ts";
import type { AgentRuntime } from "../contract.ts";

/**
 * Claude Code, as a runtime descriptor.
 *
 * The availability question is the load-bearing one here, and it is not "is the CLI on
 * PATH". The SDK is a thin client for the `claude` binary and does *not* look for it — so
 * `available.ts` does the looking, the bundled copy counts, and `DECKS_CLAUDE_PATH` wins.
 * Until the `+` menu could see this answer it offered Claude on a machine that had never
 * installed it, and the first prompt was where you found out.
 */
export const claude: AgentRuntime = {
	kind: "claude",
	label: "Claude Code",
	capabilities: CLAUDE_CAPABILITIES,
	commands: CLAUDE_COMMANDS,
	availability: () => {
		const answer = claudeAvailability();
		return answer.available ? { available: true } : { available: false, reason: answer.reason ?? "Claude Code is not installed." };
	},
	create: (context) => ClaudeBackend.create(context),
};
