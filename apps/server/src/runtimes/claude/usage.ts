import type { ModelSpend, PlanLimit, SessionSpend, TokenCounts, UsageReport, UsageShare, UsageWindow } from "@decks/protocol";

/**
 * Reading the CLI's `/usage` answer into something worth drawing.
 *
 * The control request is `get_usage`, and the SDK's own name for it is fair warning:
 * `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`. Measured against a live
 * account the payload is already wider than its typings — alongside the documented windows
 * there are codenamed buckets (`seven_day_cowork`, `nimbus_quill`, `tangelo`) that are null
 * on an ordinary account, and an undocumented `limits[]` array that is the only place a
 * per-model or per-surface window carries its own display name.
 *
 * So nothing here reads a field by faith. Everything arrives as `unknown` and leaves typed,
 * `limits[]` is preferred when it is there because it is the general form, the named windows
 * are the fallback because they are the ones actually specified, and a bucket that appears
 * next month lands in the panel without a change to it.
 *
 * Ported from picone's `claude/usage.ts`, which worked this out first against the same
 * payload. What is different here is `account`: this install rotates between several
 * subscriptions on its own, so a window's utilisation has no subject until the report says
 * whose it is.
 */

/** What the CLI called it, and what a person would call it. */
const WINDOW_LABEL: Record<string, string> = {
	five_hour: "5-hour window",
	seven_day: "7-day window",
	seven_day_opus: "7-day (Opus)",
	seven_day_sonnet: "7-day (Sonnet)",
	seven_day_oauth_apps: "7-day (apps)",
};

/**
 * "5-hour window", not "current session".
 *
 * That is the CLI's own word for it and it is the wrong one here: this panel also reports
 * what the conversation in front of you has spent, and two different things called
 * "session" a tab apart is a way to misread both.
 */
const KIND_LABEL: Record<string, string> = {
	session: "5-hour window",
	five_hour: "5-hour window",
	weekly: "7-day window",
	weekly_scoped: "7-day window",
	monthly: "30-day window",
};

export function toUsageReport(raw: unknown, account: string | null): UsageReport {
	const root = record(raw) ?? {};
	const limits = record(root.rate_limits);
	return {
		kind: "claude",
		subscription: text(root.subscription_type),
		account,
		// Null and empty mean different things downstream: no plan to report against,
		// versus a plan with nothing left to say.
		limits: root.rate_limits_available === false || !limits ? null : readLimits(limits),
		session: readSession(record(root.session)),
		behaviors: readBehaviors(record(root.behaviors)),
	};
}

/**
 * Every window the account has, fullest first.
 *
 * Fullest first because the reason anyone opens this is to find out which limit they are
 * about to hit, and reading order should not depend on which bucket the server happened to
 * list first.
 */
function readLimits(limits: Record<string, unknown>): PlanLimit[] {
	const rows = Array.isArray(limits.limits) ? fromLimitsArray(limits.limits) : fromNamedWindows(limits);

	// Credits are not a window — no reset, and it is money rather than a share — but it is
	// the other thing that stops a turn, so it belongs in the list.
	const extra = record(limits.extra_usage);
	if (extra?.is_enabled === true) {
		rows.push({ key: "extra_usage", label: "Extra usage credits", percent: percent(extra.utilization), resetsAt: null });
	}

	return rows.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1));
}

/**
 * The general form, when the CLI sends it.
 *
 * Undocumented, so it is read defensively — but it is the only shape that carries `scope`,
 * which is what tells a per-model week apart from a per-surface one. `is_active: false` is a
 * bucket the account has but is not on; the CLI's own panel does not draw those and neither
 * does this.
 */
function fromLimitsArray(rows: unknown[]): PlanLimit[] {
	const out: PlanLimit[] = [];
	for (const entry of rows) {
		const row = record(entry);
		if (!row || row.is_active === false) continue;

		const kind = text(row.kind) ?? text(row.group) ?? "limit";
		const scope = record(row.scope);
		const suffix = text(scope?.model) ?? text(record(scope?.surface)?.display_name);

		const base = KIND_LABEL[kind] ?? kind.replace(/_/g, " ");
		out.push({
			key: suffix ? `${kind}:${suffix}` : kind,
			label: suffix ? `${base} (${suffix})` : base,
			percent: percent(row.percent ?? row.utilization),
			resetsAt: text(row.resets_at),
		});
	}
	return out;
}

