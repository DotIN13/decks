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

/**
 * A `limits[]` kind, as the key the block of named windows uses for the same window.
 *
 * This is what lets the two halves of the payload be read together rather than one of them
 * chosen: the array calls the five-hour window `session` and the week `weekly`, while the
 * block beside it calls them `five_hour` and `seven_day`. One window, two names, and a panel
 * reading both without this would report every limit twice.
 */
const KIND_KEY: Record<string, string> = {
	session: "five_hour",
	five_hour: "five_hour",
	weekly: "seven_day",
	weekly_scoped: "seven_day",
	monthly: "monthly",
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
 * Every window the account has, read from **both** places the payload states them.
 *
 * Either one alone loses windows. The block of named buckets (`five_hour`, `seven_day`,
 * `seven_day_opus`, `model_scoped[]`, and a changing set of codenames) is the complete list,
 * but it labels nothing beyond the five names that are documented. The undocumented
 * `limits[]` array is the only place a window carries a display name, a scope, and whether
 * the account is on it — and it is *shorter*: on a live account it listed two entries where
 * the block beside it had four windows with reset dates. Preferring the array, which is what
 * this file used to do, drew one row where the CLI's own panel draws three.
 *
 * So the block supplies the windows, the array names them and says which are in force, and
 * `KIND_KEY` is what keeps one window from being drawn twice under two names.
 */
function readLimits(limits: Record<string, unknown>): PlanLimit[] {
	const rows = new Map<string, PlanLimit>();
	readNamedWindows(rows, limits);
	readModelScoped(rows, limits);
	readLimitsArray(rows, limits);

	const out = [...rows.values()];

	// Credits are not a window — no reset, and it is money rather than a share — but it is
	// the other thing that stops a turn, so it belongs in the list.
	const extra = record(limits.extra_usage);
	if (extra?.is_enabled === true) {
		out.push({ key: "extra_usage", label: "Extra usage credits", percent: percent(extra.utilization), resetsAt: null, active: true });
	}

	/*
	 * In force first, then fullest first. Fullest because the reason anyone opens this is to
	 * find out which limit they are about to hit, and reading order should not depend on
	 * which bucket the server happened to list first; in force first because a window the
	 * account is not currently subject to cannot be the answer to that question, however
	 * full it reads.
	 */
	return out.sort((a, b) => Number(b.active) - Number(a.active) || (b.percent ?? -1) - (a.percent ?? -1));
}

/**
 * The named block: the documented five, and whatever else is in there this month.
 *
 * Every key is read rather than a list of known ones, because the documented names are a
 * subset of what arrives — one live account also carried `seven_day_cowork`,
 * `seven_day_omelette`, `nimbus_quill` and eleven more. A codename that is only a
 * placeholder says so by having nothing in it: no reset, and nothing used. Those are
 * dropped, because a row at 0% that can never move is a question answered with noise. One
 * with a reset date is a real window and is kept, under a name made from its key until
 * `limits[]` gives it a better one.
 */
function readNamedWindows(rows: Map<string, PlanLimit>, limits: Record<string, unknown>): void {
	for (const [key, value] of Object.entries(limits)) {
		if (key === "limits" || key === "model_scoped" || key === "extra_usage") continue;
		const window = record(value);
		if (!window || !("utilization" in window)) continue;
		const share = percent(window.utilization);
		const resetsAt = text(window.resets_at);
		if (!WINDOW_LABEL[key] && !resetsAt && !share) continue;
		merge(rows, key, { label: WINDOW_LABEL[key] ?? windowLabel(key), percent: share, resetsAt, active: true });
	}
}

/** The per-model weeks — where a Fable or an Opus week arrives when the CLI sends one. */
function readModelScoped(rows: Map<string, PlanLimit>, limits: Record<string, unknown>): void {
	for (const entry of Array.isArray(limits.model_scoped) ? limits.model_scoped : []) {
		const row = record(entry);
		if (!row) continue;
		const name = text(row.display_name) ?? "model";
		merge(rows, `seven_day_${slug(name)}`, { label: `7-day (${name})`, percent: percent(row.utilization), resetsAt: text(row.resets_at), active: true });
	}
}

/**
 * The general form, when the CLI sends it: display names, scopes, and what is in force.
 *
 * Read last so its label wins — it is the server's own word for the bucket, where everything
 * above is this file reading a key. `is_active: false` is a window the account has and is
 * not on: it used to be dropped here, and is now kept and marked, because a plan that
 * carries a week for a model you have not used yet should still say the week is there. The
 * exception is a row with nothing in it at all — not in force, no reset, nothing used —
 * which is a placeholder rather than a limit, and only when the named block did not already
 * report that window.
 */
function readLimitsArray(rows: Map<string, PlanLimit>, limits: Record<string, unknown>): void {
	for (const entry of Array.isArray(limits.limits) ? limits.limits : []) {
		const row = record(entry);
		if (!row) continue;

		const kind = text(row.kind) ?? text(row.group) ?? "limit";
		const scope = record(row.scope);
		const suffix = text(scope?.model) ?? text(record(scope?.surface)?.display_name);
		const key = canonicalKey(kind, suffix);

		const share = percent(row.percent ?? row.utilization);
		const resetsAt = text(row.resets_at);
		const active = row.is_active !== false;
		if (!active && !resetsAt && !share && !rows.has(key)) continue;

		merge(rows, key, { label: scopedLabel(kind, suffix), percent: share, resetsAt, active });
	}
}

/**
 * One window, stated by two sources.
 *
 * The later source wins where it has something to say and never loses what the earlier one
 * had: the array knows the name and the activity, the block usually knows the share and the
 * reset. Not in force beats in force, because only the array states it at all.
 */
function merge(rows: Map<string, PlanLimit>, key: string, next: Omit<PlanLimit, "key">): void {
	const was = rows.get(key);
	rows.set(key, {
		key,
		label: next.label,
		percent: next.percent ?? was?.percent ?? null,
		resetsAt: next.resetsAt ?? was?.resetsAt ?? null,
		active: next.active && (was?.active ?? true),
	});
}

/** A key from the named block, as words: `seven_day_cowork` is the 7-day window for Cowork. */
function windowLabel(key: string): string {
	const week = /^seven_day_(.+)$/.exec(key);
	if (week?.[1]) return `7-day (${titled(week[1])})`;
	const hours = /^five_hour_(.+)$/.exec(key);
	if (hours?.[1]) return `5-hour (${titled(hours[1])})`;
	return titled(key);
}

/** A `limits[]` row, as words: its kind, narrowed by whatever its scope names. */
function scopedLabel(kind: string, suffix: string | null): string {
	const base = KIND_LABEL[kind] ?? titled(kind);
	return suffix ? `${base.replace(/ window$/, "")} (${titled(suffix)})` : base;
}

/** The one key both sources agree on for one window. */
function canonicalKey(kind: string, suffix: string | null): string {
	const base = KIND_KEY[kind] ?? kind;
	return suffix ? `${base}_${slug(suffix)}` : base;
}

function slug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

/** Words from a key, capitalised once — a name that arrived capitalised is left as it is. */
function titled(raw: string): string {
	const words = raw.replace(/_/g, " ");
	return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
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

/**
 * The utilisation on a **rate-limit event**, which does not use the convention above.
 *
 * `SDKRateLimitInfo.utilization` is the one figure in this file whose unit is written down
 * nowhere: the SDK's type for it is `utilization?: number` with no comment, where every window in
 * the `/usage` payload is documented as "Percentage of the window used, 0-100" and is read by
 * `percent` without scaling. The event's number arrives as a **fraction** instead: a window at 83%
 * comes in as `0.83`, and rounding that as if it were already a percentage is what made a
 * subscription four fifths of the way through its five-hour limit announce itself as "1% used".
 *
 * The two conventions cannot be told apart arithmetically at the boundary, and where this is read
 * is what settles it: it is only used for an `allowed_warning`, which no server sends at or below
 * one percent of a window. So `<= 1` is a fraction and anything above it is already a percentage.
 * If a payload ever disagrees, it is this function's test that should fail rather than a person's
 * notification looking wrong.
 */
export function eventPercent(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	const scaled = value <= 1 ? value * 100 : value;
	return Math.max(0, Math.min(100, Math.round(scaled)));
}
