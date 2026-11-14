import type { AgentUsage } from "@decks-next/protocol";

/** Thousands separated, because these are read at a glance and not counted digit by digit. */
export const figure = (value: number): string => value.toLocaleString("en-US");

/** The rows under the dial's percentage: what is used, the context size, and what the session cost. */
export function usageRows(usage: AgentUsage | undefined): Array<{ key: string; value: string }> {
	return [
		{ key: "Used", value: figure(usage?.contextTokens ?? 0) },
		{ key: "Window", value: figure(usage?.contextWindow ?? 0) },
		{ key: "This session", value: `$${(usage?.cost ?? 0).toFixed(3)}` },
	];
}

/** The dial's spoken label. */
export const dialLabel = (percent: number): string => `Context ${Math.round(percent)}% full, the numbers behind it`;
