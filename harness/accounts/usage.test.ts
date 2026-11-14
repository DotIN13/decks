import assert from "node:assert/strict";
import test from "node:test";
import { eventPercent, toUsageReport } from "./usage.ts";

/**
 * A real answer from a live account, trimmed but not tidied.
 *
 * Kept verbatim on purpose: the codenamed nulls and the undocumented `limits[]` are the
 * reason the mapper is defensive, and a fixture with them cleaned out would test a payload
 * the CLI never sends.
 */
const LIVE = {
	session: {
		total_cost_usd: 1.25,
		total_api_duration_ms: 41_000,
		total_duration_ms: 605_000,
		total_lines_added: 120,
		total_lines_removed: 8,
		model_usage: {
			"claude-haiku-4-5-20251001": { inputTokens: 90, outputTokens: 40, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.002 },
			"claude-opus-5[1m]": { inputTokens: 1200, outputTokens: 800, cacheReadInputTokens: 400_000, cacheCreationInputTokens: 20_000, costUSD: 1.248 },
		},
	},
	subscription_type: "max",
	rate_limits_available: true,
	rate_limits: {
		five_hour: { utilization: 42, resets_at: "2026-09-04T00:50:00.454083+00:00" },
		seven_day: null,
		seven_day_opus: null,
		seven_day_cowork: { utilization: 0, resets_at: null },
		nimbus_quill: { utilization: 0, resets_at: null },
		tangelo: null,
		extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null },
		limits: [
			{ kind: "session", group: "session", percent: 42, resets_at: "2026-09-04T00:50:00.454083+00:00", scope: null, is_active: true },
			{ kind: "weekly_scoped", group: "weekly", percent: 0, resets_at: null, scope: { model: null, surface: { display_name: "Cowork" } }, is_active: false },
		],
	},
	behaviors: {
		day: {
			request_count: 1044,
			session_count: 7,
			behaviors: [
				{ key: "cron", pct: 100, count: 1 },
				{ key: "long_context", pct: 97, count: 891 },
			],
			agents: [],
			skills: [],
			plugins: [],
			mcp_servers: [{ name: "plugin:chrome-devtools-mcp:chrome-devtools", pct: 33 }],
		},
		week: { request_count: 2768, session_count: 13, behaviors: [{ key: "long_context", pct: 95, count: 2363 }], agents: [], skills: [], plugins: [], mcp_servers: [] },
	},
};

test("an empty codenamed bucket does not become a limit", () => {
	// `nimbus_quill` and this fixture's `seven_day_cowork` have no reset and nothing used:
	// windows the account is not on and cannot move, which is a row answered with noise.
	assert.deepEqual(
		toUsageReport(LIVE, null).limits?.map((limit) => limit.key),
		["five_hour"],
	);
});

test("the named windows survive a `limits[]` that is shorter than they are", () => {
	/*
	 * The bug this pins, measured on a live account: `limits[]` listed the five-hour window
	 * and one inactive bucket, while the block beside it carried three more windows with
	 * reset dates. Preferring the array drew one row where the CLI's own panel drew three.
	 */
	const report = toUsageReport(
		{
			rate_limits_available: true,
			rate_limits: {
				five_hour: { utilization: 15, resets_at: "2026-09-22T08:20:01+00:00" },
				seven_day: { utilization: 61, resets_at: "2026-09-25T00:00:00+00:00" },
				seven_day_oauth_apps: { utilization: 0, resets_at: "2026-09-25T00:00:00+00:00" },
				limits: [{ kind: "session", group: "session", percent: 15, resets_at: "2026-09-22T08:20:01+00:00", scope: null, is_active: true }],
			},
		},
		null,
	);
	assert.deepEqual(
		report.limits?.map((limit) => [limit.key, limit.percent]),
		[
			["seven_day", 61],
			["five_hour", 15],
			["seven_day_oauth_apps", 0],
		],
	);
});

test("a per-model week is one row, whichever half of the payload states it", () => {
	/*
	 * A Fable week arrives three ways — as a named bucket, in `model_scoped[]`, and as a
	 * scoped row in `limits[]` — and they are the same window. `KIND_KEY` is what collapses
	 * them: the server's own display name wins, and nothing is listed twice.
	 */
	const report = toUsageReport(
		{
			rate_limits_available: true,
			rate_limits: {
				five_hour: { utilization: 15, resets_at: null },
				seven_day_fable: { utilization: 33, resets_at: "2026-09-25T00:00:00+00:00" },
				model_scoped: [{ display_name: "Fable", utilization: 33, resets_at: "2026-09-25T00:00:00+00:00" }],
				limits: [{ kind: "weekly_scoped", group: "weekly", percent: 33, resets_at: "2026-09-25T00:00:00+00:00", scope: { model: "Fable" }, is_active: true }],
			},
		},
		null,
	);
	assert.deepEqual(
		report.limits?.map((limit) => [limit.key, limit.label, limit.percent]),
		[
			["seven_day_fable", "7-day (Fable)", 33],
			["five_hour", "5-hour window", 15],
		],
	);
});

test("a window the account is not on is drawn and marked, not dropped", () => {
	// It used to be left out entirely, which meant the panel could not say what windows the
	// plan carries. It is reported with `active: false`, and the panel dims it.
	const report = toUsageReport(
		{
			rate_limits_available: true,
			rate_limits: {
				five_hour: { utilization: 15, resets_at: null },
				seven_day_cowork: { utilization: 0, resets_at: "2026-09-25T00:00:00+00:00" },
				limits: [{ kind: "weekly_scoped", group: "weekly", percent: 0, resets_at: null, scope: { model: null, surface: { display_name: "Cowork" } }, is_active: false }],
			},
		},
		null,
	);
	assert.deepEqual(
		report.limits?.map((limit) => [limit.key, limit.label, limit.active]),
		[
			["five_hour", "5-hour window", true],
			["seven_day_cowork", "7-day (Cowork)", false],
		],
	);
});