/** The documented windows, for a CLI that does not send `limits[]`. */
function fromNamedWindows(limits: Record<string, unknown>): PlanLimit[] {
	const out: PlanLimit[] = [];
	for (const [key, label] of Object.entries(WINDOW_LABEL)) {
		const window = record(limits[key]);
		if (!window) continue;
		out.push({ key, label, percent: percent(window.utilization), resetsAt: text(window.resets_at) });
	}
	for (const entry of Array.isArray(limits.model_scoped) ? limits.model_scoped : []) {
		const row = record(entry);
		if (!row) continue;
		const name = text(row.display_name) ?? "model";
		out.push({ key: `model_scoped:${name}`, label: `7-day (${name})`, percent: percent(row.utilization), resetsAt: text(row.resets_at) });
	}
	return out;
}

function readSession(session: Record<string, unknown> | null): SessionSpend {
	const models: ModelSpend[] = [];
	for (const [model, value] of Object.entries(record(session?.model_usage) ?? {})) {
		const use = record(value);
		if (!use) continue;
		models.push({
			model,
			tokens: {
				input: count(use.inputTokens),
				output: count(use.outputTokens),
				cacheRead: count(use.cacheReadInputTokens),
				cacheWrite: count(use.cacheCreationInputTokens),
			},
			costUsd: number(use.costUSD),
		});
	}
	// Dearest first: a session that ran four models is asking which one cost it.
	models.sort((a, b) => b.costUsd - a.costUsd);

	return {
		costUsd: number(session?.total_cost_usd),
		/*
		 * Summed from the breakdown rather than read from a total of its own, because the
		 * payload has no such total — and the panel wants both: the four figures above the
		 * table, and the table saying which model spent them.
		 */
		tokens: models.reduce(add, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
		models,
		durationMs: count(session?.total_duration_ms),
		apiDurationMs: count(session?.total_api_duration_ms),
		linesAdded: count(session?.total_lines_added),
		linesRemoved: count(session?.total_lines_removed),
	};
}

function add(total: TokenCounts, spend: ModelSpend): TokenCounts {
	return {
		input: total.input + spend.tokens.input,
		output: total.output + spend.tokens.output,
		cacheRead: total.cacheRead + spend.tokens.cacheRead,
		cacheWrite: total.cacheWrite + spend.tokens.cacheWrite,
	};
}

function readBehaviors(behaviors: Record<string, unknown> | null): UsageReport["behaviors"] {
	if (!behaviors) return null;
	const day = readWindow(record(behaviors.day));
	const week = readWindow(record(behaviors.week));
	if (!day || !week) return null;
	return { day, week };
}

function readWindow(window: Record<string, unknown> | null): UsageWindow | null {
	if (!window) return null;
	return {
		requests: count(window.request_count),
		sessions: count(window.session_count),
		behaviors: (Array.isArray(window.behaviors) ? window.behaviors : []).flatMap((entry) => {
			const row = record(entry);
			const key = text(row?.key);
			return key ? [{ key, percent: number(row?.pct), count: count(row?.count) }] : [];
		}),
		agents: shares(window.agents),
		skills: shares(window.skills),
		plugins: shares(window.plugins),
		mcpServers: shares(window.mcp_servers),
	};
}

function shares(value: unknown): UsageShare[] {
	return (Array.isArray(value) ? value : []).flatMap((entry) => {
		const row = record(entry);
		const name = text(row?.name);
		return name ? [{ name, percent: number(row?.pct) }] : [];
	});
}

// --- reading an unknown ---------------------------------------------------------

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}

function number(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function count(value: unknown): number {
	return Math.max(0, Math.round(number(value)));
}

/**
 * A share, or null.
 *
 * Zero is a real answer here — a week you have not touched — and null is "the window exists
 * but the server would not say", so this is the one place the missing case is not folded
 * into `0`.
 */
function percent(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return Math.max(0, Math.min(100, value));
}
