import type { AgentUsage } from "@decks/protocol";

/**
 * How full an agent's context is, and whether that is worth a colour.
 *
 * The arithmetic and the two thresholds, in a module of their own, for the same reason
 * `panel-groups.ts` and `agent-order.ts` are: the component beside this is a picture of
 * these two functions, and the only way to ask "does 84.6% read as amber or as red" of a
 * component is to render one and look.
 *
 * The reading is drawn in the corner's `⋯` (`ContextSummary.tsx`) and the level is worn by
 * the `⋯` button itself, so both callers agree on the numbers by construction.
 */

/**
 * The reading as a percentage, or nothing at all.
 *
 * `contextTokens` is `number | null`, and the null is load-bearing: it means the agent has
 * not reported yet — before its first reply, and in the window right after a compaction.
 * **Nothing is drawn then.** A bar at zero would say the context is empty, which is a
 * different and usually false claim from "not known yet", and it is the one somebody would
 * act on. Tested as `!= null` rather than for truthiness, because zero is a real reading and
 * a falsy one.
 */
export function contextPercent(usage: AgentUsage | undefined): number | undefined {
	if (!usage || usage.contextTokens == null || usage.contextWindow <= 0) return undefined;
	return (usage.contextTokens / usage.contextWindow) * 100;
}

/**
 * The band a reading is in: nothing, `warn` from 70%, `high` from 85%.
 *
 * Those are the two points where the next long turn is the one that gets truncated, so the
 * colour arrives before the trouble does. Nothing below 70, because a corner that is always
 * marked is a corner nobody reads.
 */
export function contextLevel(usage: AgentUsage | undefined): "warn" | "high" | undefined {
	const value = contextPercent(usage);
	if (value === undefined) return undefined;
	if (value >= 85) return "high";
	if (value >= 70) return "warn";
	return undefined;
}
