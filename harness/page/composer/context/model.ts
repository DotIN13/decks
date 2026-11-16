import type { AgentUsage } from "@decks/protocol";

// The context dial's words: its spoken label and the rows of numbers behind it.

/** The dial's spoken label. */
export const dialLabel = (percent: number): string => `Context ${Math.round(percent)}% full, the numbers behind it`;

/** The rows under the dial's percentage: what is used, the context size, and what the session cost. */
export function usageRows(usage: AgentUsage | undefined): Array<{ key: string; value: string }> {
	return [
		{ key: "Used", value: figure(usage?.contextTokens ?? 0) },
		{ key: "Window", value: figure(usage?.contextWindow ?? 0) },
		{ key: "This session", value: `$${(usage?.cost ?? 0).toFixed(3)}` },
	];
}

/** Thousands separated, because these are read at a glance and not counted digit by digit. */
export const figure = (value: number): string => value.toLocaleString("en-US");

// How full the context is, stated once: the dial, the ring and every plan meter read these.

/** The reading as a percentage, or nothing when the agent has not reported yet (null is not zero). */
export function contextPercent(usage: AgentUsage | undefined): number | undefined {
	if (!usage || usage.contextTokens == null || usage.contextWindow <= 0) return undefined;
	return (usage.contextTokens / usage.contextWindow) * 100;
}

/** The band a reading is in: nothing, `warn` from 70%, `high` from 85%. */
export function contextLevel(usage: AgentUsage | undefined): "warn" | "high" | undefined {
	return usageLevel(contextPercent(usage));
}

/** The same two thresholds for any share of anything that runs out; an unknown share gets no colour. */
export function usageLevel(percent: number | null | undefined): "warn" | "high" | undefined {
	if (percent == null || !Number.isFinite(percent)) return undefined;
	if (percent >= 85) return "high";
	if (percent >= 70) return "warn";
	return undefined;
}