test("a scoped window is named by its scope", () => {
	const report = toUsageReport(
		{
			rate_limits_available: true,
			rate_limits: {
				limits: [
					{ kind: "weekly_scoped", percent: 61, resets_at: null, scope: { model: "opus" }, is_active: true },
					{ kind: "weekly_scoped", percent: 12, resets_at: null, scope: { model: null, surface: { display_name: "Cowork" } }, is_active: true },
				],
			},
		},
		null,
	);
	assert.deepEqual(
		report.limits?.map((limit) => [limit.key, limit.label]),
		[
			["seven_day_opus", "7-day (Opus)"],
			["seven_day_cowork", "7-day (Cowork)"],
		],
	);
});

test("windows are sorted fullest first", () => {
	const report = toUsageReport(
		{
			rate_limits_available: true,
			rate_limits: {
				five_hour: { utilization: 12, resets_at: null },
				seven_day: { utilization: 88, resets_at: null },
				seven_day_opus: { utilization: 40, resets_at: null },
			},
		},
		null,
	);
	assert.deepEqual(
		report.limits?.map((limit) => limit.percent),
		[88, 40, 12],
	);
});

test("credits join the list only when they are switched on", () => {
	assert.equal(toUsageReport(LIVE, null).limits?.some((limit) => limit.key === "extra_usage"), false);

	const on = toUsageReport(
		{ rate_limits_available: true, rate_limits: { five_hour: { utilization: 5, resets_at: null }, extra_usage: { is_enabled: true, utilization: 30 } } },
		null,
	);
	assert.deepEqual(
		on.limits?.map((limit) => limit.key),
		["extra_usage", "five_hour"],
	);
});

test("no plan is null, not an empty list", () => {
	// An API-key session has no windows to be near the end of, which is a different answer
	// from a plan that reported none — and the panel says so in different words.
	const report = toUsageReport({ rate_limits_available: false, rate_limits: null, subscription_type: null }, null);
	assert.equal(report.limits, null);
	assert.equal(report.subscription, null);
});

test("a share the server would not state stays null", () => {
	// Zero is a real reading; null is "the window exists and its share is unknown". Folding
	// the second into the first would draw an empty meter and call it a fact.
	const report = toUsageReport({ rate_limits_available: true, rate_limits: { five_hour: { utilization: null, resets_at: null } } }, null);
	assert.equal(report.limits?.[0]?.percent, null);
});

test("models come back dearest first, with their tokens", () => {
	const models = toUsageReport(LIVE, null).session.models;
	assert.deepEqual(
		models.map((model) => model.model),
		["claude-opus-5[1m]", "claude-haiku-4-5-20251001"],
	);
	assert.deepEqual(models[0]?.tokens, { input: 1200, output: 800, cacheRead: 400_000, cacheWrite: 20_000 });
});

test("the token totals are the breakdown summed", () => {
	// The payload has no total of its own, and the panel wants both — the four figures above
	// the table and the table under them — so they must agree by construction.
	assert.deepEqual(toUsageReport(LIVE, null).session.tokens, { input: 1290, output: 840, cacheRead: 400_000, cacheWrite: 20_000 });
});

test("the session's wall-clock figures come through", () => {
	const spend = toUsageReport(LIVE, null).session;
	assert.equal(spend.costUsd, 1.25);
	assert.equal(spend.durationMs, 605_000);
	assert.equal(spend.linesAdded, 120);
});

test("the account is carried, because a window's share has no subject without it", () => {
	assert.equal(toUsageReport(LIVE, "ada@example.com").account, "ada@example.com");
});

test("the behaviour scan is read, and is null when absent", () => {
	const scan = toUsageReport(LIVE, null).behaviors;
	assert.equal(scan?.day.requests, 1044);
	assert.deepEqual(scan?.day.mcpServers, [{ name: "plugin:chrome-devtools-mcp:chrome-devtools", pct: 33 }].map((row) => ({ name: row.name, percent: row.pct })));
	assert.equal(toUsageReport({ ...LIVE, behaviors: null }, null).behaviors, null);
});

test("junk is a report with nothing in it rather than a throw", () => {
	// The whole point of reading `unknown`: a payload that changed shape must degrade to an
	// empty panel, not take down the turn that asked for it.
	for (const junk of [null, undefined, 7, "usage", [], { session: 4, rate_limits: "none" }]) {
		const report = toUsageReport(junk, null);
		assert.equal(report.session.costUsd, 0);
		assert.equal(report.kind, "claude");
	}
});

/*
 * The rate-limit event's figure, which is a fraction where `/usage` states a percentage.
 *
 * The bug this pins: the warning said "1% used" for a subscription at 83%, because `0.83` was
 * rounded as if it were already a percentage. Both conventions are here on purpose, so that a
 * change to either one has to argue with a test rather than with somebody's notification.
 */
test("a rate-limit event's utilisation is a fraction, and is scaled to a percentage", () => {
	assert.equal(eventPercent(0.83), 83);
	assert.equal(eventPercent(0.5), 50);
	assert.equal(eventPercent(1), 100);
	assert.equal(eventPercent(0.007), 1);
});

test("...and a figure that is already a percentage is left alone", () => {
	assert.equal(eventPercent(83), 83);
	assert.equal(eventPercent(4), 4);
});

test("...with nothing to report read as nothing, not as zero", () => {
	assert.equal(eventPercent(undefined), null);
	assert.equal(eventPercent(null), null);
	assert.equal(eventPercent("83"), null);
	assert.equal(eventPercent(Number.NaN), null);
});
