// What a Claude session has spent and how close its account is to a limit:
// the session's cost, a one-off usage read, and a limit said in words.
import { tmpdir } from "node:os";
import { query, type Query, type SDKControlGetUsageResponse, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { claudeExecutable } from "./available.ts";

// --- usage and limits -------------------------------------------------------------

/**
 * What the session has cost, out of the payload behind the CLI's own `/usage`.
 *
 * Reported as zero for a while, on the grounds that the call is experimental — which left
 * the meter saying "3% ctx" beside a pi agent saying "3% ctx · $0.0018", and a cost of zero
 * is not more honest than no figure, it is a wrong one.
 *
 * `undefined` rather than zero when the payload has no figure, so the caller keeps the one
 * it had: the whole payload is held at arm's length, because the SDK's own name for the call
 * is an instruction — `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`.
 */
export function sessionCost(usage: SDKControlGetUsageResponse | undefined): number | undefined {
	const cost = usage?.session?.total_cost_usd;
	return typeof cost === "number" && Number.isFinite(cost) ? cost : undefined;
}

/**
 * One usage read from a process of its own, on the account `env` names, and then gone.
 *
 * For a session whose agent has changed account since it started (`ClaudeBackend.report`). A
 * query with no message never sends a turn, so this spends nothing: it is the process starting,
 * the usage request, and the process closing, about two and a half seconds. `undefined` when
 * it cannot answer, so the caller can fall back on what it had.
 */
export async function probeUsage(env: NodeJS.ProcessEnv | undefined): Promise<SDKControlGetUsageResponse | undefined> {
	if (!env) return undefined;
	const executable = claudeExecutable();
	// Never yields: the probe is a usage read, not a conversation.
	async function* nothing(): AsyncGenerator<SDKUserMessage> {
		await new Promise<never>(() => {});
	}
	const probe = query({ prompt: nothing(), options: { env, cwd: tmpdir(), ...(executable ? { pathToClaudeCodeExecutable: executable } : {}) } });
	void (async () => {
		try {
			for await (const _ of probe) {
				/* drained so the process is not left waiting on a reader */
			}
		} catch {
			/* closed below, which ends the loop with an error worth nothing */
		}
	})();
	try {
		const read = (probe as Partial<Query>).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
		if (typeof read !== "function") return undefined;
		return await Promise.race([read.call(probe), new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 15_000).unref?.())]);
	} catch {
		return undefined;
	} finally {
		probe.close?.();
	}
}

/** The window a limit is about, in words rather than the wire's name for it. */
export function limitWindow(type: string | undefined): string {
	switch (type) {
		case "five_hour":
			return "5-hour";
		case "seven_day":
			return "weekly";
		case "seven_day_opus":
			return "weekly Opus";
		case "seven_day_sonnet":
			return "weekly Sonnet";
		case "overage":
		case "seven_day_overage_included":
			return "overage";
		default:
			return "usage";
	}
}

/**
 * When a limit lifts, said the way a person would say it.
 *
 * A bare timestamp is not information at a glance, and the reset is usually today — so a
 * time is enough, and a date is only added when it is not today. Empty when there is no
 * reset to report, because "resets undefined" is worse than saying nothing.
 */
export function resetWords(at: number | undefined): string {
	if (!at || !Number.isFinite(at)) return "";
	const when = new Date(at);
	if (Number.isNaN(when.getTime())) return "";
	const today = new Date().toDateString() === when.toDateString();
	const time = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	return today ? ` (resets ${time})` : ` (resets ${when.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time})`;
}
