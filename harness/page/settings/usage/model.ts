import type { UsageReport } from "../../state/types/index.ts";
import { planLabel } from "../usage-format.ts";

// The usage panel's words, with no store and no DOM: whose limits these are,
// and what to say when a report has no plan windows.

export const TICK = 30_000;

/** The plan and the account the limits belong to, joined by a dot; empty when neither is known. */
export const whoseLimits = (report: UsageReport | undefined): string => [planLabel(report?.subscription ?? null), report?.account].filter(Boolean).join(" · ");

/** Why there are no windows: a per-token runtime, no claude.ai plan, or a plan with none active. */
export function noLimitsWords(report: Pick<UsageReport, "kind" | "limits">): string {
	if (report.kind !== "claude") return `A ${report.kind} agent bills per token and has no plan windows to run out of.`;
	if (report.limits === null) return "This agent is not running against a claude.ai plan, so there are no windows to report.";
	return "The plan reports no active windows.";
}
