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
	return usageLevel(contextPercent(usage));
}

/**
 * The same two thresholds, for any share of anything that runs out.
 *
 * The context ring and the plan windows in the usage panel sit a click apart, and two
 * readings that disagree about what "nearly full" looks like are worse than either. So the
 * numbers are stated once here: **the ring, the bar and every plan meter are one function.**
 *
 * picone, where the panel came from, has this drift in it — the dial bands at 70/85 and the
 * meter at 75/90, with a comment beside the meter claiming they are the same two
 * thresholds. They were, once.
 *
 * Colour is earned rather than applied: a meter that is amber at 40% has nothing left to
 * say at 95%. Null is not zero — a window whose share the server would not state gets no
 * colour rather than a calm one.
 */
export function usageLevel(percent: number | null | undefined): "warn" | "high" | undefined {
	if (percent == null || !Number.isFinite(percent)) return undefined;
	if (percent >= 85) return "high";
	if (percent >= 70) return "warn";
	return undefined;
}
