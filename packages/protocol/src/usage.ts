/** What the usage panel draws: the plan's windows, what a conversation spent, what drove it. */

import type { AgentKind } from "./chat.ts";
/** What the agent has spent, sampled at the moments that move it. */
export interface AgentUsage {
	/** Tokens in the context now, or null before the first reply comes back. */
	contextTokens: number | null;
	contextWindow: number;
	cost: number;
}

/**
 * Everything the usage panel draws: the plan, the spend, and what has been driving it.
 *
 * `AgentUsage` above is the *glance* — three numbers, cheap, emitted after every turn and
 * drawn as a ring. This is the thing you open, and it is a different question in three
 * parts: how close is this account to a limit, what has this conversation cost, and what
 * kind of work has been spending it.
 *
 * Read on demand and never cached across openings: two of the three parts are running
 * totals and the third is a countdown, so figures from an hour ago labelled as usage are
 * worse than no figures.
 *
 * **A narrowing, deliberately.** The Claude CLI answers a control request whose payload is
 * already wider than its own typings — codenamed buckets that are all null, an undocumented
 * `limits[]` — so the server reads whatever is there and publishes these fields. A bucket
 * appearing or being renamed upstream changes one mapping function rather than the panel.
 */
export interface UsageReport {
	/** Which runtime answered, because what it can answer depends on that. */
	kind: AgentKind;
	/** `pro`, `max`, `team` — or null on an API key, a 3P provider, or a runtime without plans. */
	subscription: string | null;
	/**
	 * The account these limits belong to.
	 *
	 * An install can have several Claude subscriptions signed in at once
	 * (`claude/accounts.ts`), so "42% of the 5-hour window" is a reading with no subject
	 * until this says whose. Null when the install has no account store — the CLI's own
	 * login, or a pi agent.
	 */
	account: string | null;
	/**
	 * The windows, fullest first, or empty when the account has none to report.
	 *
	 * Empty and `null` are different answers and the panel says so: a runtime or an account
	 * with no plan windows has nothing to be near the end of, which is not a request that
	 * failed.
	 */
	limits: PlanLimit[] | null;
	/** What this conversation has run up. */
	session: SessionSpend;
	/**
	 * What has been driving the usage, as the CLI's own scan reports it.
	 *
	 * Approximate by construction — it is this machine's transcripts, so it misses other
	 * devices and claude.ai entirely — and null when the runtime does not collect it.
	 */
	behaviors: { day: UsageWindow; week: UsageWindow } | null;
}

export interface PlanLimit {
	/** Stable enough to key a list on: `five_hour`, `weekly:opus`. */
	key: string;
	label: string;
	/** 0–100, or null when the window is known but its share is not. */
	percent: number | null;
	/** ISO 8601. Null for a window with no scheduled reset. */
	resetsAt: string | null;
}

/** Tokens, the four ways they are counted and priced. */
export interface TokenCounts {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

/**
 * What one conversation has spent.
 *
 * The totals are always there; the breakdown and the four wall-clock figures are not. A
 * runtime that only keeps a running total sends `models: []` and nulls rather than zeros —
 * "this runtime does not count it" and "it counted zero" are different claims, and a panel
 * that draws them the same way is inventing the first one.
 */
export interface SessionSpend {
	costUsd: number;
	tokens: TokenCounts;
	/** Per model, dearest first. Empty when the runtime keeps only totals. */
	models: ModelSpend[];
	/** Wall clock and API time in milliseconds, or null when the runtime does not count them. */
	durationMs: number | null;
	apiDurationMs: number | null;
	linesAdded: number | null;
	linesRemoved: number | null;
}

export interface ModelSpend {
	model: string;
	tokens: TokenCounts;
	costUsd: number;
}

/** One time window of the runtime's own usage scan. */
export interface UsageWindow {
	requests: number;
	sessions: number;
	/** Overlapping characteristics, so these do not sum to 100. */
	behaviors: { key: string; percent: number; count: number }[];
	agents: UsageShare[];
	skills: UsageShare[];
	plugins: UsageShare[];
	mcpServers: UsageShare[];
}

export interface UsageShare {
	name: string;
	percent: number;
}
