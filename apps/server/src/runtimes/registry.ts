import { AGENT_KINDS, type AgentKind, type RuntimeInfo } from "@decks/protocol";
import { antigravity } from "./antigravity/index.ts";
import type { AgentRuntime } from "./contract.ts";
import { claude } from "./claude/index.ts";
import { opencode } from "./opencode/index.ts";
import { pi } from "./pi/index.ts";

/**
 * Every runtime this build knows, and the one place its name is written.
 *
 * **A fifth runtime is this file plus a directory.** Before, it was four edits in
 * `agents/session.ts` — an import, `BACKENDS`, `CAPABILITIES`, `DORMANT_COMMANDS` — the
 * union and its array in `packages/protocol`, three entries in the browser's mark file, and
 * a new backend directory. The shell imported every runtime to be able to start one.
 *
 * Typed as `Record<AgentKind, AgentRuntime>`, so the union and this table cannot disagree:
 * adding a kind without a descriptor is a compile error here, and a descriptor for a kind
 * that does not exist is a compile error in the descriptor.
 */
export const RUNTIMES: Record<AgentKind, AgentRuntime> = {
	pi,
	claude,
	opencode,
	antigravity,
};

/** The runtime behind an agent. Total, because the record is. */
export function runtimeOf(kind: AgentKind): AgentRuntime {
	return RUNTIMES[kind];
}

/**
 * What a browser needs to draw the new-agent menu: every kind, in the protocol's order,
 * with the answer to "can this run here" beside it.
 *
 * This is the other half of the seam. `availability()` existed in every runtime and reached
 * no client, so the `+` menu offered four runtimes on every machine and the first prompt was
 * where you learned which ones were installed. The answer is a `PATH` lookup, so it is cheap
 * enough to send on connect and to recompute whenever somebody asks.
 */
export function runtimeList(): RuntimeInfo[] {
	return AGENT_KINDS.map((kind) => {
		const runtime = RUNTIMES[kind];
		const answer = runtime.availability();
		return { kind, label: runtime.label, ...answer };
	});
}
