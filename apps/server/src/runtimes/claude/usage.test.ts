import assert from "node:assert/strict";
import test from "node:test";
import { toUsageReport } from "./usage.ts";

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

test("the codenamed buckets do not become limits", () => {
	// `nimbus_quill` and `seven_day_cowork` are there and are not windows anybody has:
	// `limits[]` is the general form and is what gets read.
	assert.deepEqual(
		toUsageReport(LIVE, null).limits?.map((limit) => limit.key),
		["session"],
	);
});

test("an inactive bucket is left out", () => {
	// The account *has* a Cowork week; it is not on one. The CLI's own panel does not draw
	// those, and a row at 0% that can never move is a question answered with nothing.
	assert.equal(toUsageReport(LIVE, null).limits?.some((limit) => limit.key.includes("Cowork")), false);
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
			["weekly_scoped:opus", "7-day window (opus)"],
			["weekly_scoped:Cowork", "7-day window (Cowork)"],
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
